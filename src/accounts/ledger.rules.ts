/**
 * Accounts (the ledger): pure rules — no database here, all tested.
 *
 * Books are double-entry underneath, with Tally-style groups. Documents stay
 * the source: an invoice, a payment received, a supplier bill or a payment made
 * is turned into an entry (a voucher) whose lines always add up: Dr = Cr.
 * Customers and suppliers are sub-ledgers of "Sundry Debtors" / "Sundry
 * Creditors": each such line also carries the party.
 *
 * All money maths is in paise (whole numbers), so totals never drift.
 */

export const ACCOUNTS_MODULE = 'accounts';
export const ACCOUNTS_PERMS = {
  view: 'accounts.view',
  record: 'accounts.record',
  reports: 'accounts.reports',
} as const;

export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Rupees → paise (whole number). */
export const P = (v: unknown) => Math.round(num(v) * 100);
/** Paise → rupees (2 decimals). */
export const R = (p: number) => Math.round(p) / 100;

// ── Groups and the accounts every company has ──────────────────────────────

export type Nature = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';

export const GROUPS = {
  CAPITAL: { name: 'Capital Account', nature: 'LIABILITY' },
  LOANS: { name: 'Loans (Liability)', nature: 'LIABILITY' },
  CURRENT_LIABILITIES: { name: 'Current Liabilities', nature: 'LIABILITY' },
  DUTIES_TAXES: { name: 'Duties & Taxes', nature: 'LIABILITY' },
  SUNDRY_CREDITORS: { name: 'Sundry Creditors', nature: 'LIABILITY' },
  SUSPENSE: { name: 'Suspense', nature: 'LIABILITY' },
  FIXED_ASSETS: { name: 'Fixed Assets', nature: 'ASSET' },
  CURRENT_ASSETS: { name: 'Current Assets', nature: 'ASSET' },
  SUNDRY_DEBTORS: { name: 'Sundry Debtors', nature: 'ASSET' },
  CASH_IN_HAND: { name: 'Cash-in-hand', nature: 'ASSET' },
  BANK_ACCOUNTS: { name: 'Bank Accounts', nature: 'ASSET' },
  LOANS_ADVANCES: { name: 'Loans & Advances (Asset)', nature: 'ASSET' },
  SALES: { name: 'Sales Accounts', nature: 'INCOME' },
  DIRECT_INCOMES: { name: 'Direct Incomes', nature: 'INCOME' },
  INDIRECT_INCOMES: { name: 'Indirect Incomes', nature: 'INCOME' },
  PURCHASES: { name: 'Purchase Accounts', nature: 'EXPENSE' },
  DIRECT_EXPENSES: { name: 'Direct Expenses', nature: 'EXPENSE' },
  INDIRECT_EXPENSES: { name: 'Indirect Expenses', nature: 'EXPENSE' },
} as const satisfies Record<string, { name: string; nature: Nature }>;
export type GroupCode = keyof typeof GROUPS;
export const isGroup = (g: unknown): g is GroupCode => typeof g === 'string' && Object.prototype.hasOwnProperty.call(GROUPS, g);

/** The accounts the books need, made for each company on first use. Keyed by code. */
export const SYSTEM_ACCOUNTS: Record<string, { name: string; group: GroupCode }> = {
  DEBTORS: { name: 'Customers (Sundry Debtors)', group: 'SUNDRY_DEBTORS' },
  CREDITORS: { name: 'Suppliers (Sundry Creditors)', group: 'SUNDRY_CREDITORS' },
  CASH: { name: 'Cash', group: 'CASH_IN_HAND' },
  SALES: { name: 'Sales', group: 'SALES' },
  TRANSPORT_INCOME: { name: 'Transport charged on invoices', group: 'SALES' },
  OUTPUT_CGST: { name: 'Output CGST', group: 'DUTIES_TAXES' },
  OUTPUT_SGST: { name: 'Output SGST', group: 'DUTIES_TAXES' },
  OUTPUT_IGST: { name: 'Output IGST', group: 'DUTIES_TAXES' },
  INPUT_CGST: { name: 'Input CGST', group: 'DUTIES_TAXES' },
  INPUT_SGST: { name: 'Input SGST', group: 'DUTIES_TAXES' },
  INPUT_IGST: { name: 'Input IGST', group: 'DUTIES_TAXES' },
  PURCHASES: { name: 'Purchases', group: 'PURCHASES' },
  FREIGHT_INWARD: { name: 'Freight on purchases', group: 'DIRECT_EXPENSES' },
  ROUND_OFF: { name: 'Round off', group: 'INDIRECT_EXPENSES' },
  CAPITAL: { name: 'Capital', group: 'CAPITAL' },
  OPENING_DIFF: { name: 'Difference in opening balances', group: 'SUSPENSE' },
};

/** A bank account's ledger code; 0 = "a bank" when the company has none saved. */
export const bankCode = (bankAccountId: unknown) => `BANK:${Number(bankAccountId) > 0 ? Number(bankAccountId) : 0}`;
export const bankIdOf = (code: string) => (/^BANK:\d+$/.test(code) ? Number(code.slice(5)) : null);

/** "HDFC Bank …4369" — enough to tell accounts apart, never the full number. */
export const bankLabel = (b: { bank_name?: unknown; account_number?: unknown } | null | undefined) => {
  const name = String(b?.bank_name ?? '').trim().replace(/\s+/g, ' ') || 'Bank';
  const digits = String(b?.account_number ?? '').replace(/\s+/g, '');
  return digits.length >= 4 ? `${name} …${digits.slice(-4)}` : name;
};

// ── Entries ────────────────────────────────────────────────────────────────

export type PartyType = 'CUSTOMER' | 'SUPPLIER';
export type EntryType = 'SALES' | 'RECEIPT' | 'PURCHASE' | 'PAYMENT' | 'EXPENSE' | 'JOURNAL' | 'CONTRA' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'OPENING';
export type SourceType =
  | 'INVOICE'
  | 'INVOICE_PAYMENT'
  | 'CUSTOMER_RECEIPT'
  | 'EXPENSE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'CUSTOMER_REFUND'
  | 'PURCHASE_BILL'
  | 'SUPPLIER_PAYMENT'
  | 'OPENING_CUSTOMER'
  | 'OPENING_SUPPLIER'
  | 'OPENING_CASH'
  | 'OPENING_BANK'
  | 'OPENING_ACCOUNT'
  | 'MANUAL';
export const OPENING_SOURCES: SourceType[] = ['OPENING_CUSTOMER', 'OPENING_SUPPLIER', 'OPENING_CASH', 'OPENING_BANK', 'OPENING_ACCOUNT'];
/** Lines name an account by its code (SALES, CASH, BANK:5…) or by id ("ID:12") for accounts you made. */
export const accountRef = (accountId: number) => `ID:${accountId}`;

export const ENTRY_WORD: Record<EntryType, string> = {
  SALES: 'Invoice',
  RECEIPT: 'Payment received',
  PURCHASE: 'Supplier bill',
  PAYMENT: 'Payment made',
  EXPENSE: 'Expense',
  JOURNAL: 'Journal',
  CONTRA: 'Transfer',
  CREDIT_NOTE: 'Credit note',
  DEBIT_NOTE: 'Debit note',
  OPENING: 'Opening balance',
};

export interface Party {
  type: PartyType;
  id: number;
}
/** One line of an entry, in paise: either dr or cr is above zero. */
export interface PostLine {
  code: string;
  party?: Party | null;
  dr: number;
  cr: number;
}
export interface Posting {
  entry_type: EntryType;
  date: string;
  number: string | null;
  party: Party | null;
  narration: string;
  lines: PostLine[];
  /** Total of the debit side, in paise. */
  amount: number;
}

/** A line on the given side; a negative amount lands on the other side. Zero → none. */
const line = (code: string, paise: number, side: 'dr' | 'cr', party?: Party | null): PostLine[] => {
  const p = Math.round(paise);
  if (!p) return [];
  const s = p > 0 ? side : side === 'dr' ? 'cr' : 'dr';
  const a = Math.abs(p);
  return [{ code, party: party || null, dr: s === 'dr' ? a : 0, cr: s === 'cr' ? a : 0 }];
};

/**
 * Lines that add up: lines of the same account and party are merged (netted),
 * and any difference left (old documents that don't add up to the paisa) goes
 * to Round off, so Dr always equals Cr.
 */
