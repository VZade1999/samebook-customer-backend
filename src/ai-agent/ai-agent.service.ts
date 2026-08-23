import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from 'src/common/logger/logger.service';
import { ChatDto } from './dto/chat.dto';
import { CustomerService } from 'src/customers/customers.service';
import { ProductService } from 'src/products/products.service';
import { CompanyService, CompanyRequester } from 'src/companies/companies.service';
import { QuotationService } from 'src/quotations/quotations.service';
import Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { allTools } from './tools';
import { SYSTEM_PROMPT } from './ai-agent.prompt';
import { UploadDocumentDto } from './dto/uploadDocument.dto';
import { DocumentExtractionError, extractTextFromDocument } from './document-extraction.util';
import { callGemini, GeminiRateLimitError } from './providers/gemini.adapter';

// Overridable via env so a model deprecation doesn't require a code
// change/redeploy — just an env var update.
const AI_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || 'gpt-oss-120b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

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

// How much of an uploaded document's extracted text gets persisted to
// history (chatWithDocument). It needs to survive into follow-up turns —
// e.g. the model asking a clarifying question about the customer, then
// needing the product list again once the user answers — so it can't be
// dropped entirely, but it's capped so one unusually large document can't
// dominate the token budget for the rest of the conversation.
const MAX_PERSISTED_DOCUMENT_CHARS = 3000;

// True for both of Groq/Cerebras's "you're over budget" shapes: HTTP 429
// (too many requests) and HTTP 413 with error.code 'rate_limit_exceeded'
// (a single request's token count exceeds the tokens-per-minute budget).
// Both are scoped to the API key that made the call, not global, so callers
// treat this as "try the next key" rather than an unrecoverable failure.
function isOpenAiCompatRateLimitError(err: any): boolean {
  if (err?.status === 429 || err?.status === 413) return true;
  if (err?.error?.code === 'rate_limit_exceeded') return true;
  const msg = String(err?.message ?? '');
  return msg.includes('429') || msg.includes('rate_limit_exceeded');
}

type CurrentUser = { company_id: number; user_id: number; permissions?: string[] };

// Matches the shape the manual quotation-create UI builds for
// payment_details_snapshot (frontend/src/modules/quotation/pages/index.tsx)
// so quotations created via chat render identically to ones created by hand.
function buildPaymentSnapshot(account: any): string {
  return JSON.stringify({
    bank_id: account.id,
    bank_name: account.bank_name,
    account_holder_name: account.account_holder_name,
    account_number: account.account_number,
    ifsc_code: account.ifsc_code,
    branch_name: account.branch_name,
    branch_address: account.branch_address,
    account_type: account.account_type,
    is_default: account.is_default,
  });
}

// Groq and Cerebras are both OpenAI-API-compatible (identical
// chat.completions.create shape), so they share one rotation pool with zero
// translation — just a different client instance and model name per slot.
interface ChatKeySlot {
  client: Groq | Cerebras;
  provider: 'cerebras' | 'groq';
  model: string;
  label: string; // for logging only — never the raw key
  cooldownUntil: number; // epoch ms; 0 = available now
}

interface GeminiKeySlot {
  apiKey: string;
  label: string;
  cooldownUntil: number;
}

@Injectable()
export class AiAgentService {
  // Tried in this order: Gemini (highest free TPM) → Cerebras/Groq pool
  // (in that array order) — so a Groq TPM ceiling stops being a dead end
  // the moment either of the other two is configured.
  private readonly geminiKeys: GeminiKeySlot[];
  private readonly chatKeys: ChatKeySlot[];
  private nextGeminiIndex = 0;
  private nextChatKeyIndex = 0;

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

