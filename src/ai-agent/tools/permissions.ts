import Groq from 'groq-sdk';
import { allTools } from './index';

// Tool name → permission(s) the caller must hold (ALL of them), mirroring
// the @RequirePermissions on the equivalent REST endpoint so the AI agent
// can never do more than the user could do through the normal UI/API.
//
// Customers: the customers REST controller currently enforces no
// @RequirePermissions at all, so every customer tool requires only
// 'customers.view' (the permission the frontend gates the customers page
// with). Tighten to customers.create/edit/delete once the REST side does.
export const TOOL_PERMISSIONS: Record<string, string[]> = {
  // ── Customers ────────────────────────────────────────────────────────
  get_customers_list: ['customers.view'],
  create_customer: ['customers.view'],
  update_customer: ['customers.view'],
  delete_customer: ['customers.view'],

  // ── Products ─────────────────────────────────────────────────────────
  get_products_list: ['products.view'],
  create_product: ['products.create'],
  update_product: ['products.edit'],
  delete_product: ['products.delete'],

  // ── Company ──────────────────────────────────────────────────────────
  get_company_details: ['companies.view'],
  get_company_addresses: ['companies.view'],
  get_company_locations: ['companies.view'],
  update_company: ['companies.edit'],

  // ── Quotations ───────────────────────────────────────────────────────
  get_quotations_list: ['quotations.view'],
  get_quotation_details: ['quotations.view'],
  get_quotation_history: ['quotations.view'],
  get_quotation_timeline: ['quotations.view'],
  create_quotation: ['quotations.create'],
  update_quotation: ['quotations.edit'],
  send_quotation: ['quotations.send'],
  delete_quotation: ['quotations.delete'],
};

// Fail closed: a tool with no entry in TOOL_PERMISSIONS is never allowed.
export function hasToolPermission(toolName: string, userPermissions: string[] | undefined): boolean {
  const required = TOOL_PERMISSIONS[toolName];
  if (!required) return false;
  const granted = userPermissions ?? [];
  return required.every((p) => granted.includes(p));
}

// Only the tool definitions this user may call are sent to the LLM, so the
// model never offers actions the user isn't permitted to perform.
export function getPermittedTools(userPermissions: string[] | undefined): Groq.Chat.ChatCompletionTool[] {
  return allTools.filter((t) => !!t.function && hasToolPermission(t.function.name, userPermissions));
}

// Top-level argument names each tool declares in its JSON schema.
const TOOL_ARG_ALLOWLIST: Record<string, Set<string>> = Object.fromEntries(
  allTools.filter((t) => !!t.function).map((t) => [
    t.function!.name,
    new Set(Object.keys((t.function!.parameters as any)?.properties ?? {})),
  ]),
);

// Strips any model-provided argument not declared in the tool's schema
// (company_id, user_id, created_by, is_active, ...) so the model can't
// smuggle extra fields through to the underlying services.
export function pickDeclaredToolArgs(toolName: string, args: unknown): Record<string, any> {
  const allowed = TOOL_ARG_ALLOWLIST[toolName];
  if (!allowed || !args || typeof args !== 'object' || Array.isArray(args)) return {};
  const picked: Record<string, any> = {};
  for (const [key, value] of Object.entries(args as Record<string, any>)) {
    if (allowed.has(key)) picked[key] = value;
  }
  return picked;
}