export function balanced(lines: PostLine[]): PostLine[] {
  const merged = new Map<string, PostLine>();
  for (const l of lines) {
    const key = `${l.code}|${l.party ? `${l.party.type}:${l.party.id}` : ''}`;
    const m = merged.get(key);
    if (m) {
      m.dr += l.dr;
      m.cr += l.cr;
    } else merged.set(key, { code: l.code, party: l.party || null, dr: l.dr, cr: l.cr });
  }
  const out: PostLine[] = [];
  for (const m of merged.values()) {
    const net = m.dr - m.cr;
    if (net) out.push({ code: m.code, party: m.party, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 });
  }
  const diff = out.reduce((s, l) => s + l.dr - l.cr, 0);
  if (diff) {
    const ro = out.find((l) => l.code === 'ROUND_OFF');
    if (ro) {
      const net = ro.dr - ro.cr - diff;
      ro.dr = net > 0 ? net : 0;
      ro.cr = net < 0 ? -net : 0;
      if (!net) out.splice(out.indexOf(ro), 1);
    } else out.push({ code: 'ROUND_OFF', party: null, dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 });
  }
  return out;
}

const totalDr = (lines: PostLine[]) => lines.reduce((s, l) => s + l.dr, 0);
const money = (p: number) => `₹${R(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MODE_WORD: Record<string, string> = { CASH: 'cash', BANK_TRANSFER: 'bank transfer', CHEQUE: 'cheque', UPI: 'UPI', CARD: 'card' };
const modeWord = (m: unknown) => MODE_WORD[String(m ?? '').toUpperCase()] || String(m ?? '').toLowerCase() || 'payment';
/** Where money went in or came out: cash, or a bank account (the default bank when none was named). */
export const moneyAccount = (mode: unknown, bankAccountId: unknown, defaultBankId: unknown) =>
  String(mode ?? '').toUpperCase() === 'CASH' ? 'CASH' : bankCode(Number(bankAccountId) > 0 ? bankAccountId : defaultBankId);

/** A sales invoice: the customer owes the total; sales, transport and output GST are credited. */
export function invoicePosting(inv: {
  invoice_number?: unknown;
  invoice_date: string;
  customer_id: unknown;
  sub_total?: unknown;
  discount_amount?: unknown;
  transport_charges?: unknown;
  cgst_amount?: unknown;
  sgst_amount?: unknown;
  igst_amount?: unknown;
  grand_total?: unknown;
}): Posting {
  const party: Party = { type: 'CUSTOMER', id: Number(inv.customer_id) };
  const goods = P(inv.sub_total) - P(inv.discount_amount);
  const transport = P(inv.transport_charges);
  const gst = P(inv.cgst_amount) + P(inv.sgst_amount) + P(inv.igst_amount);
  const lines = balanced([
    ...line('DEBTORS', P(inv.grand_total), 'dr', party),
    ...line('SALES', goods, 'cr'),
    ...line('TRANSPORT_INCOME', transport, 'cr'),
    ...line('OUTPUT_CGST', P(inv.cgst_amount), 'cr'),
    ...line('OUTPUT_SGST', P(inv.sgst_amount), 'cr'),
    ...line('OUTPUT_IGST', P(inv.igst_amount), 'cr'),
  ]);
  const parts = [`Goods ${money(goods)}`, gst ? `GST ${money(gst)}` : null, transport ? `transport ${money(transport)}` : null].filter(Boolean);
  return { entry_type: 'SALES', date: inv.invoice_date, number: inv.invoice_number ? String(inv.invoice_number) : null, party, narration: parts.join(' · '), lines, amount: totalDr(lines) };
}

/** A payment received against an invoice: money in (cash or bank), the customer owes less. */
export function invoicePaymentPosting(
  p: { payment_date: string; payment_amount: unknown; payment_mode?: unknown; transaction_reference?: unknown; bank_account_id?: unknown; invoice_number?: unknown; customer_id: unknown },
  defaultBankId: unknown,
): Posting {
  const party: Party = { type: 'CUSTOMER', id: Number(p.customer_id) };
  const amt = P(p.payment_amount);
  const lines = balanced([...line(moneyAccount(p.payment_mode, p.bank_account_id, defaultBankId), amt, 'dr'), ...line('DEBTORS', amt, 'cr', party)]);
  const ref = String(p.transaction_reference ?? '').trim();
  const narration = [`By ${modeWord(p.payment_mode)}`, p.invoice_number ? `against ${p.invoice_number}` : null, ref ? `ref ${ref.slice(0, 60)}` : null].filter(Boolean).join(' · ');
  return { entry_type: 'RECEIPT', date: p.payment_date, number: null, party, narration, lines, amount: totalDr(lines) };
}

/** A supplier's bill: purchases, freight and input GST debited; you owe the supplier the total. */
export function billPosting(b: {
  bill_number?: unknown;
  bill_date: string;
  supplier_id: unknown;
  sub_total?: unknown;
  discount_amount?: unknown;
  freight_charges?: unknown;
  cgst_amount?: unknown;
  sgst_amount?: unknown;
  igst_amount?: unknown;
  round_off?: unknown;
  grand_total?: unknown;
}): Posting {
  const party: Party = { type: 'SUPPLIER', id: Number(b.supplier_id) };
  const goods = P(b.sub_total) - P(b.discount_amount);
  const freight = P(b.freight_charges);
  const gst = P(b.cgst_amount) + P(b.sgst_amount) + P(b.igst_amount);
  const lines = balanced([
    ...line('PURCHASES', goods, 'dr'),
    ...line('FREIGHT_INWARD', freight, 'dr'),
    ...line('INPUT_CGST', P(b.cgst_amount), 'dr'),
    ...line('INPUT_SGST', P(b.sgst_amount), 'dr'),
    ...line('INPUT_IGST', P(b.igst_amount), 'dr'),
    ...line('ROUND_OFF', P(b.round_off), 'dr'),
    ...line('CREDITORS', P(b.grand_total), 'cr', party),
  ]);
  const parts = [`Goods ${money(goods)}`, gst ? `GST ${money(gst)}` : null, freight ? `freight ${money(freight)}` : null].filter(Boolean);
  return { entry_type: 'PURCHASE', date: b.bill_date, number: b.bill_number ? String(b.bill_number) : null, party, narration: parts.join(' · '), lines, amount: totalDr(lines) };
}

/** A payment to a supplier: you owe them less, money out of cash or bank. */
export function supplierPaymentPosting(
  s: { payment_date: string; amount: unknown; mode?: unknown; reference?: unknown; bank_account_id?: unknown; supplier_id: unknown },
  defaultBankId: unknown,
): Posting {
  const party: Party = { type: 'SUPPLIER', id: Number(s.supplier_id) };
  const amt = P(s.amount);
  const lines = balanced([...line('CREDITORS', amt, 'dr', party), ...line(moneyAccount(s.mode, s.bank_account_id, defaultBankId), amt, 'cr')]);
  const ref = String(s.reference ?? '').trim();
  const narration = [`By ${modeWord(s.mode)}`, ref ? `ref ${ref.slice(0, 60)}` : null].filter(Boolean).join(' · ');
  return { entry_type: 'PAYMENT', date: s.payment_date, number: null, party, narration, lines, amount: totalDr(lines) };
}

export type OpeningKind = 'customer' | 'supplier' | 'cash' | 'bank' | 'account';
export type Side = 'Dr' | 'Cr';

/**
 * An opening balance on the books' start date: the account (or party) on its
 * side, "Difference in opening balances" on the other — like Tally, the
 * difference shows until every opening is in (capital, loans, stock…).
 */
export function openingPosting(target: { code: string; party?: Party | null }, paise: number, side: Side, date: string): Posting {
  const amt = Math.abs(Math.round(paise));
  const lines = balanced([...line(target.code, amt, side === 'Dr' ? 'dr' : 'cr', target.party), ...line('OPENING_DIFF', amt, side === 'Dr' ? 'cr' : 'dr')]);
  return { entry_type: 'OPENING', date, number: null, party: target.party || null, narration: 'Opening balance', lines, amount: totalDr(lines) };
}

// ── Balances ───────────────────────────────────────────────────────────────

/** A balance (debit minus credit, in paise) as an amount with its side. */
export const drCr = (balancePaise: number): { amount: number; side: Side | '' } => ({
  amount: R(Math.abs(balancePaise)),
  side: balancePaise > 0 ? 'Dr' : balancePaise < 0 ? 'Cr' : '',
});

/** What a party's balance means, in plain words (balance = debit minus credit). */
export function balanceWords(type: PartyType, balancePaise: number): string {
  if (!balancePaise) return 'Settled';
  if (type === 'CUSTOMER') return balancePaise > 0 ? 'Owes you' : 'Paid in advance';
  return balancePaise < 0 ? 'You owe' : 'Advance paid';
}

export interface LedgerRowIn {
  entry_id: number;
  entry_date: string;
  entry_type: EntryType;
  number: string | null;
  narration: string | null;
  source_type: SourceType;
  source_id: number | null;
  debit: number; // paise
  credit: number; // paise
}

/** Rows with a running balance after each, from the opening balance (paise). */
export function withRunningBalance(openingPaise: number, rows: LedgerRowIn[]) {
  let bal = openingPaise;
  let dr = 0;
  let cr = 0;
  const out = rows.map((r) => {
    bal += r.debit - r.credit;
    dr += r.debit;
    cr += r.credit;
    return { ...r, balance: bal };
  });
  return { rows: out, opening: openingPaise, debit: dr, credit: cr, closing: bal };
}

// ── Dates: financial year April–March ──────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/** 1 April of the financial year a date falls in. */
export const fyStartOf = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
};
export const fyEndOf = (iso: string) => `${Number(fyStartOf(iso).slice(0, 4)) + 1}-03-31`;
/** "FY 2026-27" */
export const fyLabel = (iso: string) => {
  const s = Number(fyStartOf(iso).slice(0, 4));
  return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`;
};
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
};