    const parseKeys = (envValue: string | undefined) =>
      (envValue || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    // GEMINI_API_KEYS / GEMINI_API_KEY: tried first, before Cerebras/Groq.
    this.geminiKeys = parseKeys(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY).map(
      (apiKey, i) => ({ apiKey, label: `gemini#${i + 1}`, cooldownUntil: 0 }),
    );

    // CEREBRAS_API_KEYS / CEREBRAS_API_KEY, then GROQ_API_KEYS / GROQ_API_KEY
    // — merged into one pool, Cerebras entries first per the fallback order
    // above.
    const cerebrasSlots: ChatKeySlot[] = parseKeys(
      process.env.CEREBRAS_API_KEYS || process.env.CEREBRAS_API_KEY,
    ).map((apiKey, i) => ({
      client: new Cerebras({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: GROQ_MAX_RETRIES }),
      provider: 'cerebras',
      model: CEREBRAS_MODEL,
      label: `cerebras#${i + 1}`,
      cooldownUntil: 0,
    }));

    const groqSlots: ChatKeySlot[] = parseKeys(
      process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY,
    ).map((apiKey, i) => ({
      client: new Groq({ apiKey, timeout: GROQ_TIMEOUT_MS, maxRetries: GROQ_MAX_RETRIES }),
      provider: 'groq',
      model: AI_MODEL,
      label: `groq#${i + 1}`,
      cooldownUntil: 0,
    }));

    this.chatKeys = [...cerebrasSlots, ...groqSlots];

    if (this.geminiKeys.length === 0 && this.chatKeys.length === 0) {
      this.appLogger
        .forContext('AiAgentService', 'constructor')
        .error('No AI provider configured (GEMINI_API_KEY / CEREBRAS_API_KEY / GROQ_API_KEY)');
    }
  }

