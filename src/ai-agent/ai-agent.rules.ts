// Pure rules for the AI Assistant: who may use which ability, what waits for a
// confirmation, daily limits, named periods, chat titles, record links and a
// few small formatters. No database here, so it is unit-tested.

import { addDays, isIsoDate } from '../dashboard/dashboard.rules';

/** The add-on key (Apps & Add-ons) and the assistant's own permissions. */
export const AI_MODULE = 'ai_agent';
export const AI_PERMS = {
  view: 'ai_agent.view',
  use: 'ai_agent.use',
  configure: 'ai_agent.configure',
} as const;

/** Unconfirmed actions expire after this many minutes. */
export const CONFIRM_TTL_MINUTES = 30;
export const DEFAULT_DAILY_LIMIT = 100;
export const MAX_DAILY_LIMIT = 2000;
/** Messages of a chat handed back to the AI as context. */
export const HISTORY_MESSAGES = 12;
/** Longest answer (characters) one ability may hand the AI. */
export const TOOL_RESULT_MAX_CHARS = 7000;
/** Most steps (rounds of abilities) the AI may take for one message. */
export const MAX_STEPS = 8;
export const TITLE_MAX = 60;
export const MESSAGE_MAX = 4000;
/** How much text of an uploaded document is kept with the chat. */
export const DOCUMENT_TEXT_MAX = 6000;

export type ToolKind = 'read' | 'write' | 'confirm';
export type ActionStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type RecordType = 'customer' | 'product' | 'quotation' | 'challan' | 'invoice' | 'warehouse' | 'company' | 'purchase_order' | 'supplier_bill' | 'customer_ledger' | 'supplier_ledger' | 'expense';

// ── Settings ────────────────────────────────────────────────────────────────

export interface AiSettings {
  /** May the assistant change anything? Off = it can only look things up. */
  allow_changes: boolean;
  /** Messages one person may send per day. */
  daily_limit: number;
}

export const DEFAULT_SETTINGS: AiSettings = { allow_changes: true, daily_limit: DEFAULT_DAILY_LIMIT };

/** A settings row (or none) → settings with defaults. */
export const settingsFrom = (row: { allow_changes?: unknown; daily_limit?: unknown } | null | undefined): AiSettings => {
  if (!row) return { ...DEFAULT_SETTINGS };
  const limit = Number(row.daily_limit);
  return {
    allow_changes: Number(row.allow_changes) !== 0,
    daily_limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_DAILY_LIMIT) : DEFAULT_DAILY_LIMIT,
  };
};

/** The settings form: only the fields sent change. */
export function parseSettings(body: any): { ok: true; value: Partial<AiSettings> } | { ok: false; message: string } {
  const value: Partial<AiSettings> = {};
  if (body?.allow_changes !== undefined) {
    const v = body.allow_changes;
    if (![true, false, 0, 1].includes(v)) return { ok: false, message: 'Choose whether the assistant may change data' };
    value.allow_changes = v === true || v === 1;
  }
  if (body?.daily_limit !== undefined) {
    const n = Number(body.daily_limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAILY_LIMIT) {
      return { ok: false, message: `Pick a daily limit from 1 to ${MAX_DAILY_LIMIT} messages` };
    }
    value.daily_limit = n;
  }
  if (!Object.keys(value).length) return { ok: false, message: 'Nothing to change' };
  return { ok: true, value };
}

/** Messages sent today against the limit. */
export const usageToday = (sent: number, limit: number) => {
  const s = Math.max(0, Math.floor(Number(sent) || 0));
  return { sent: s, limit, left: Math.max(0, limit - s), blocked: s >= limit };
};

// ── Who may use which ability ───────────────────────────────────────────────

const AREA_LABEL: Record<string, string> = {
  customers: 'customers',
  products: 'products',
  quotations: 'quotations',
  challans: 'delivery challans',
  invoices: 'invoices',
  companies: 'company details',
  dashboard: 'dashboard',
  warehouses: 'warehouses',
  categories: 'categories',
  ai_agent: 'AI Assistant',
};
const SPECIAL_LABEL: Record<string, string> = {
  'invoices.insides': 'Invoice insights',
  'stock.manage': 'Manage stock',
  'quotations.send': 'Send quotations',
  'challans.dispatch': 'Dispatch challans',
  'dashboard.view': 'View dashboard',
  'companies.view': 'View company',
  'companies.edit': 'Edit company',
  'ai_agent.view': 'View AI Assistant',
  'ai_agent.use': 'Use AI Assistant',
  'ai_agent.configure': 'Configure AI Assistant',
};

/** "customers.delete" → "Delete customers" (the names people see on the Roles page). */
export const permissionLabel = (p: string): string => {
  if (SPECIAL_LABEL[p]) return SPECIAL_LABEL[p];
  const [area, action] = String(p).split('.');
  if (!action) return p;
  const verb = action.charAt(0).toUpperCase() + action.slice(1);
  return `${verb} ${AREA_LABEL[area] || area}`;
};