/** Books start: 1 April of the year of your first document (else of this year). */
export const defaultBooksStart = (earliestDoc: string | null | undefined, today: string) => fyStartOf(isIsoDate(earliestDoc) ? earliestDoc : today);

export const RANGE_PRESETS = ['fy', 'last_fy', 'month', 'last_month', 'all', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** The period to show: a preset (this FY by default) or from / to. Never before the books start. */
export function parseRange(
  q: { range?: unknown; from?: unknown; to?: unknown },
  ctx: { today: string; booksStart: string },
): { ok: true; from: string; to: string; preset: RangePreset } | { ok: false; message: string } {
  const preset = (RANGE_PRESETS as readonly string[]).includes(String(q.range)) ? (String(q.range) as RangePreset) : q.from || q.to ? 'custom' : 'fy';
  let from: string;
  let to: string;
  if (preset === 'custom') {
    if (!isIsoDate(q.from) || !isIsoDate(q.to)) return { ok: false, message: 'Choose both dates (from and to)' };
    from = q.from;
    to = q.to;
    if (from > to) return { ok: false, message: "The 'from' date is after the 'to' date" };
  } else if (preset === 'last_fy') {
    const prev = addDays(fyStartOf(ctx.today), -1);
    from = fyStartOf(prev);
    to = fyEndOf(prev);
  } else if (preset === 'month') {
    from = monthStart(ctx.today);
    to = ctx.today;
  } else if (preset === 'last_month') {
    const prev = addDays(monthStart(ctx.today), -1);
    from = monthStart(prev);
    to = monthEnd(prev);
  } else if (preset === 'all') {
    from = ctx.booksStart;
    to = ctx.today;
  } else {
    from = fyStartOf(ctx.today);
    to = ctx.today;
  }
  if (from < ctx.booksStart) from = ctx.booksStart;
  if (to < from) to = from;
  return { ok: true, from, to, preset };
}

// ── Settings and opening balances ──────────────────────────────────────────

export function parseSettings(
  body: any,
  ctx: { today: string },
): { ok: true; value: { books_start: string; default_bank_account_id: number | null } } | { ok: false; message: string } {
  const start = body?.books_start;
  if (!isIsoDate(start)) return { ok: false, message: 'Enter the date your books start (e.g. 1 April)' };
  if (start < '2000-01-01') return { ok: false, message: 'The books start date is too far back' };
  if (start > ctx.today) return { ok: false, message: "The books can't start in the future" };
  const bank = body?.default_bank_account_id;
  const bankId = bank === null || bank === undefined || bank === '' ? null : Number(bank);
  if (bankId !== null && !(Number.isInteger(bankId) && bankId > 0)) return { ok: false, message: 'Choose a bank account' };
  return { ok: true, value: { books_start: start, default_bank_account_id: bankId } };
}

export interface OpeningItem {
  kind: OpeningKind;
  /** Customer / supplier / bank account / ledger account id; none for cash. */
  id: number | null;
  paise: number;
  side: Side;
}
const NATURAL_SIDE: Record<OpeningKind, Side> = { customer: 'Dr', supplier: 'Cr', cash: 'Dr', bank: 'Dr', account: 'Dr' };
const MAX_PAISE = 1e14; // ₹1 lakh crore

/** Opening balances typed in (several at once). A zero amount removes that opening. */
export function parseOpenings(body: any): { ok: true; items: OpeningItem[] } | { ok: false; message: string } {
  const raw = Array.isArray(body?.items) ? body.items : null;
  if (!raw || !raw.length) return { ok: false, message: 'Nothing to save' };
  if (raw.length > 1000) return { ok: false, message: 'Save at most 1,000 opening balances at a time' };
  const items: OpeningItem[] = [];
  const seen = new Set<string>();
  for (const [i, r] of raw.entries()) {
    const kind = String(r?.kind ?? '').toLowerCase() as OpeningKind;
    if (!(kind in NATURAL_SIDE)) return { ok: false, message: `Line ${i + 1}: choose customer, supplier, cash, bank or account` };
    const id = kind === 'cash' ? null : Number(r?.id);
    if (kind !== 'cash' && !(Number.isInteger(id) && (id as number) > 0)) return { ok: false, message: `Line ${i + 1}: choose who or which account` };
    const amount = Number(r?.amount ?? 0);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, message: `Line ${i + 1}: enter an amount of zero or more` };
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return { ok: false, message: `Line ${i + 1}: at most 2 decimals` };
    const paise = Math.round(amount * 100);
    if (paise > MAX_PAISE) return { ok: false, message: `Line ${i + 1}: the amount is too large` };
    const side: Side = r?.side === 'Dr' || r?.side === 'Cr' ? r.side : NATURAL_SIDE[kind];
    if (kind === 'cash' && side === 'Cr' && paise > 0) return { ok: false, message: "Cash in hand can't be below zero" };
    const key = `${kind}:${id ?? ''}`;
    if (seen.has(key)) return { ok: false, message: `Line ${i + 1}: entered twice` };
    seen.add(key);
    items.push({ kind, id, paise, side });
  }
  return { ok: true, items };
}

/** Where an opening balance sits in the books, and which entry holds it (one per target). */
export const openingTarget = (it: OpeningItem): { code: string; party: Party | null; source: SourceType; sourceId: number } => {
  if (it.kind === 'customer') return { code: 'DEBTORS', party: { type: 'CUSTOMER', id: it.id as number }, source: 'OPENING_CUSTOMER', sourceId: it.id as number };
  if (it.kind === 'supplier') return { code: 'CREDITORS', party: { type: 'SUPPLIER', id: it.id as number }, source: 'OPENING_SUPPLIER', sourceId: it.id as number };
  if (it.kind === 'cash') return { code: 'CASH', party: null, source: 'OPENING_CASH', sourceId: 0 };
  if (it.kind === 'bank') return { code: bankCode(it.id), party: null, source: 'OPENING_BANK', sourceId: it.id as number };
  return { code: accountRef(it.id as number), party: null, source: 'OPENING_ACCOUNT', sourceId: it.id as number };
};

// ── Indian cash rules ──────────────────────────────────────────────────────

/** Section 269ST: no one may receive ₹2 lakh or more in cash from one person in a day. */
export const CASH_RECEIPT_LIMIT = 200_000_00;
/** Section 40A(3): a cash payment above ₹10,000 to one person in a day isn't tax-deductible. */
export const CASH_PAYMENT_LIMIT = 10_000_00;

export interface CashMove {
  date: string;
  direction: 'IN' | 'OUT';
  party_type: PartyType | null;
  party_id: number | null;
  party_name: string | null;
  paise: number;
}
export interface CashWarning {
  rule: '269ST' | '40A(3)';
  date: string;
  party_type: PartyType | null;
  party_id: number | null;
  party_name: string | null;
  amount: number;
  message: string;
}

