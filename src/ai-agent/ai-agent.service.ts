import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from 'src/common/logger/logger.service';
import { ChatDto } from './dto/chat.dto';
import { CustomerService } from 'src/customers/customers.service';
import { ProductService } from 'src/products/products.service';
import { CompanyService, CompanyRequester } from 'src/companies/companies.service';
import { QuotationService } from 'src/quotations/quotations.service';
import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import { allTools } from './tools';
import { SYSTEM_PROMPT } from './ai-agent.prompt';

// Overridable via env so a Groq model deprecation doesn't require a code
// change/redeploy — just an env var update.
const AI_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Each tool-loop iteration is a paid API call plus real DB writes — capped
// so a model stuck re-requesting tools (or a manipulated conversation that
// induces looping) can't run unbounded.
const MAX_TOOL_ITERATIONS = 8;

// Bounds how long a single Groq call can hang before failing — the chat
// endpoint should fail fast rather than hold the request open indefinitely.
const GROQ_TIMEOUT_MS = 20_000;

// Multi-key rotation happens at our own layer (see createChatCompletion
// below), not the SDK's — retries here would just burn time re-hitting an
// already-confirmed-limited key before we get a chance to rotate off it.
const GROQ_MAX_RETRIES = 0;

// A rate-limited key stops being tried again until this many seconds have
// passed, used only when Groq's response doesn't include a Retry-After
// header telling us exactly how long to wait.
const DEFAULT_COOLDOWN_SECONDS = 30;

// How many of the user's most recent stored messages get loaded back in as
// conversation context — bounds prompt size/cost regardless of how long a
// user's overall chat history grows. Kept modest because the fixed
// per-request overhead (system prompt + all tool schemas) already eats a
// large chunk of this org's Groq tokens-per-minute budget on its own.
const HISTORY_LOAD_LIMIT = 10;

// True for both of Groq's "you're over budget" shapes: HTTP 429 (too many
// requests) and HTTP 413 with error.code 'rate_limit_exceeded' (a single
// request's token count exceeds the tokens-per-minute budget). Both are
// scoped to the API key that made the call, not global, so callers treat
// this as "try the next key" rather than an unrecoverable failure.
function isGroqRateLimitError(err: any): boolean {
  if (err?.status === 429 || err?.status === 413) return true;
  if (err?.error?.code === 'rate_limit_exceeded') return true;
  const msg = String(err?.message ?? '');
  return msg.includes('429') || msg.includes('rate_limit_exceeded');
}

type CurrentUser = { company_id: number; user_id: number; permissions?: string[] };

interface GroqKeySlot {
  client: Groq;
  label: string; // for logging only — never the raw key
  cooldownUntil: number; // epoch ms; 0 = available now
}

@Injectable()
export class AiAgentService {
  private readonly groqKeys: GroqKeySlot[];
  private nextKeyIndex = 0;

  private readonly AiAgentMessages: any;