export interface ToolGate {
  permissions: string[];
  kind: ToolKind;
  /** Add-on the ability belongs to, if any. */
  module?: string;
}

export interface Caller {
  permissions: string[];
  /** Add-ons the company has switched on. */
  modules: string[];
  allowChanges: boolean;
}

/** Why this person can't use an ability right now, or null when they can. */
export function toolBlock(tool: ToolGate, caller: Caller): string | null {
  if (tool.module && !caller.modules.includes(tool.module)) return `That needs an add-on your company hasn't switched on`;
  const missing = tool.permissions.filter((p) => !caller.permissions.includes(p));
  if (missing.length) {
    return `You need the "${missing.map(permissionLabel).join('" and "')}" permission${missing.length > 1 ? 's' : ''} for that — ask your admin`;
  }
  if (tool.kind !== 'read' && !caller.allowChanges) {
    return 'Your admin has set the assistant to look things up only — it can’t make changes';
  }
  return null;
}

/** Money totals (sales, collections, dues) follow the Dashboard: invoices.view + invoices.insides. */
export const seesMoney = (permissions: string[]) => permissions.includes('invoices.view') && permissions.includes('invoices.insides');

// ── Confirm / cancel ────────────────────────────────────────────────────────

export interface ActionFacts {
  status: string;
  user_id: number;
  expires_at: string | Date | null;
}

const PAST: Record<string, string> = {
  RUNNING: 'is already running',
  DONE: 'was already done',
  FAILED: 'already ran and failed',
  CANCELLED: 'was cancelled',
  EXPIRED: 'expired',
};

/** Why an action can't be confirmed (or cancelled) by this person now, or null. */
export function decisionBlock(action: ActionFacts, userId: number, now: Date): string | null {
  if (Number(action.user_id) !== Number(userId)) return 'Only the person who asked can confirm or cancel this';
  if (action.status !== 'PENDING') return `This action ${PAST[action.status] || 'is no longer waiting'}`;
  if (isExpired(action.expires_at, now)) return 'This action expired — ask the assistant again';
  return null;
}

export const isExpired = (expiresAt: string | Date | null | undefined, now: Date) => {
  if (!expiresAt) return false;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt).replace(' ', 'T') + (String(expiresAt).endsWith('Z') ? '' : 'Z'));
  return Number.isFinite(t) && t <= now.getTime();
};

// ── Chats ───────────────────────────────────────────────────────────────────

/** A chat's title from its first message: one line, no attachment marker, short. */
export function chatTitle(message: string, documentName?: string | null): string {
  const firstLine =
    String(message || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  let t = firstLine.replace(/\s+/g, ' ');
  if (!t && documentName) t = `Document: ${documentName}`;
  if (!t) return 'New chat';
  if (t.length > TITLE_MAX) t = `${t.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '') || t.slice(0, TITLE_MAX - 1)}…`;
  return t;
}

// ── Periods ─────────────────────────────────────────────────────────────────

export const PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_financial_year',
  'last_financial_year',
  'last_7_days',
  'last_30_days',
  'last_90_days',
] as const;
export type Period = (typeof PERIODS)[number];

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (date: string) => addDays(ymd(Number(date.slice(0, 4)), Number(date.slice(5, 7)) + 1, 1), -1);

/**
 * A named period → dates (inclusive), ending no later than today. Weeks start
 * on Monday; quarters and the financial year follow India's April–March year.
 */
export function periodRange(period: unknown, today: string): { from: string; to: string } | null {
  if (!isIsoDate(today)) return null;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const fyStartYear = m >= 4 ? y : y - 1;
  // Indian quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
  const qStartMonth = m >= 4 ? 4 + Math.floor((m - 4) / 3) * 3 : 1;
  const qStart = ymd(y, qStartMonth, 1);
  switch (String(period)) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: addDays(today, -dow), to: today };
    case 'last_week':
      return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
    case 'this_month':
      return { from: monthStart(today), to: today };
    case 'last_month': {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case 'this_quarter':
      return { from: qStart, to: today };
    case 'last_quarter': {
      const end = addDays(qStart, -1);
      const em = Number(end.slice(5, 7));
      const sm = em >= 4 ? 4 + Math.floor((em - 4) / 3) * 3 : 1;
      return { from: ymd(Number(end.slice(0, 4)), sm, 1), to: monthEnd(end) };
    }
    case 'this_financial_year':
      return { from: ymd(fyStartYear, 4, 1), to: today };
    case 'last_financial_year':
      return { from: ymd(fyStartYear - 1, 4, 1), to: ymd(fyStartYear, 3, 31) };
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'last_90_days':
      return { from: addDays(today, -89), to: today };
    default:
      return null;
  }
}

// ── Records, arguments and small formatters ─────────────────────────────────