/** Cash received or paid that crosses the income-tax limits, per person per day. */
export function cashWarnings(moves: CashMove[]): CashWarning[] {
  const byKey = new Map<string, CashMove & { total: number }>();
  for (const m of moves) {
    // A party, or (for expenses) the payee's name.
    const who = m.party_id ? `${m.party_type}:${m.party_id}` : m.party_name ? `name:${m.party_name.trim().toLowerCase()}` : null;
    if (!who) continue;
    const key = `${m.direction}|${m.date}|${who}`;
    const cur = byKey.get(key);
    if (cur) cur.total += m.paise;
    else byKey.set(key, { ...m, total: m.paise });
  }
  const out: CashWarning[] = [];
  for (const g of byKey.values()) {
    if (g.direction === 'IN' && g.total >= CASH_RECEIPT_LIMIT) {
      out.push({
        rule: '269ST',
        date: g.date,
        party_type: g.party_type,
        party_id: g.party_id,
        party_name: g.party_name,
        amount: R(g.total),
        message: `${money(g.total)} received in cash from ${g.party_name || 'one person'} in a day — the limit is ₹2,00,000 (Section 269ST; the penalty equals the amount). If it came by bank or UPI, change the payment mode.`,
      });
    } else if (g.direction === 'OUT' && g.total > CASH_PAYMENT_LIMIT) {
      out.push({
        rule: '40A(3)',
        date: g.date,
        party_type: g.party_type,
        party_id: g.party_id,
        party_name: g.party_name,
        amount: R(g.total),
        message: `${money(g.total)} paid in cash to ${g.party_name || 'one person'} in a day — above ₹10,000 it isn't tax-deductible (Section 40A(3)). Pay by bank or UPI instead.`,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

// ── Lists ──────────────────────────────────────────────────────────────────

export const PARTY_FILTERS = ['all', 'due', 'advance', 'settled'] as const;
export const pageOf = (page: unknown, limit: unknown, maxLimit = 100) => {
  const l = Math.min(maxLimit, Math.max(1, Math.floor(num(limit) || 25)));
  const p = Math.max(1, Math.floor(num(page) || 1));
  return { limit: l, offset: (p - 1) * l, page: p };
};
export const searchText = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, 80) : null;
};
export const partyTypeOf = (v: unknown): PartyType | null => {
  const s = String(v ?? '').toUpperCase();
  return s === 'CUSTOMER' || s === 'CUSTOMERS' ? 'CUSTOMER' : s === 'SUPPLIER' || s === 'SUPPLIERS' ? 'SUPPLIER' : null;
};

// ── Step 2: money in & out ─────────────────────────────────────────────────

export const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CARD'] as const;
export type PayMode = (typeof PAYMENT_MODES)[number];

/** Common expense heads, made for each company on first use (codes keep them unique). */
export const EXPENSE_ACCOUNTS: Record<string, { name: string; group: GroupCode }> = {
  EXP_RENT: { name: 'Rent', group: 'INDIRECT_EXPENSES' },
  EXP_SALARY: { name: 'Salaries & wages', group: 'INDIRECT_EXPENSES' },
  EXP_ELECTRICITY: { name: 'Electricity', group: 'INDIRECT_EXPENSES' },
  EXP_PHONE: { name: 'Telephone & internet', group: 'INDIRECT_EXPENSES' },
  EXP_TRAVEL: { name: 'Fuel & travel', group: 'INDIRECT_EXPENSES' },
  EXP_FREIGHT_OUT: { name: 'Freight & delivery (outward)', group: 'INDIRECT_EXPENSES' },
  EXP_OFFICE: { name: 'Office expenses', group: 'INDIRECT_EXPENSES' },
  EXP_REPAIRS: { name: 'Repairs & maintenance', group: 'INDIRECT_EXPENSES' },
  EXP_BANK: { name: 'Bank charges', group: 'INDIRECT_EXPENSES' },
  EXP_PROFESSIONAL: { name: 'Professional fees', group: 'INDIRECT_EXPENSES' },
  EXP_STATIONERY: { name: 'Printing & stationery', group: 'INDIRECT_EXPENSES' },
  EXP_ADVERT: { name: 'Advertising', group: 'INDIRECT_EXPENSES' },
  EXP_STAFF: { name: 'Staff welfare', group: 'INDIRECT_EXPENSES' },
  EXP_MISC: { name: 'Miscellaneous expenses', group: 'INDIRECT_EXPENSES' },
  EXP_LABOUR: { name: 'Labour charges', group: 'DIRECT_EXPENSES' },
};
Object.assign(SYSTEM_ACCOUNTS, EXPENSE_ACCOUNTS);
export const EXPENSE_GROUPS: GroupCode[] = ['INDIRECT_EXPENSES', 'DIRECT_EXPENSES'];

const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const textOf = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return s ? s.slice(0, max) : null;
};
const paiseOf = (v: unknown): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  const p = Math.round(n * 100);
  return p > MAX_PAISE ? null : p;
};

/** A date for money in or out: real, not in the future, not before the books start. */
export function parseMoneyDate(v: unknown, ctx: { today: string; booksStart: string }): { ok: true; date: string } | { ok: false; message: string } {
  if (v === undefined || v === null || v === '') return { ok: true, date: ctx.today };
  if (!isIsoDate(v)) return { ok: false, message: 'Enter a valid date' };
  if (v > addDaysIso(ctx.today, 1)) return { ok: false, message: "The date can't be in the future" };
  if (v < ctx.booksStart) return { ok: false, message: `That is before your books start (${ctx.booksStart}) — enter it as an opening balance instead` };
  return { ok: true, date: v };
}

/** Where money comes from or goes: cash, or a bank account (null = the default bank). */
export function parseMode(body: any): { ok: true; mode: PayMode; bankAccountId: number | null } | { ok: false; message: string } {
  const mode = String(body?.mode ?? body?.payment_mode ?? '').trim().toUpperCase();
  if (!(PAYMENT_MODES as readonly string[]).includes(mode)) return { ok: false, message: 'Choose how it was paid (cash, bank transfer, cheque, UPI or card)' };
  const b = body?.bank_account_id;
  const bankAccountId = mode === 'CASH' || b === undefined || b === null || b === '' ? null : Number(b);
  if (bankAccountId !== null && !(Number.isInteger(bankAccountId) && bankAccountId > 0)) return { ok: false, message: 'Choose a bank account' };
  return { ok: true, mode: mode as PayMode, bankAccountId };
}

export interface OpenInvoice {
  id: number;
  number: string;
  balancePaise: number;
}
export interface ReceiptInput {
  customerId: number;
  paise: number;
  date: string;
  mode: PayMode;
  bankAccountId: number | null;
  reference: string | null;
  notes: string | null;
  allocations: { invoice_id: number; amount: number }[] | null;
}

/** A payment received from a customer (for one or several invoices, or an advance). */
export function parseReceipt(body: any, ctx: { today: string; booksStart: string }): { ok: true; value: ReceiptInput } | { ok: false; message: string } {
  const customerId = Number(body?.customer_id);
  if (!(Number.isInteger(customerId) && customerId > 0)) return { ok: false, message: 'Choose the customer' };
  const paise = paiseOf(body?.amount);
  if (!paise) return { ok: false, message: 'Enter an amount above zero (at most 2 decimals)' };
  const d = parseMoneyDate(body?.date ?? body?.receipt_date, ctx);
  if (!d.ok) return d;
  const m = parseMode(body);
  if (!m.ok) return m;
  let allocations: ReceiptInput['allocations'] = null;
  if (Array.isArray(body?.allocations)) {
    allocations = [];
    const seen = new Set<number>();
    for (const a of body.allocations) {
      const id = Number(a?.invoice_id);
      const amt = Number(a?.amount);
      if (!(Number.isInteger(id) && id > 0)) return { ok: false, message: 'Choose the invoices this payment is for' };
      if (seen.has(id)) return { ok: false, message: 'An invoice is listed twice' };
      seen.add(id);
      if (!Number.isFinite(amt) || amt < 0) return { ok: false, message: 'Enter amounts of zero or more against the invoices' };
      if (amt > 0) allocations.push({ invoice_id: id, amount: amt });
    }
  }
  return {
    ok: true,
    value: { customerId, paise, date: d.date, mode: m.mode, bankAccountId: m.bankAccountId, reference: textOf(body?.reference, 100), notes: textOf(body?.notes, 500), allocations },
  };
}

/**
 * Which invoices a payment settles: the amounts asked for (each at most the
 * invoice's balance), or the oldest invoices first. What is left over is an
 * advance on the customer's account.
 */
export function allocateReceipt(
  paise: number,
  open: OpenInvoice[],
  asked: { invoice_id: number; amount: number }[] | null,
): { ok: true; lines: { invoice_id: number; paise: number }[]; advance: number } | { ok: false; message: string } {
  const lines: { invoice_id: number; paise: number }[] = [];
  let left = paise;
  if (asked) {
    for (const a of asked) {
      const inv = open.find((o) => o.id === a.invoice_id);
      if (!inv) return { ok: false, message: "One of the invoices isn't open for this customer any more — reload and try again" };
      const p = Math.round(a.amount * 100);
      if (p > inv.balancePaise) return { ok: false, message: `${inv.number}: that is more than its balance (₹${R(inv.balancePaise).toFixed(2)})` };
      if (p > left) return { ok: false, message: 'The amounts against the invoices add up to more than the payment' };
      lines.push({ invoice_id: inv.id, paise: p });
      left -= p;
    }
  } else {
    for (const inv of open) {
      if (left <= 0) break;
      const p = Math.min(left, inv.balancePaise);
      if (p > 0) {
        lines.push({ invoice_id: inv.id, paise: p });
        left -= p;
      }
    }
  }
  return { ok: true, lines, advance: left };
}

/** A customer receipt in the books: money in, the customer owes less (one entry for the whole payment). */
export function receiptPosting(
  r: { receipt_number?: unknown; receipt_date: string; amount: unknown; mode?: unknown; bank_account_id?: unknown; reference?: unknown; customer_id: unknown },
  defaultBankId: unknown,
): Posting {
  const party: Party = { type: 'CUSTOMER', id: Number(r.customer_id) };
  const amt = P(r.amount);
  const lines = balanced([...line(moneyAccount(r.mode, r.bank_account_id, defaultBankId), amt, 'dr'), ...line('DEBTORS', amt, 'cr', party)]);
  const ref = String(r.reference ?? '').trim();
  return {
    entry_type: 'RECEIPT',
    date: r.receipt_date,
    number: r.receipt_number ? String(r.receipt_number) : null,
    party,
    narration: [`By ${modeWord(r.mode)}`, ref ? `ref ${ref.slice(0, 60)}` : null].filter(Boolean).join(' · '),
    lines,
    amount: totalDr(lines),
  };
}

export type TaxType = 'INTRA_STATE' | 'INTER_STATE' | 'NO_GST';
export const GST_RATES = [0, 5, 12, 18, 28];

export interface ExpenseInput {
  date: string;
  accountId: number;
  payee: string | null;
  payeeGstin: string | null;
  billNumber: string | null;
  amountPaise: number;
  gstRate: number;
  taxType: TaxType;
  cgst: number;
  sgst: number;
  igst: number;
  totalPaise: number;
  mode: PayMode;
  bankAccountId: number | null;
  reference: string | null;
  notes: string | null;
}

/**
 * An expense paid now. GST input credit only with the payee's GSTIN (a valid
 * tax invoice): same state → CGST + SGST, other state → IGST. Without a
 * GSTIN the amount is what you paid, with no credit.
 */
export function parseExpense(
  body: any,
  ctx: { today: string; booksStart: string; ourStateCode: string | null; gstinProblem: (g: unknown) => string | null },
): { ok: true; value: ExpenseInput } | { ok: false; message: string } {
  const accountId = Number(body?.account_id);
  if (!(Number.isInteger(accountId) && accountId > 0)) return { ok: false, message: 'Choose what it was for (the expense head)' };
  const d = parseMoneyDate(body?.date ?? body?.expense_date, ctx);
  if (!d.ok) return d;
  const amountPaise = paiseOf(body?.amount);
  if (!amountPaise) return { ok: false, message: 'Enter the amount (above zero, at most 2 decimals)' };
  const gstRate = Number(body?.gst_rate ?? 0);
  if (!GST_RATES.includes(gstRate)) return { ok: false, message: 'Choose a GST rate: 0, 5, 12, 18 or 28%' };
  const rawGstin = String(body?.payee_gstin ?? '').trim().toUpperCase();
  let payeeGstin: string | null = null;
  if (rawGstin) {
    const problem = ctx.gstinProblem(rawGstin);
    if (problem) return { ok: false, message: problem };
    payeeGstin = rawGstin;
  }
  if (gstRate > 0 && !payeeGstin) return { ok: false, message: "GST credit needs the payee's GSTIN — enter it, or leave GST at 0%" };
  const m = parseMode(body);
  if (!m.ok) return m;
  let taxType: TaxType = 'NO_GST';
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (gstRate > 0 && payeeGstin) {
    const gst = Math.round((amountPaise * gstRate) / 100);
    if (ctx.ourStateCode && payeeGstin.slice(0, 2) === ctx.ourStateCode) {
      taxType = 'INTRA_STATE';
      cgst = Math.floor(gst / 2);
      sgst = gst - cgst;
    } else {
      taxType = 'INTER_STATE';
      igst = gst;
    }
  }
  return {
    ok: true,
    value: {
      date: d.date,
      accountId,
      payee: textOf(body?.payee, 150),
      payeeGstin,
      billNumber: textOf(body?.bill_number, 60),
      amountPaise,
      gstRate,
      taxType,
      cgst,
      sgst,
      igst,
      totalPaise: amountPaise + cgst + sgst + igst,
      mode: m.mode,
      bankAccountId: m.bankAccountId,
      reference: textOf(body?.reference, 100),
      notes: textOf(body?.notes, 500),
    },
  };
}

/** An expense in the books: the expense head and input GST debited, cash or bank credited. */
export function expensePosting(
  e: {
    expense_number?: unknown;
    expense_date: string;
    account_id: unknown;
    amount: unknown;
    cgst_amount?: unknown;
    sgst_amount?: unknown;
    igst_amount?: unknown;
    total: unknown;
    mode?: unknown;
    bank_account_id?: unknown;
    payee?: unknown;
    bill_number?: unknown;
  },
  defaultBankId: unknown,
): Posting {
  const lines = balanced([
    ...line(accountRef(Number(e.account_id)), P(e.amount), 'dr'),
    ...line('INPUT_CGST', P(e.cgst_amount), 'dr'),
    ...line('INPUT_SGST', P(e.sgst_amount), 'dr'),
    ...line('INPUT_IGST', P(e.igst_amount), 'dr'),
    ...line(moneyAccount(e.mode, e.bank_account_id, defaultBankId), P(e.total), 'cr'),
  ]);
  const payee = String(e.payee ?? '').trim();
  const bill = String(e.bill_number ?? '').trim();
  return {
    entry_type: 'EXPENSE',
    date: e.expense_date,
    number: e.expense_number ? String(e.expense_number) : null,
    party: null,
    narration: [payee ? `Paid to ${payee.slice(0, 80)}` : null, bill ? `bill ${bill.slice(0, 40)}` : null, `by ${modeWord(e.mode)}`].filter(Boolean).join(' · '),
    lines,
    amount: totalDr(lines),
  };
}

export type MoneyPlace = { kind: 'cash' } | { kind: 'bank'; id: number };
const placeOf = (v: any): MoneyPlace | null => {
  if (v?.kind === 'cash' || v === 'cash' || v === 'CASH') return { kind: 'cash' };
  const id = Number(v?.id ?? v);
  return Number.isInteger(id) && id > 0 ? { kind: 'bank', id } : null;
};
export const placeCode = (p: MoneyPlace) => (p.kind === 'cash' ? 'CASH' : bankCode(p.id));

/** Money moved between cash and banks (a contra entry): "to" is debited, "from" credited. */
export function parseTransfer(
  body: any,
  ctx: { today: string; booksStart: string },
): { ok: true; value: { date: string; from: MoneyPlace; to: MoneyPlace; paise: number; reference: string | null; narration: string | null } } | { ok: false; message: string } {
  const from = placeOf(body?.from);
  const to = placeOf(body?.to);
  if (!from || !to) return { ok: false, message: 'Choose where the money came from and where it went' };
  if (placeCode(from) === placeCode(to)) return { ok: false, message: 'Choose two different accounts' };
  const paise = paiseOf(body?.amount);
  if (!paise) return { ok: false, message: 'Enter an amount above zero (at most 2 decimals)' };
  const d = parseMoneyDate(body?.date, ctx);
  if (!d.ok) return d;
  return { ok: true, value: { date: d.date, from, to, paise, reference: textOf(body?.reference, 100), narration: textOf(body?.narration, 300) } };
}

export function transferPosting(t: {
  date: string;
  from: MoneyPlace;
  to: MoneyPlace;
  paise: number;
  reference: string | null;
  narration: string | null;
  number: string | null;
  fromName: string;
  toName: string;
}): Posting {
  const lines = balanced([...line(placeCode(t.to), t.paise, 'dr'), ...line(placeCode(t.from), t.paise, 'cr')]);
  const words = t.narration || `${t.fromName} → ${t.toName}`;
  return { entry_type: 'CONTRA', date: t.date, number: t.number, party: null, narration: [words, t.reference ? `ref ${t.reference}` : null].filter(Boolean).join(' · '), lines, amount: totalDr(lines) };
}

export interface JournalLineIn {
  account_id: number | null;
  party: Party | null;
  paise: number;
  side: 'dr' | 'cr';
}

/** A journal entry typed by the accountant: 2–50 lines, each one side only, Dr = Cr. */
export function parseJournal(
  body: any,
  ctx: { today: string; booksStart: string },
): { ok: true; value: { date: string; narration: string; lines: JournalLineIn[] } } | { ok: false; message: string } {
  const d = parseMoneyDate(body?.date, ctx);
  if (!d.ok) return d;
  const narration = textOf(body?.narration, 300);
  if (!narration) return { ok: false, message: 'Say what the entry is for (narration)' };
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  if (raw.length < 2) return { ok: false, message: 'A journal needs at least two lines' };
  if (raw.length > 50) return { ok: false, message: 'At most 50 lines in one journal' };
  const lines: JournalLineIn[] = [];
  for (const [i, l] of raw.entries()) {
    const n = i + 1;
    const dr = Number(l?.debit || 0);
    const cr = Number(l?.credit || 0);
    if (!Number.isFinite(dr) || !Number.isFinite(cr) || dr < 0 || cr < 0) return { ok: false, message: `Line ${n}: enter amounts of zero or more` };
    if (dr > 0 === cr > 0) return { ok: false, message: `Line ${n}: enter either a debit or a credit` };
    const paise = paiseOf(dr || cr);
    if (!paise) return { ok: false, message: `Line ${n}: at most 2 decimals` };
    const pt = partyTypeOf(l?.party_type);
    const pid = Number(l?.party_id);
    const aid = Number(l?.account_id);
    const party = pt && Number.isInteger(pid) && pid > 0 ? { type: pt, id: pid } : null;
    const account = Number.isInteger(aid) && aid > 0 ? aid : null;
    if (!!party === !!account) return { ok: false, message: `Line ${n}: choose an account, or a customer / supplier` };
    lines.push({ account_id: account, party, paise, side: dr > 0 ? 'dr' : 'cr' });
  }
  const drs = lines.filter((l) => l.side === 'dr').reduce((s, l) => s + l.paise, 0);
  const crs = lines.filter((l) => l.side === 'cr').reduce((s, l) => s + l.paise, 0);
  if (drs !== crs) return { ok: false, message: `Debits (₹${R(drs).toFixed(2)}) and credits (₹${R(crs).toFixed(2)}) must be equal` };
  return { ok: true, value: { date: d.date, narration, lines } };
}

export function journalPosting(j: { date: string; narration: string; lines: JournalLineIn[]; number: string | null }): Posting {
  const lines = balanced(
    j.lines.flatMap((l) => (l.party ? line(l.party.type === 'CUSTOMER' ? 'DEBTORS' : 'CREDITORS', l.paise, l.side, l.party) : line(accountRef(l.account_id as number), l.paise, l.side))),
  );
  const parties = j.lines.filter((l) => l.party).map((l) => l.party as Party);
  return { entry_type: 'JOURNAL', date: j.date, number: j.number, party: parties.length === 1 ? parties[0] : null, narration: j.narration, lines, amount: totalDr(lines) };
}

/** Groups you can make a ledger account in (a new expense head, capital, a loan…). */
export const MAKEABLE_GROUPS: GroupCode[] = [
  'CAPITAL',
  'LOANS',
  'CURRENT_LIABILITIES',
  'DUTIES_TAXES',
  'FIXED_ASSETS',
  'CURRENT_ASSETS',
  'LOANS_ADVANCES',
  'DIRECT_INCOMES',
  'INDIRECT_INCOMES',
  'DIRECT_EXPENSES',
  'INDIRECT_EXPENSES',
  'SALES',
  'PURCHASES',
];
export function parseNewAccount(body: any): { ok: true; value: { name: string; group: GroupCode; notes: string | null } } | { ok: false; message: string } {
  const name = textOf(body?.name, 120);
  if (!name || name.length < 2) return { ok: false, message: 'Enter a name (at least 2 letters)' };
  const group = String(body?.group_code ?? '');
  if (!isGroup(group) || !MAKEABLE_GROUPS.includes(group)) return { ok: false, message: 'Choose a group (e.g. Indirect Expenses)' };
  return { ok: true, value: { name, group, notes: textOf(body?.notes, 300) } };
}

// ── Step 3: credit notes, debit notes, refunds ─────────────────────────────

Object.assign(SYSTEM_ACCOUNTS, {
  SALES_RETURNS: { name: 'Sales returns & allowances', group: 'SALES' as GroupCode },
  PURCHASE_RETURNS: { name: 'Purchase returns & allowances', group: 'PURCHASES' as GroupCode },
});

/** Why a credit / debit note is issued (the reasons GST returns know). */
export const NOTE_REASONS = ['GOODS_RETURNED', 'PRICE_REDUCED', 'DEFICIENCY', 'CORRECTION', 'OTHER'] as const;
export type NoteReason = (typeof NOTE_REASONS)[number];
export const NOTE_REASON_WORD: Record<NoteReason, string> = {
  GOODS_RETURNED: 'Goods returned',
  PRICE_REDUCED: 'Price reduced / discount after the sale',
  DEFICIENCY: 'Short supply or deficiency',
  CORRECTION: 'Correction in the invoice',
  OTHER: 'Other',
};

/**
 * What one unit of each invoice line is worth before GST: the line after its
 * own discount, and its share of the invoice's overall discount (rupees).
 */
export function unitValues(head: { sub_total?: unknown; discount_amount?: unknown }, items: { id: number; qty: unknown; rate: unknown; discount_percent?: unknown }[]) {
  const nets = items.map((i) => num(i.qty) * num(i.rate) * (1 - num(i.discount_percent) / 100));
  const sum = nets.reduce((s, x) => s + x, 0);
  const taxable = num(head.sub_total) - num(head.discount_amount);
  const ratio = sum > 0 ? taxable / sum : 0;
  return new Map(items.map((i, k) => [i.id, num(i.qty) > 0 ? (nets[k] / num(i.qty)) * ratio : 0]));
}

/** GST on a taxable value at an invoice's rates, each tax rounded to the paisa. */
export const gstAt = (taxablePaise: number, rates: { cgst?: unknown; sgst?: unknown; igst?: unknown }) => ({
  cgst: Math.round((taxablePaise * num(rates.cgst)) / 100),
  sgst: Math.round((taxablePaise * num(rates.sgst)) / 100),
  igst: Math.round((taxablePaise * num(rates.igst)) / 100),
});

/** GST on bill lines with their own rates: same state → CGST + SGST halves, other state → IGST. */
export function gstOnLines(lines: { taxablePaise: number; gstRate: unknown }[], taxType: string) {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const l of lines) {
    const g = Math.round((l.taxablePaise * num(l.gstRate)) / 100);
    if (taxType === 'INTRA_STATE') {
      const half = Math.round(g / 2);
      cgst += half;
      sgst += g - half;
    } else if (taxType === 'INTER_STATE') igst += g;
  }
  return { cgst, sgst, igst };
}