  // Tries Gemini first (own rotation/cooldown across its keys), then falls
  // through to the Cerebras+Groq pool (also rotated/cooled independently).
  // A provider is skipped entirely once none of its keys are available;
  // callers only see a failure once every configured provider/key is
  // exhausted or genuinely erroring.
  private async createChatCompletion(
    params: ChatCompletionCreateParamsNonStreaming,
    log: ReturnType<AppLogger['forContext']>,
  ): Promise<Groq.Chat.ChatCompletion> {
    if (this.geminiKeys.length === 0 && this.chatKeys.length === 0) {
      throw new Error('AI_AGENT_NOT_CONFIGURED');
    }

    let lastErr: any;

    // ── Gemini tier ─────────────────────────────────────────────────────
    const geminiTotal = this.geminiKeys.length;
    for (let attempt = 0; attempt < geminiTotal; attempt++) {
      const idx = (this.nextGeminiIndex + attempt) % geminiTotal;
      const slot = this.geminiKeys[idx];
      if (slot.cooldownUntil > Date.now()) continue;

      try {
        const result = await callGemini(slot.apiKey, GEMINI_MODEL, params.messages, params.tools ?? []);
        this.nextGeminiIndex = (idx + 1) % geminiTotal;
        return result;
      } catch (err: any) {
        const isRateLimit = err instanceof GeminiRateLimitError || isOpenAiCompatRateLimitError(err);
        slot.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_SECONDS * 1000;
        lastErr = err;
        log.warn(`Gemini ${slot.label} failed, falling back`, {
          isRateLimit,
          message: err?.message,
        });
      }
    }

    // ── Cerebras + Groq tier ────────────────────────────────────────────
    const chatTotal = this.chatKeys.length;
    for (let attempt = 0; attempt < chatTotal; attempt++) {
      const idx = (this.nextChatKeyIndex + attempt) % chatTotal;
      const slot = this.chatKeys[idx];

      if (slot.cooldownUntil > Date.now()) {
        continue;
      }

      try {
        // Groq's and Cerebras's SDKs have structurally near-identical but
        // not type-identical `create` overloads (both OpenAI-compatible at
        // the wire level) — cast at this one call site rather than
        // widening ChatKeySlot's type and losing per-provider safety
        // everywhere else.
        const client = slot.client as Groq;
        const result = await client.chat.completions.create({ ...params, model: slot.model });
        this.nextChatKeyIndex = (idx + 1) % chatTotal;
        return result as Groq.Chat.ChatCompletion;
      } catch (err: any) {
        lastErr = err;

        if (isOpenAiCompatRateLimitError(err)) {
          const retryAfterHeader = err?.headers?.get?.('retry-after');
          const cooldownSeconds =
            Number(retryAfterHeader) > 0 ? Number(retryAfterHeader) : DEFAULT_COOLDOWN_SECONDS;
          slot.cooldownUntil = Date.now() + cooldownSeconds * 1000;

          log.warn(`${slot.provider} ${slot.label} rate-limited, cooling down`, {
            cooldownSeconds,
            keysAvailable: chatTotal,
          });
          continue;
        }

        // A non-rate-limit error (bad model name, transient network issue,
        // etc.) on one provider shouldn't stop other configured
        // providers/keys from being tried — only propagate once every slot
        // in this tier has been exhausted (below the loop).
        log.warn(`${slot.provider} ${slot.label} failed, trying next provider/key`, {
          message: err?.message,
        });
      }
    }

    // Every provider/key is currently cooling down or erroring.
    throw lastErr ?? new Error('AI_AGENT_ALL_PROVIDERS_UNAVAILABLE');
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
      // rule as the company tools. Contact person / address / bank account
      // auto-resolve when there's only one option (or one marked
      // default/primary); when there's genuinely more than one and the
      // model didn't specify, this returns a needsSelection response
      // instead of creating anything, guiding the model to ask the user
      // rather than silently picking one.
      case 'create_quotation': {
        const customerResult = await this.customerService.getCustomerDetails(
          args.customer_id,
          currentUser,
        );
        if (!customerResult.success) {
          return JSON.stringify({ success: false, message: customerResult.message, data: null });
        }
        const contacts = (customerResult.data as any)?.contacts ?? [];
        const addresses = (customerResult.data as any)?.addresses ?? [];

        // ── Contact person ──────────────────────────────────────────────
        let contactPersonId = args.contact_person_id;
        if (!contactPersonId && contacts.length === 1) {
          contactPersonId = contacts[0].id;
        } else if (!contactPersonId && contacts.length > 1) {
          return JSON.stringify({
            success: false,
            needsSelection: 'contact_person_id',
            message: `This customer has multiple contacts — ask the user which one to use, then call create_quotation again with contact_person_id set: ${contacts
              .map((c: any) => `${c.first_name} ${c.last_name} (id ${c.id})`)
              .join(', ')}`,
          });
        }

        // ── Billing / shipping address ──────────────────────────────────
        let billingAddressId = args.billing_address_id;
        let shippingAddressId = args.shipping_address_id;
        if ((!billingAddressId || !shippingAddressId) && addresses.length > 1) {
          const defaultAddress = addresses.find((a: any) => a.is_primary);
          if (defaultAddress) {
            billingAddressId = billingAddressId ?? defaultAddress.id;
            shippingAddressId = shippingAddressId ?? defaultAddress.id;
          } else {
            return JSON.stringify({
              success: false,
              needsSelection: 'billing_address_id',
              message: `This customer has multiple addresses with none marked primary — ask the user which one to use, then call create_quotation again with billing_address_id/shipping_address_id set: ${addresses
                .map((a: any) => `${a.label || a.address_type} in ${a.city} (id ${a.id})`)
                .join(', ')}`,
            });
          }
        } else if (!billingAddressId || !shippingAddressId) {
          const onlyAddress = addresses[0];
          billingAddressId = billingAddressId ?? onlyAddress?.id;
          shippingAddressId = shippingAddressId ?? onlyAddress?.id;
        }

        // ── Bank account (payment details shown on the quotation) ───────
        let paymentDetailsSnapshot: string | undefined;
        if (args.bank_account_id !== undefined) {
          const companyResult = await this.companyService.getCompanyById(currentUser.company_id, {
            companyId: currentUser.company_id,
          });
          const bankAccounts = (companyResult.data as any)?.bank_accounts ?? [];
          const chosen = bankAccounts.find((b: any) => b.id === args.bank_account_id);
          if (chosen) paymentDetailsSnapshot = buildPaymentSnapshot(chosen);
        } else {
          const companyResult = await this.companyService.getCompanyById(currentUser.company_id, {
            companyId: currentUser.company_id,
          });
          const bankAccounts = (companyResult.data as any)?.bank_accounts ?? [];
          if (bankAccounts.length === 1) {
            paymentDetailsSnapshot = buildPaymentSnapshot(bankAccounts[0]);
          } else if (bankAccounts.length > 1) {
            const defaultAccount = bankAccounts.find((b: any) => b.is_default);
            if (defaultAccount) {
              paymentDetailsSnapshot = buildPaymentSnapshot(defaultAccount);
            } else {
              return JSON.stringify({
                success: false,
                needsSelection: 'bank_account_id',
                message: `The company has multiple bank accounts with none marked default — ask the user which one to show as payment details, then call create_quotation again with bank_account_id set: ${bankAccounts
                  .map((b: any) => `${b.bank_name} ****${String(b.account_number || '').slice(-4)} (id ${b.id})`)
                  .join(', ')}`,
              });
            }
          }
          // 0 bank accounts configured: quotation just goes out without
          // payment details, same as the manual UI when none are set up.
        }

        const result = await this.quotationService.createQuotation({
          ...args,
          quotation_date: args.quotation_date || new Date().toISOString().slice(0, 10),
          contact_person_id: contactPersonId,
          billing_address_id: billingAddressId,
          shipping_address_id: shippingAddressId,
          ...(paymentDetailsSnapshot && { payment_details_snapshot: paymentDetailsSnapshot }),
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
      if (err instanceof GeminiRateLimitError || isOpenAiCompatRateLimitError(err)) {
        log.warn('AI provider rate limit hit (all configured providers/keys exhausted)');
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

  // =========================
  // CHAT WITH DOCUMENT
  // =========================
  // Extracts text from an uploaded image/PDF (see document-extraction.util)
  // and routes it through the exact same chat()/tool-calling flow used for
  // regular messages — no separate agent logic.
  async chatWithDocument(data: UploadDocumentDto, currentUser: CurrentUser) {
    const log = this.appLogger.forContext('AiAgentService', 'chatWithDocument', {
      session_id: data.session_id ?? 'no-session',
      company_id: currentUser.company_id,
    });

    let extractedText: string;
    try {
      extractedText = await extractTextFromDocument(data.document, data.document_mime_type);
    } catch (err: any) {
      if (err instanceof DocumentExtractionError) {
        log.warn('Document extraction failed', { message: err.message });
        return { success: false, message: err.message, data: null };
      }
      log.error('Unexpected error extracting document text', err);
      throw new Error('AI_AGENT_ERROR');
    }

    const docLabel = data.document_name || 'uploaded document';
    const instruction =
      data.message?.trim() ||
      'Create a quotation based on the customer and product details in this document. ' +
        'Identify the customer (search by phone number or name first; if none is found, ask me for their details before creating a quotation). ' +
        'For each item, search existing products for a match; only create a new product if none exists. ' +
        'Then create the quotation as a draft for review.';

    // The extracted text is what actually needs to persist across turns —
    // a customer/product ambiguity the model has to ask about means the
    // *next* message relies on this same content still being in history.
    // Capped so one unusually large document can't blow the per-request
    // token budget for the next several turns of the conversation.
    const cappedText =
      extractedText.length > MAX_PERSISTED_DOCUMENT_CHARS
        ? `${extractedText.slice(0, MAX_PERSISTED_DOCUMENT_CHARS)}\n[...truncated]`
        : extractedText;

    const persistedMessage = `${instruction}\n\n📎 [Extracted text from uploaded document "${docLabel}"]:\n---\n${cappedText}\n---`;

    return this.chat(
      { message: persistedMessage, session_id: data.session_id },
      currentUser,
    );
  }
}