  constructor(
    private readonly appLogger: AppLogger,
    private readonly customerService: CustomerService,
    private readonly productService: ProductService,
    private readonly companyService: CompanyService,
    private readonly quotationService: QuotationService,
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
  ) {
    this.AiAgentMessages = this.dbProvider.db.ai_agent_messages;

    // GROQ_API_KEYS: comma-separated list of keys to rotate across when one
    // hits its rate limit. Falls back to the single GROQ_API_KEY var so
    // existing single-key setups keep working unchanged.
    const rawKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (rawKeys.length === 0) {
      this.appLogger
        .forContext('AiAgentService', 'constructor')
        .error('No Groq API key configured (GROQ_API_KEYS or GROQ_API_KEY)');
    }

    this.groqKeys = rawKeys.map((apiKey, i) => ({
      client: new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: GROQ_MAX_RETRIES }),
      label: `key#${i + 1}`,
      cooldownUntil: 0,
    }));
  }

  // Tries each configured key in round-robin order, skipping any still in
  // its post-429 cooldown window. On a 429, the offending key is put on
  // cooldown (honoring Retry-After when Groq sends one) and the next key is
  // tried immediately — the caller only sees a failure if every key is
  // currently rate-limited.
  private async createChatCompletion(
    params: ChatCompletionCreateParamsNonStreaming,
    log: ReturnType<AppLogger['forContext']>,
  ): Promise<Groq.Chat.ChatCompletion> {
    if (this.groqKeys.length === 0) {
      throw new Error('AI_AGENT_NOT_CONFIGURED');
    }

    const total = this.groqKeys.length;
    let lastRateLimitErr: any;

    for (let attempt = 0; attempt < total; attempt++) {
      const idx = (this.nextKeyIndex + attempt) % total;
      const slot = this.groqKeys[idx];

      if (slot.cooldownUntil > Date.now()) {
        continue;
      }

      try {
        const result = await slot.client.chat.completions.create(params);
        this.nextKeyIndex = (idx + 1) % total;
        return result;
      } catch (err: any) {
        // Groq returns two distinct shapes for "you're over the limit":
        // status 429 for request-count rate limits, and status 413 with
        // error.code 'rate_limit_exceeded' when a single request's token
        // count exceeds the org's tokens-per-minute budget. Both are
        // per-key limits, so rotating to the next key helps with either.
        if (!isGroqRateLimitError(err)) {
          throw err;
        }

        const retryAfterHeader = err?.headers?.get?.('retry-after');
        const cooldownSeconds =
          Number(retryAfterHeader) > 0 ? Number(retryAfterHeader) : DEFAULT_COOLDOWN_SECONDS;
        slot.cooldownUntil = Date.now() + cooldownSeconds * 1000;
        lastRateLimitErr = err;

        log.warn(`Groq ${slot.label} rate-limited, cooling down`, {
          cooldownSeconds,
          keysAvailable: total,
        });
      }
    }

    // Every key is currently cooling down.
    throw lastRateLimitErr ?? new Error('AI_AGENT_ALL_KEYS_RATE_LIMITED');
  }

  // =========================
  // TOOL EXECUTOR
  // =========================
  // Split by domain so each piece stays readable — the 8 quotation tools
  // are the only ones that need the tenant-scoping companyId threaded
  // through explicitly; the others go through the *Service's own
  // currentUser-scoped methods.

  private async executeCustomerTool(
    name: string,
    args: any,
    currentUser: CurrentUser,
  ): Promise<string | undefined> {
    switch (name) {
      case 'get_customers_list': {
        const result = await this.customerService.getCustomersList(args, currentUser);
        return JSON.stringify(result.data);
      }
      // CustomerService.createCustomer expects a nested shape
      // (display_name/customer_type + contacts[]/addresses[] arrays), not
      // the flat first_name/email/city/... fields the tool schema exposes
      // to the model — translate here rather than asking the model to
      // reason about a nested contract.
      case 'create_customer': {
        const hasAddressFields = [
          args.address_line_1,
          args.address_line_2,
          args.city,
          args.state,
          args.country,
          args.postal_code,
        ].some((v) => v !== undefined);

        const payload = {
          customer_type: args.company_name ? 'BUSINESS' : 'INDIVIDUAL',
          display_name:
            args.company_name || `${args.first_name} ${args.last_name}`.trim(),
          company_name: args.company_name,
          contacts: [
            {
              first_name: args.first_name,
              last_name: args.last_name,
              email: args.email,
              phone: args.phone,
              is_primary: 1,
            },
          ],
          addresses: [
            {
              address_type: 'OTHER',
              ...(hasAddressFields && {
                address_line_1: args.address_line_1,
                address_line_2: args.address_line_2,
                city: args.city,
                state: args.state,
                country: args.country,
                postal_code: args.postal_code,
              }),
              is_primary: 1,
            },
          ],
        };

        const result = await this.customerService.createCustomer(
          payload as any,
          currentUser,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'delete_customer': {
        const result = await this.customerService.deleteCustomer(args.id, currentUser);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      // Same nested-shape mismatch as create — additionally, CustomerService
      // fully replaces the contacts/addresses arrays on update (not a
      // per-field patch), so any field the user didn't mention must be
      // filled in from the existing record first or it gets wiped.
      case 'update_customer': {
        const {
          id,
          first_name,
          last_name,
          email,
          phone,
          address_line_1,
          address_line_2,
          city,
          state,
          country,
          postal_code,
          ...rest
        } = args;

        const contactFieldsGiven = [first_name, last_name, email, phone].some(
          (v) => v !== undefined,
        );
        const addressFieldsGiven = [
          address_line_1,
          address_line_2,
          city,
          state,
          country,
          postal_code,
        ].some((v) => v !== undefined);

        const payload: any = { ...rest };

        if (contactFieldsGiven || addressFieldsGiven) {
          const existing = await this.customerService.getCustomerDetails(id, currentUser);
          if (!existing.success) {
            return JSON.stringify({
              success: false,
              message: existing.message,
              data: null,
            });
          }
          const existingContact = (existing.data as any)?.contacts?.[0] ?? {};
          const existingAddress = (existing.data as any)?.addresses?.[0] ?? {};

          if (contactFieldsGiven) {
            payload.contacts = [
              {
                first_name: first_name ?? existingContact.first_name,
                last_name: last_name ?? existingContact.last_name,
                email: email ?? existingContact.email,
                phone: phone ?? existingContact.phone,
                department: existingContact.department,
                designation: existingContact.designation,
                is_primary: 1,
              },
            ];
          }

          if (addressFieldsGiven) {
            payload.addresses = [
              {
                address_type: existingAddress.address_type || 'OTHER',
                address_line_1: address_line_1 ?? existingAddress.address_line_1,
                address_line_2: address_line_2 ?? existingAddress.address_line_2,
                city: city ?? existingAddress.city,
                state: state ?? existingAddress.state,
                country: country ?? existingAddress.country,
                postal_code: postal_code ?? existingAddress.postal_code,
                is_primary: 1,
              },
            ];
          }
        }

        const result = await this.customerService.updateCustomer(id, payload, currentUser);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      default:
        return undefined;
    }
  }

  private async executeProductTool(
    name: string,
    args: any,
    currentUser: CurrentUser,
  ): Promise<string | undefined> {
    switch (name) {
      case 'get_products_list': {
        const result = await this.productService.getProductsList(args, currentUser);
        return JSON.stringify(result.data);
      }
      case 'create_product': {
        const result = await this.productService.createProduct(args, currentUser);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'delete_product': {
        const result = await this.productService.deleteProduct(args.id, currentUser);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'update_product': {
        const { id, ...updateData } = args;
        const result = await this.productService.updateProduct(id, updateData, currentUser);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      default:
        return undefined;
    }
  }

  private async executeCompanyTool(
    name: string,
    args: any,
    currentUser: CurrentUser,
  ): Promise<string | undefined> {
    // Same identity context the Companies controller builds from the JWT —
    // the AI agent calls companyService directly, bypassing that controller
    // entirely, so this module must derive it independently. Self-service
    // only: always the caller's own company, never another one.
    const companyRequester: CompanyRequester = {
      companyId: currentUser.company_id,
    };

    switch (name) {
      case 'get_company_details': {
        const result = await this.companyService.getCompanyById(currentUser.company_id, companyRequester);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'get_company_addresses': {
        const result = await this.companyService.getCompanyAddresses(currentUser.company_id, companyRequester);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'get_company_locations': {
        const result = await this.companyService.getCompanyLocations(currentUser.company_id, companyRequester);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      case 'update_company': {
        const result = await this.companyService.updateCompany(currentUser.company_id, args, companyRequester);
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }
      default:
        return undefined;
    }
  }

  private async executeQuotationTool(
    name: string,
    args: any,
    currentUser: CurrentUser,
  ): Promise<string | undefined> {
    switch (name) {
      case 'get_quotations_list': {
        const result = await this.quotationService.getQuotations(args, currentUser);
        return JSON.stringify(result.data);
      }

      // company_id and user_id are never trusted from the model/args —
      // always the authenticated caller's own identity, same self-service
      // rule as the company tools. The tool schema deliberately doesn't ask
      // the model for a billing/shipping address (too much friction for a
      // chat flow), so when neither is supplied we fall back to the
      // customer's primary saved address here.
      case 'create_quotation': {
        let billingAddressId = args.billing_address_id;
        let shippingAddressId = args.shipping_address_id;

        if (!billingAddressId || !shippingAddressId) {
          const customerResult = await this.customerService.getCustomerDetails(
            args.customer_id,
            currentUser,
          );
          const addresses = (customerResult.data as any)?.addresses ?? [];
          const defaultAddress =
            addresses.find((a: any) => a.is_primary) ?? addresses[0];

          billingAddressId = billingAddressId ?? defaultAddress?.id;
          shippingAddressId = shippingAddressId ?? defaultAddress?.id;
        }

        const result = await this.quotationService.createQuotation({
          ...args,
          billing_address_id: billingAddressId,
          shipping_address_id: shippingAddressId,
          company_id: currentUser.company_id,
          user_id: currentUser.user_id,
        });
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      case 'get_quotation_details': {
        const result = await this.quotationService.getQuotationDetails(
          args.id,
          currentUser.company_id,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      case 'get_quotation_history': {
        const result = await this.quotationService.getQuotationHistory(
          args.id,
          currentUser.company_id,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      case 'get_quotation_timeline': {
        const result = await this.quotationService.getQuotationTimeline(
          args.id,
          currentUser.company_id,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      case 'update_quotation': {
        const { id, ...updateData } = args;
        const result = await this.quotationService.updateQuotation(
          id,
          currentUser.company_id,
          updateData,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      // user_id is never trusted from the model — always the authenticated
      // caller, so audit trails (changed_by) can't be spoofed via chat.
      case 'send_quotation': {
        const result = await this.quotationService.sendQuotation(
          args.id,
          currentUser.company_id,
          currentUser.user_id,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      case 'delete_quotation': {
        const result = await this.quotationService.deleteQuotation(
          args.id,
          currentUser.company_id,
          currentUser.user_id,
        );
        return JSON.stringify({
          success: result.success,
          message: result.message,
          data: result.data ?? null,
        });
      }

      default:
        return undefined;
    }
  }

  private async executeTool(
    name: string,
    args: any,
    currentUser: CurrentUser,
  ): Promise<string> {
    const log = this.appLogger.forContext('AiAgentService', 'executeTool', { tool: name });
    log.info(`Executing tool: ${name}`, { args });

    try {
      const result =
        (await this.executeCustomerTool(name, args, currentUser)) ??
        (await this.executeProductTool(name, args, currentUser)) ??
        (await this.executeCompanyTool(name, args, currentUser)) ??
        (await this.executeQuotationTool(name, args, currentUser));

      return result ?? JSON.stringify({ error: `Unknown tool: ${name}` });
    } catch (err: any) {
      log.error(`Tool execution failed: ${name}`, err);
      return JSON.stringify({ error: `Tool ${name} failed`, details: err?.message });
    }
  }

  // =========================
  // HISTORY
  // =========================
  // Persisted server-side per user, scoped by company_id for tenant
  // isolation/cleanup — the client no longer sends history on each request
  // (it can't be trusted as-is, and it also can't span devices/tabs/browser
  // sessions), so context now carries forward automatically for the same
  // logged-in user regardless of which device or tab they chat from.

  async getRecentHistory(currentUser: CurrentUser) {
    const rows = await this.AiAgentMessages.findAll({
      where: { user_id: currentUser.user_id },
      order: [['created_at', 'DESC']],
      limit: HISTORY_LOAD_LIMIT,
    });
    // DB gives newest-first (for the LIMIT to bound correctly); the model
    // needs them in chronological order.
    return rows.reverse().map((row: any) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
      created_at: row.created_at,
    }));
  }

  private async saveMessage(currentUser: CurrentUser, role: 'user' | 'assistant', content: string) {
    if (!content) return;
    await this.AiAgentMessages.create({
      user_id: currentUser.user_id,
      company_id: currentUser.company_id,
      role,
      content,
    });
  }

  async clearHistory(currentUser: CurrentUser) {
    await this.AiAgentMessages.destroy({ where: { user_id: currentUser.user_id } });
    return { success: true, message: 'Chat history cleared', data: null };
  }

  // =========================
  // CHAT
  // =========================

  async chat(data: ChatDto, currentUser: CurrentUser) {
    const log = this.appLogger.forContext('AiAgentService', 'chat', {
      session_id: data.session_id ?? 'no-session',
      company_id: currentUser.company_id,
    });

    log.info('AI Agent chat attempt started');

    try {
      const history = await this.getRecentHistory(currentUser);

      // ── Build message history ────────────────────────────────────────────
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: SYSTEM_PROMPT,
        },
        ...history.map((msg: { role: 'user' | 'assistant'; content: string }) => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: data.message,
        },
      ];

      // ── First call — AI decides if it needs a tool ───────────────────────
      let completion = await this.createChatCompletion(
        {
          model: AI_MODEL,
          messages,
          tools: allTools,
          tool_choice: 'auto',
          max_tokens: 1024,
          temperature: 0.7,
        },
        log,
      );

      let responseMessage = completion.choices[0]?.message;

      // ── Tool call loop ───────────────────────────────────────────────────
      let toolIterations = 0;
      let stoppedOnIterationCap = false;
      while (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        toolIterations += 1;
        if (toolIterations > MAX_TOOL_ITERATIONS) {
          log.warn('Tool call loop exceeded max iterations, stopping', {
            toolIterations,
          });
          stoppedOnIterationCap = true;
          break;
        }

        log.info(`Tool calls requested: ${responseMessage.tool_calls.map(t => t.function.name).join(', ')}`);

        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

          log.info(`Running tool: ${toolName}`, { args: toolArgs });

          const toolResult = await this.executeTool(toolName, toolArgs, currentUser);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // ── Follow-up call — AI forms final reply after tool result ──────
        completion = await this.createChatCompletion(
          {
            model: AI_MODEL,
            messages,
            tools: allTools,
            tool_choice: 'auto',
            max_tokens: 1024,
            temperature: 0.7,
          },
          log,
        );

        responseMessage = completion.choices[0]?.message;
      }

      const reply = stoppedOnIterationCap
        ? 'I was not able to finish that request in a reasonable number of steps. Please try rephrasing or breaking it into smaller requests.'
        : (responseMessage?.content ?? '');

      // Persist this turn so it's available as context on the user's next
      // message, from any device/tab. Tool-call intermediate messages
      // aren't stored — only the user's own message and the model's final
      // reply, matching what a human reading the chat actually sees.
      await this.saveMessage(currentUser, 'user', data.message);
      await this.saveMessage(currentUser, 'assistant', reply);

      log.info('AI Agent chat response received');

      return {
        success: true,
        message: 'Response generated successfully',
        data: {
          reply,
          session_id: data.session_id,
          usage: {
            input_tokens: completion.usage?.prompt_tokens ?? 0,
            output_tokens: completion.usage?.completion_tokens ?? 0,
            total_tokens: completion.usage?.total_tokens ?? 0,
          },
        },
      };
    } catch (err: any) {
      if (isGroqRateLimitError(err)) {
        log.warn('Groq rate limit hit (all configured keys exhausted)');
        return {
          success: false,
          message: 'Rate limit exceeded. Please try again in a moment.',
          data: null,
        };
      }

      const isTimeout = err?.name === 'APIConnectionTimeoutError' || err?.code === 'ETIMEDOUT';
      if (isTimeout) {
        log.warn('Groq API call timed out');
        return {
          success: false,
          message: 'The assistant took too long to respond. Please try again.',
          data: null,
        };
      }

      log.error('Groq API error', err, { message: err?.message });
      throw new Error('AI_AGENT_ERROR');
    }
  }
}