/**
 * GST can be reduced by a credit note only up to 30 November after the end of
 * the invoice's financial year (Section 34(2)); later notes still settle the
 * account but can't lower the GST already paid.
 */
export const noteGstDeadline = (invoiceDate: string) => `${Number(fyStartOf(invoiceDate).slice(0, 4)) + 1}-11-30`;

export interface NoteInput {
  docId: number;
  date: string;
  reason: NoteReason;
  note: string | null;
  lines: { item_id: number; qty: number }[] | null;
  taxablePaise: number | null;
  stock: boolean;
  warehouseId: number | null;
}

/**
 * A credit note (against an invoice) or a debit note (against a supplier's
 * bill): goods returned → the lines and quantities; anything else → the
 * amount before GST.
 */
export function parseNote(body: any, ctx: { today: string; booksStart: string; docKey: 'invoice_id' | 'bill_id' }): { ok: true; value: NoteInput } | { ok: false; message: string } {
  const docId = Number(body?.[ctx.docKey]);
  if (!(Number.isInteger(docId) && docId > 0)) return { ok: false, message: ctx.docKey === 'invoice_id' ? 'Choose the invoice' : "Choose the supplier's bill" };
  const reason = String(body?.reason ?? '') as NoteReason;
  if (!(NOTE_REASONS as readonly string[]).includes(reason)) return { ok: false, message: 'Choose why (goods returned, price reduced…)' };
  const d = parseMoneyDate(body?.date, ctx);
  if (!d.ok) return d;
  let lines: NoteInput['lines'] = null;
  let taxablePaise: number | null = null;
  if (reason === 'GOODS_RETURNED') {
    const raw = Array.isArray(body?.lines) ? body.lines : [];
    lines = [];
    const seen = new Set<number>();
    for (const l of raw) {
      const id = Number(l?.item_id);
      const qty = Number(l?.qty);
      if (!(Number.isInteger(id) && id > 0)) return { ok: false, message: 'Choose the items that came back' };
      if (!Number.isFinite(qty) || qty < 0) return { ok: false, message: 'Enter quantities of zero or more' };
      if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return { ok: false, message: 'Quantities can have at most 3 decimals' };
      if (qty === 0) continue;
      if (seen.has(id)) return { ok: false, message: 'An item is listed twice' };
      seen.add(id);
      lines.push({ item_id: id, qty });
    }
    if (!lines.length) return { ok: false, message: 'Enter how many of which items came back' };
  } else {
    taxablePaise = paiseOf(body?.amount);
    if (!taxablePaise) return { ok: false, message: 'Enter the amount before GST (above zero, at most 2 decimals)' };
  }
  const w = body?.warehouse_id;
  const warehouseId = w === undefined || w === null || w === '' ? null : Number(w);
  if (warehouseId !== null && !(Number.isInteger(warehouseId) && warehouseId > 0)) return { ok: false, message: 'Choose a warehouse' };
  return { ok: true, value: { docId, date: d.date, reason, note: textOf(body?.note, 500), lines, taxablePaise, stock: reason === 'GOODS_RETURNED' && body?.stock !== false, warehouseId } };
}