/** Where a record opens in the app. */
export function recordLink(type: RecordType, id: number): string {
  switch (type) {
    case 'customer':
      return `/app/customers?open=${id}`;
    case 'product':
      return `/app/products?open=${id}`;
    case 'quotation':
      return `/app/quotation?open=${id}`;
    case 'challan':
      return `/app/delivery-challans?open=${id}`;
    case 'invoice':
      return `/app/invoice?open=${id}`;
    case 'warehouse':
      return `/app/warehouses?warehouse=${id}`;
    case 'purchase_order':
      return `/app/purchase-orders?open=${id}`;
    case 'supplier_bill':
      return `/app/purchase-bills?open=${id}`;
    case 'customer_ledger':
      return `/app/ledger?party=customer:${id}`;
    case 'supplier_ledger':
      return `/app/ledger?party=supplier:${id}`;
    case 'expense':
      return `/app/expenses?open=expense:${id}`;
    default:
      return '/app/companies';
  }
}

/** Only the arguments an ability declares (identity never comes from the AI). */
export function pickArgs(allowed: string[], args: unknown): Record<string, any> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const out: Record<string, any> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(args, key) && (args as any)[key] !== undefined && (args as any)[key] !== null) {
      out[key] = (args as any)[key];
    }
  }
  return out;
}

/** A positive whole id, or null. */
export const idOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A whole number within bounds, else the default. */
export const intIn = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Trimmed text of at most `max` characters, or null when empty. */
export const textOf = (v: unknown, max = 200): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Indian mobile numbers: "+91 98765-43210" → "9876543210"; null when not one. */
export const indianPhone = (v: unknown): string | null => {
  let d = String(v ?? '').replace(/[^\d]/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};

export const isEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());

/** ₹ in Indian grouping: 125000.5 → "₹1,25,000.50"; whole rupees drop the paise. */
export const inr = (v: unknown): string => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  const whole = Number.isInteger(n);
  return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** Masks all but the last 4 digits of an account number. */
export const maskAccount = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (!s) return null;
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
};

/**
 * JSON for the AI, trimmed to fit: the longest arrays lose items (with a note
 * of how many were left out) until the text is short enough.
 */
export function fitJson(value: unknown, max = TOOL_RESULT_MAX_CHARS): string {
  let text = JSON.stringify(value);
  if (text.length <= max || !value || typeof value !== 'object') return text.length <= max ? text : `${text.slice(0, max - 20)}…[cut]`;
  const copy: any = JSON.parse(text);
  const arrays: { owner: any; key: string }[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (Array.isArray(node[key])) arrays.push({ owner: node, key });
      if (node[key] && typeof node[key] === 'object') walk(node[key]);
    }
  };
  walk(copy);
  for (let guard = 0; guard < 500 && text.length > max; guard++) {
    const longest = arrays
      .filter((a) => Array.isArray(a.owner[a.key]) && a.owner[a.key].length > 1)
      .sort((a, b) => JSON.stringify(b.owner[b.key]).length - JSON.stringify(a.owner[a.key]).length)[0];
    if (!longest) break;
    const list = longest.owner[longest.key];
    const keep = Math.max(1, Math.floor(list.length * 0.7));
    const dropped = list.length - keep;
    longest.owner[longest.key] = list.slice(0, keep);
    const noteKey = `${longest.key}_not_shown`;
    longest.owner[noteKey] = (Number(longest.owner[noteKey]) || 0) + dropped;
    text = JSON.stringify(copy);
  }
  return text.length <= max ? text : `${text.slice(0, max - 20)}…[cut]`;
}

// ── Suggestions on the empty chat ───────────────────────────────────────────

export interface Suggestion {
  title: string;
  prompt: string;
}

/** Starter questions, picked from what this person may actually do. */
export function suggestionsFor(permissions: string[], allowChanges: boolean): Suggestion[] {
  const has = (p: string) => permissions.includes(p);
  const out: Suggestion[] = [];
  if (has('dashboard.view') && seesMoney(permissions)) {
    out.push({ title: 'How is this month going?', prompt: 'How are sales and collections this month compared with last month?' });
  } else if (has('dashboard.view')) {
    out.push({ title: 'This month at a glance', prompt: 'Give me a quick overview of this month: quotations, challans and stock alerts.' });
  }
  // Accounts (add-on): its permissions exist only while it is on.
  if (has('accounts.view')) out.push({ title: 'Cash, bank and dues', prompt: 'How much do I have in cash and bank, who owes me the most, and whom do I owe?' });
  if (has('invoices.view')) out.push({ title: 'Who owes us money?', prompt: 'Which invoices are overdue? Show the biggest balances first.' });
  if (has('quotations.view')) out.push({ title: 'Quotations expiring soon', prompt: 'Which open quotations expire in the next 7 days?' });
  if (has('products.view')) out.push({ title: 'Running low on stock', prompt: 'Which products are low or out of stock, and where are they kept?' });
  if (allowChanges && has('quotations.create')) {
    out.push({ title: 'Make a quotation', prompt: 'Create a quotation for ' });
  }
  if (has('challans.view')) out.push({ title: 'Ready to invoice', prompt: 'Which delivery challans are dispatched but not invoiced yet?' });
  if (has('customers.view')) out.push({ title: 'Find a customer', prompt: 'Show me the details and recent documents of customer ' });
  return out.slice(0, 6);
}