/** Returned quantities priced at the document's unit values, checked against what is still returnable. */
export function priceReturn(
  asked: { item_id: number; qty: number }[],
  lines: { id: number; name: string; qty: number; returned: number; unit: number }[],
): { ok: true; lines: { item_id: number; qty: number; rate: number; taxablePaise: number }[]; taxablePaise: number } | { ok: false; message: string } {
  const out: { item_id: number; qty: number; rate: number; taxablePaise: number }[] = [];
  for (const a of asked) {
    const l = lines.find((x) => x.id === a.item_id);
    if (!l) return { ok: false, message: "One of the items isn't on this document" };
    const left = Math.round((l.qty - l.returned) * 1000) / 1000;
    if (a.qty > left + 1e-9) return { ok: false, message: `${l.name}: only ${left} can still come back` };
    const taxablePaise = Math.round(a.qty * l.unit * 100);
    out.push({ item_id: l.id, qty: a.qty, rate: Math.round(l.unit * 100) / 100, taxablePaise });
  }
  return { ok: true, lines: out, taxablePaise: out.reduce((s, x) => s + x.taxablePaise, 0) };
}

/** A credit note in the books: sales returns and output GST debited, the customer owes less. */
export function creditNotePosting(n: {
  cn_number?: unknown;
  cn_date: string;
  customer_id: unknown;
  taxable_amount: unknown;
  cgst_amount?: unknown;
  sgst_amount?: unknown;
  igst_amount?: unknown;
  total: unknown;
  invoice_number?: unknown;
  reason?: unknown;
}): Posting {
  const party: Party = { type: 'CUSTOMER', id: Number(n.customer_id) };
  const lines = balanced([
    ...line('SALES_RETURNS', P(n.taxable_amount), 'dr'),
    ...line('OUTPUT_CGST', P(n.cgst_amount), 'dr'),
    ...line('OUTPUT_SGST', P(n.sgst_amount), 'dr'),
    ...line('OUTPUT_IGST', P(n.igst_amount), 'dr'),
    ...line('DEBTORS', P(n.total), 'cr', party),
  ]);
  const why = NOTE_REASON_WORD[n.reason as NoteReason] || '';
  return {
    entry_type: 'CREDIT_NOTE',
    date: n.cn_date,
    number: n.cn_number ? String(n.cn_number) : null,
    party,
    narration: [n.invoice_number ? `Against ${n.invoice_number}` : null, why].filter(Boolean).join(' · '),
    lines,
    amount: totalDr(lines),
  };
}

/** A debit note in the books: the supplier is owed less; purchase returns and input GST credited. */
export function debitNotePosting(n: {
  dn_number?: unknown;
  dn_date: string;
  supplier_id: unknown;
  taxable_amount: unknown;
  cgst_amount?: unknown;
  sgst_amount?: unknown;
  igst_amount?: unknown;
  total: unknown;
  bill_number?: unknown;
  reason?: unknown;
}): Posting {
  const party: Party = { type: 'SUPPLIER', id: Number(n.supplier_id) };
  const lines = balanced([
    ...line('CREDITORS', P(n.total), 'dr', party),
    ...line('PURCHASE_RETURNS', P(n.taxable_amount), 'cr'),
    ...line('INPUT_CGST', P(n.cgst_amount), 'cr'),
    ...line('INPUT_SGST', P(n.sgst_amount), 'cr'),
    ...line('INPUT_IGST', P(n.igst_amount), 'cr'),
  ]);
  const why = NOTE_REASON_WORD[n.reason as NoteReason] || '';
  return {
    entry_type: 'DEBIT_NOTE',
    date: n.dn_date,
    number: n.dn_number ? String(n.dn_number) : null,
    party,
    narration: [n.bill_number ? `Against bill ${n.bill_number}` : null, why].filter(Boolean).join(' · '),
    lines,
    amount: totalDr(lines),
  };
}

/** Money paid back to a customer out of their advance: they are owed less, money out. */
export function refundPosting(
  r: { refund_number?: unknown; refund_date: string; amount: unknown; mode?: unknown; bank_account_id?: unknown; reference?: unknown; customer_id: unknown },
  defaultBankId: unknown,
): Posting {
  const party: Party = { type: 'CUSTOMER', id: Number(r.customer_id) };
  const amt = P(r.amount);
  const lines = balanced([...line('DEBTORS', amt, 'dr', party), ...line(moneyAccount(r.mode, r.bank_account_id, defaultBankId), amt, 'cr')]);
  const ref = String(r.reference ?? '').trim();
  return {
    entry_type: 'PAYMENT',
    date: r.refund_date,
    number: r.refund_number ? String(r.refund_number) : null,
    party,
    narration: [`Refund by ${modeWord(r.mode)}`, ref ? `ref ${ref.slice(0, 60)}` : null].filter(Boolean).join(' · '),
    lines,
    amount: totalDr(lines),
  };
}

/** A refund to a customer: amount, date, how it was paid. */
export function parseRefund(
  body: any,
  ctx: { today: string; booksStart: string },
): { ok: true; value: { customerId: number; paise: number; date: string; mode: PayMode; bankAccountId: number | null; reference: string | null; notes: string | null } } | { ok: false; message: string } {
  const customerId = Number(body?.customer_id);
  if (!(Number.isInteger(customerId) && customerId > 0)) return { ok: false, message: 'Choose the customer' };
  const paise = paiseOf(body?.amount);
  if (!paise) return { ok: false, message: 'Enter the amount paid back (above zero, at most 2 decimals)' };
  const d = parseMoneyDate(body?.date, ctx);
  if (!d.ok) return d;
  const m = parseMode(body);
  if (!m.ok) return m;
  return { ok: true, value: { customerId, paise, date: d.date, mode: m.mode, bankAccountId: m.bankAccountId, reference: textOf(body?.reference, 100), notes: textOf(body?.notes, 500) } };
}

/**
 * An invoice's status after a credit note is applied or taken back: paid when
 * nothing is left; part paid when money came in; otherwise as it was (a sent
 * invoice stays sent), except that a no-longer-paid invoice is open again.
 */
export function invoiceStatusAfter(current: unknown, duePaise: number, paidPaise: number): string {
  const cur = String(current ?? '');
  if (duePaise - paidPaise <= 0) return 'PAID';
  if (paidPaise > 0) return 'PARTIAL_PAID';
  return cur === 'PAID' || cur === 'PARTIAL_PAID' || !cur ? 'GENERATED' : cur;
}

/** Which advances a refund (or another use) takes, oldest first; null when there isn't enough. */
export function takeCredits<T extends { leftPaise: number }>(sources: T[], paise: number): { source: T; paise: number }[] | null {
  const out: { source: T; paise: number }[] = [];
  let need = paise;
  for (const s of sources) {
    if (need <= 0) break;
    const take = Math.min(need, s.leftPaise);
    if (take > 0) {
      out.push({ source: s, paise: take });
      need -= take;
    }
  }
  return need > 0 ? null : out;
}

// ── Step 4: reports ────────────────────────────────────────────────────────

Object.assign(SYSTEM_ACCOUNTS, { STOCK: { name: 'Stock in hand (opening)', group: 'CURRENT_ASSETS' as GroupCode } });

/** Groups whose accounts can carry an opening balance typed in (besides parties, cash and banks). */
export const OPENABLE_GROUPS: GroupCode[] = ['CAPITAL', 'LOANS', 'CURRENT_LIABILITIES', 'DUTIES_TAXES', 'FIXED_ASSETS', 'CURRENT_ASSETS', 'LOANS_ADVANCES'];

/** How late an amount is, by its due date: not due yet, 1–30, 31–60, 61–90, over 90 days. */
export const AGE_BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export const ageBucket = (daysLate: number): AgeBucket => (daysLate <= 0 ? 'not_due' : daysLate <= 30 ? 'd1_30' : daysLate <= 60 ? 'd31_60' : daysLate <= 90 ? 'd61_90' : 'd90_plus');

export interface AccountMove {
  id: number;
  code: string | null;
  name: string;
  group: GroupCode;
  /** Debit minus credit, in paise. */
  paise: number;
}

/**
 * Profit & loss for a period from each account's movement (debit − credit)
 * in it, with stock: opening stock (when the period starts on the books'
 * first day) and closing stock (when it ends today) — Tally's trading account.
 */
export function profitAndLoss(moves: AccountMove[], stock: { opening: number | null; closing: number | null }) {
  const of = (g: GroupCode, sign: 1 | -1) =>
    moves
      .filter((m) => m.group === g && m.paise)
      .map((m) => ({ id: m.id, code: m.code, name: m.name, paise: sign * m.paise }))
      .sort((a, b) => b.paise - a.paise);
  const sum = (rows: { paise: number }[]) => rows.reduce((s, r) => s + r.paise, 0);
  const sales = of('SALES', -1);
  const directIncomes = of('DIRECT_INCOMES', -1);
  const purchases = of('PURCHASES', 1);
  const directExpenses = of('DIRECT_EXPENSES', 1);
  const indirectIncomes = of('INDIRECT_INCOMES', -1);
  const indirectExpenses = of('INDIRECT_EXPENSES', 1);
  const os = stock.opening ?? 0;
  const cs = stock.closing ?? 0;
  const gross = sum(sales) + sum(directIncomes) - (os + sum(purchases) + sum(directExpenses) - cs);
  const net = gross + sum(indirectIncomes) - sum(indirectExpenses);
  return {
    sales,
    direct_incomes: directIncomes,
    purchases,
    direct_expenses: directExpenses,
    indirect_incomes: indirectIncomes,
    indirect_expenses: indirectExpenses,
    opening_stock: stock.opening,
    closing_stock: stock.closing,
    totals: {
      sales: sum(sales),
      direct_incomes: sum(directIncomes),
      purchases: sum(purchases),
      direct_expenses: sum(directExpenses),
      indirect_incomes: sum(indirectIncomes),
      indirect_expenses: sum(indirectExpenses),
    },
    gross_profit: gross,
    net_profit: net,
  };
}

const BS_LIABILITIES: GroupCode[] = ['CAPITAL', 'LOANS', 'CURRENT_LIABILITIES', 'SUNDRY_CREDITORS', 'SUSPENSE'];
const BS_ASSETS: GroupCode[] = ['FIXED_ASSETS', 'CURRENT_ASSETS', 'LOANS_ADVANCES', 'SUNDRY_DEBTORS', 'CASH_IN_HAND', 'BANK_ACCOUNTS'];

/**
 * Balance sheet on a date from each account's balance (debit − credit, all
 * entries up to the date) and the profit to date. Liabilities show credit
 * balances as positive; Duties & Taxes sits on the side its net balance is
 * on (GST to pay, or input credit to claim). When stock is valued, the
 * opening-stock account is replaced by the closing stock.
 */
export function balanceSheet(balances: AccountMove[], profitPaise: number, closingStock: number | null) {
  const groupRows = (g: GroupCode, sign: 1 | -1) =>
    balances
      .filter((b) => b.group === g && b.paise && !(closingStock !== null && b.code === 'STOCK'))
      .map((b) => ({ id: b.id, code: b.code, name: b.name, paise: sign * b.paise }));
  type Section = { group: GroupCode; name: string; rows: { id: number; code: string | null; name: string; paise: number }[] };
  const liabilities: Section[] = BS_LIABILITIES.map((g) => ({ group: g, name: GROUPS[g].name as string, rows: groupRows(g, -1) })).filter((x) => x.rows.length);
  const assets: Section[] = BS_ASSETS.map((g) => ({ group: g, name: GROUPS[g].name as string, rows: groupRows(g, 1) })).filter((x) => x.rows.length);
  const taxes = balances.filter((b) => b.group === 'DUTIES_TAXES').reduce((s, b) => s + b.paise, 0);
  if (taxes < 0) liabilities.push({ group: 'DUTIES_TAXES', name: 'Duties & Taxes (GST to pay)', rows: [{ id: 0, code: 'GST_NET', name: 'GST payable (net)', paise: -taxes }] });
  if (taxes > 0) assets.push({ group: 'DUTIES_TAXES', name: 'Duties & Taxes (input credit)', rows: [{ id: 0, code: 'GST_NET', name: 'GST input credit to claim (net)', paise: taxes }] });
  if (closingStock) assets.push({ group: 'CURRENT_ASSETS', name: 'Closing stock', rows: [{ id: 0, code: 'CLOSING_STOCK', name: 'Stock in hand (at cost)', paise: closingStock }] });
  liabilities.push({ group: 'CAPITAL', name: 'Profit & loss account', rows: [{ id: 0, code: 'PROFIT', name: profitPaise >= 0 ? 'Profit to date' : 'Loss to date', paise: profitPaise }] });
  const total = (side: { rows: { paise: number }[] }[]) => side.reduce((s, g) => s + g.rows.reduce((t, r) => t + r.paise, 0), 0);
  const tl = total(liabilities);
  const ta = total(assets);
  return { liabilities, assets, total_liabilities: tl, total_assets: ta, difference: ta - tl };
}

/** GST by month from the GST accounts: output (on sales) minus input credit = to pay per head. */
export function gstByMonth(rows: { ym: string; code: string; paise: number }[]) {
  const months = [...new Set(rows.map((r) => r.ym))].sort();
  return months.map((ym) => {
    const v = (code: string) => rows.filter((r) => r.ym === ym && r.code === code).reduce((s, r) => s + r.paise, 0);
    // paise here = credit − debit (output is a credit; input is a debit, so it comes negative).
    const out = { cgst: v('OUTPUT_CGST'), sgst: v('OUTPUT_SGST'), igst: v('OUTPUT_IGST') };
    const inp = { cgst: 0 - v('INPUT_CGST'), sgst: 0 - v('INPUT_SGST'), igst: 0 - v('INPUT_IGST') };
    const sales = v('SALES') + v('TRANSPORT_INCOME') + v('SALES_RETURNS');
    const purchases = 0 - (v('PURCHASES') + v('FREIGHT_INWARD') + v('PURCHASE_RETURNS'));
    const outT = out.cgst + out.sgst + out.igst;
    const inT = inp.cgst + inp.sgst + inp.igst;
    return { month: ym, sales, purchases, output: out, input: inp, output_total: outT, input_total: inT, net: outT - inT };
  });
}

/** "RCT/26-27/" — the standard Indian voucher prefix for a date's financial year. */
export const voucherPrefix = (code: string, date: string) => {
  const s = Number(fyStartOf(date).slice(0, 4));
  return `${code}/${String(s % 100).padStart(2, '0')}-${String((s + 1) % 100).padStart(2, '0')}/`;
};
