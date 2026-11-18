// Pure rules for the invoice page: an invoice's payment state, the list filters
// and sorts, the summary above the list, and the checks run before recording a
// payment or making an invoice. SQL fragments use the alias `i`; nothing here
// touches the database, so it is unit-tested. Definitions match the dashboard
// (dashboard.service.ts): live = not cancelled / superseded, overdue = an
// unpaid balance past its due date, aging buckets by days past due.

import { addDays, money, num, pctChange } from '../dashboard/dashboard.rules';
import { daysBetween, lastMonthToDate, monthKeys } from '../quotations/quotation-insights.rules';

/** Where an invoice stands with payment. Cancelled ones never count. */
export const STATES = ['unpaid', 'partial', 'paid', 'cancelled'] as const;
export type State = (typeof STATES)[number];
/** Money still to come in. */
export const OPEN_STATES: State[] = ['unpaid', 'partial'];

/** List filters: a state, or one of the "needs attention" views. */
export const LIST_FILTERS = ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'DUE_SOON', 'NO_DUE', 'CANCELLED'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const SORTS = ['newest', 'oldest', 'due_soonest', 'balance_high', 'amount_high'] as const;
export type Sort = (typeof SORTS)[number];

/** "Due soon" = falls due within this many days (today included). */
export const DUE_SOON_DAYS = 7;
export const ATTENTION_ITEMS = 6;

export const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CARD: 'Card',
};
export const REFERENCE_MAX = 100;
export const NOTES_MAX = 500;

/** Cancelled and superseded invoices are kept for the record but never count. */
export const DEAD_STATUSES = ['CANCELLED', 'SUPERSEDED'];
export const LIVE_SQL = `COALESCE(i.status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`;

export const STATE_SQL = `(CASE
  WHEN i.status IN ('CANCELLED', 'SUPERSEDED') THEN 'cancelled'
  WHEN i.status = 'PAID' OR COALESCE(i.balance_amount, 0) <= 0 THEN 'paid'
  WHEN COALESCE(i.paid_amount, 0) > 0 THEN 'partial'
  ELSE 'unpaid' END)`;

/** Same rule as STATE_SQL, for one row in code. */
export const stateOf = (inv: { status?: string | null; balance_amount?: unknown; paid_amount?: unknown }): State => {
  if (DEAD_STATUSES.includes(String(inv.status ?? ''))) return 'cancelled';
  if (inv.status === 'PAID' || num(inv.balance_amount) <= 0) return 'paid';
  if (num(inv.paid_amount) > 0) return 'partial';
  return 'unpaid';
};

export const AGING = [
  { key: 'current', label: 'Not due yet' },
  { key: 'd30', label: '1–30 days late' },
  { key: 'd60', label: '31–60 days late' },
  { key: 'd90', label: '61–90 days late' },
  { key: 'd90p', label: '90+ days late' },
] as const;

export const AGING_SQL = `(CASE
  WHEN i.due_date IS NULL OR i.due_date >= :today THEN 'current'
  WHEN DATEDIFF(:today, i.due_date) <= 30 THEN 'd30'
  WHEN DATEDIFF(:today, i.due_date) <= 60 THEN 'd60'
  WHEN DATEDIFF(:today, i.due_date) <= 90 THEN 'd90'
  ELSE 'd90p' END)`;

export const parseListFilter = (v: unknown): ListFilter | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (LIST_FILTERS as readonly string[]).includes(s) ? (s as ListFilter) : null;
};

export const parseSort = (v: unknown): Sort => {
  const s = String(v ?? '').trim().toLowerCase();
  return (SORTS as readonly string[]).includes(s) ? (s as Sort) : 'newest';
};

export const summaryWindow = (today: string) => {
  const months = monthKeys(today);
  const prev = lastMonthToDate(today);
  return { months, from: `${months[0]}-01`, soon: addDays(today, DUE_SOON_DAYS - 1), prevFrom: prev.from, prevTo: prev.to };
};

// ── Money in paise, so float noise can never over- or under-pay an invoice ──

export const toPaise = (v: unknown): number => Math.round(num(v) * 100);
export const fromPaise = (p: number): number => p / 100;

/** Status after a payment, from the totals in paise. */
export const statusAfterPayment = (totalPaise: number, paidPaise: number): 'GENERATED' | 'PARTIAL_PAID' | 'PAID' =>
  paidPaise >= totalPaise ? 'PAID' : paidPaise > 0 ? 'PARTIAL_PAID' : 'GENERATED';

/** Why no payment can be recorded against this invoice, or null when it can. */
export const paymentBlocker = (inv: { status?: string | null; balance_amount?: unknown; grand_total?: unknown; paid_amount?: unknown }): string | null => {
  if (DEAD_STATUSES.includes(String(inv.status ?? ''))) return 'This invoice is cancelled, so payments can no longer be recorded against it';
  const balance = toPaise(inv.grand_total) - toPaise(inv.paid_amount);
  if (inv.status === 'PAID' || balance <= 0) return 'This invoice is already paid in full';
  return null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** First 10 characters of an ISO date or datetime ("2026-11-18T…" → "2026-11-18"). */
export const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return isIsoDate(s) ? s : null;
};

const clean = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim().replace(/\r\n/g, '\n') : '';
  return s ? s.slice(0, max) : null;
};

export type ParsedPayment =
  | { ok: true; amountPaise: number; date: string; mode: PaymentMode; reference: string | null; notes: string | null }
  | { ok: false; message: string };

/**
 * Validates a payment against the invoice it is for. `today` is the business
 * date; a payment can't be dated in the future (one day of slack covers time
 * zones ahead of the business's).
 */
export const parsePayment = (
  body: { amount?: unknown; payment_date?: unknown; payment_mode?: unknown; transaction_reference?: unknown; notes?: unknown },
  ctx: { balancePaise: number; today: string },
): ParsedPayment => {
  const raw = Number(body.amount);
  if (!Number.isFinite(raw) || raw <= 0) return { ok: false, message: 'Enter an amount greater than zero' };
  const amountPaise = Math.round(raw * 100);
  if (amountPaise <= 0) return { ok: false, message: 'Enter an amount greater than zero' };
  if (amountPaise > ctx.balancePaise) {
    return { ok: false, message: `That is more than the balance due (₹${(ctx.balancePaise / 100).toFixed(2)})` };
  }
  const mode = String(body.payment_mode ?? '').trim().toUpperCase();
  if (!(PAYMENT_MODES as readonly string[]).includes(mode)) return { ok: false, message: 'Choose how the payment was made' };
  let date = ctx.today;
  if (body.payment_date !== undefined && body.payment_date !== null && body.payment_date !== '') {
    const d = dateOnly(body.payment_date);
    if (!d) return { ok: false, message: 'Enter a valid payment date' };
    if (d > addDays(ctx.today, 1)) return { ok: false, message: "The payment date can't be in the future" };
    date = d;
  }
  return {
    ok: true,
    amountPaise,
    date,
    mode: mode as PaymentMode,
    reference: clean(body.transaction_reference, REFERENCE_MAX),
    notes: clean(body.notes, NOTES_MAX),
  };
};

/**
 * Dates for a new invoice. The invoice date defaults to today, can't be in the
 * future or before the quotation's date; the due date can't be before it.
 */
export const parseInvoiceDates = (
  body: { invoice_date?: unknown; payment_due_date?: unknown },
  ctx: { today: string; quotationDate?: string | null },
): { ok: true; invoiceDate: string; dueDate: string } | { ok: false; message: string } => {
  let invoiceDate = ctx.today;
  if (body.invoice_date !== undefined && body.invoice_date !== null && body.invoice_date !== '') {
    const d = dateOnly(body.invoice_date);
    if (!d) return { ok: false, message: 'Enter a valid invoice date' };
    if (d > addDays(ctx.today, 1)) return { ok: false, message: "The invoice date can't be in the future" };
    if (ctx.quotationDate && d < ctx.quotationDate) {
      return { ok: false, message: `The invoice date can't be before the quotation's date (${ctx.quotationDate})` };
    }
    invoiceDate = d;
  }
  const dueDate = dateOnly(body.payment_due_date);
  if (!dueDate) return { ok: false, message: 'Choose when payment is due' };
  if (dueDate < invoiceDate) return { ok: false, message: "The due date can't be before the invoice date" };
  return { ok: true, invoiceDate, dueDate };
};

// ── Summary ─────────────────────────────────────────────────────────────────

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export interface StateRow {
  state: string;
  n: unknown;
  v: unknown;
  p: unknown;
  b: unknown;
  od_n?: unknown;
  od_v?: unknown;
  soon_n?: unknown;
  soon_v?: unknown;
  nodue_n?: unknown;
  nodue_v?: unknown;
}

export interface SummaryInput {
  today: string;
  stateRows: StateRow[];
  /** Invoices dated in each month (by invoice date). */
  billedRows: { m: string; n: unknown; v: unknown }[];
  /** Payments received in each month (by payment date). */
  collectedRows: { m: string; n: unknown; v: unknown }[];
  /** The same days of last month as "this month so far". */
  prev?: { bn: unknown; bv: unknown; cn: unknown; cv: unknown };
  attentionRows: {
    id: unknown;
    invoice_number: string;
    customer_name: string | null;
    due_date: string;
    grand_total: unknown;
    paid_amount: unknown;
    balance_amount: unknown;
    state: string;
  }[];
  agingRows: { bucket: string; n: unknown; v: unknown }[];
  debtorRows: { id: unknown; name: string | null; n: unknown; due: unknown; late: unknown; oldest: string | null }[];
  speed?: { avg_days: unknown; n: unknown };
  modeRows: { mode: string | null; n: unknown; v: unknown }[];
}

export const buildSummary = (inp: SummaryInput) => {
  const { today } = inp;
  const states = Object.fromEntries(STATES.map((s) => [s, { count: 0, value: 0, paid: 0, balance: 0 }])) as Record<
    State,
    { count: number; value: number; paid: number; balance: number }
  >;
  const acc = { od_n: 0, od_v: 0, soon_n: 0, soon_v: 0, nodue_n: 0, nodue_v: 0 };
  for (const r of inp.stateRows) {
    const key = ((STATES as readonly string[]).includes(r.state) ? r.state : 'unpaid') as State;
    states[key].count += num(r.n);
    states[key].value = money(states[key].value + num(r.v));
    states[key].paid = money(states[key].paid + num(r.p));
    states[key].balance = money(states[key].balance + num(r.b));
    acc.od_n += num(r.od_n);
    acc.od_v += num(r.od_v);
    acc.soon_n += num(r.soon_n);
    acc.soon_v += num(r.soon_v);
    acc.nodue_n += num(r.nodue_n);
    acc.nodue_v += num(r.nodue_v);
  }
  const live: State[] = ['unpaid', 'partial', 'paid'];
  const total = {
    count: live.reduce((a, k) => a + states[k].count, 0),
    value: money(live.reduce((a, k) => a + states[k].value, 0)),
    paid: money(live.reduce((a, k) => a + states[k].paid, 0)),
    balance: money(OPEN_STATES.reduce((a, k) => a + states[k].balance, 0)),
  };
  const outstanding = {
    count: OPEN_STATES.reduce((a, k) => a + states[k].count, 0),
    value: total.balance,
  };

  const months = monthKeys(today).map((key) => {
    const b = inp.billedRows.find((x) => x.m === key);
    const c = inp.collectedRows.find((x) => x.m === key);
    return { key, billed_count: num(b?.n), billed: money(b?.v), collected_count: num(c?.n), collected: money(c?.v) };
  });
  const cur = months[months.length - 1];
  const prevRange = lastMonthToDate(today);
  const prevBilled = { count: num(inp.prev?.bn), value: money(inp.prev?.bv) };
  const prevCollected = { count: num(inp.prev?.cn), value: money(inp.prev?.cv) };

  const byBucket = new Map(inp.agingRows.map((r) => [r.bucket, r]));
  const aging = AGING.map((b) => ({ key: b.key, label: b.label, count: num(byBucket.get(b.key)?.n), value: money(byBucket.get(b.key)?.v) }));

  const modeTotal = inp.modeRows.reduce((a, r) => a + num(r.v), 0);
  const speedN = num(inp.speed?.n);

  return {
    today,
    states,
    total,
    outstanding,
    overdue: { count: acc.od_n, value: money(acc.od_v) },
    due_soon: { days: DUE_SOON_DAYS, count: acc.soon_n, value: money(acc.soon_v) },
    no_due_date: { count: acc.nodue_n, value: money(acc.nodue_v) },
    attention: inp.attentionRows.map((r) => ({
      id: num(r.id),
      invoice_number: r.invoice_number,
      customer_name: r.customer_name || '—',
      due_date: r.due_date,
      days: daysBetween(today, r.due_date),
      grand_total: money(r.grand_total),
      paid_amount: money(r.paid_amount),
      balance_amount: money(r.balance_amount),
      state: ((STATES as readonly string[]).includes(r.state) ? r.state : 'unpaid') as State,
    })),
    aging,
    /** Of everything billed, how much has come in. */
    collection_rate: share(total.paid, total.value),
    avg_days_to_pay: speedN && inp.speed?.avg_days !== null && inp.speed?.avg_days !== undefined ? Math.round(num(inp.speed.avg_days) * 10) / 10 : null,
    settled_count: speedN,
    this_month: {
      from: `${cur.key}-01`,
      to: today,
      billed: { count: cur.billed_count, value: cur.billed },
      collected: { count: cur.collected_count, value: cur.collected },
    },
    last_month: { from: prevRange.from, to: prevRange.to, billed: prevBilled, collected: prevCollected },
    billed_change: pctChange(cur.billed, prevBilled.value),
    collected_change: pctChange(cur.collected, prevCollected.value),
    months,
    top_debtors: inp.debtorRows.map((r) => ({
      id: r.id === null || r.id === undefined ? null : num(r.id),
      name: r.name || '—',
      count: num(r.n),
      balance: money(r.due),
      overdue: money(r.late),
      oldest_due: r.oldest || null,
    })),
    payment_modes: inp.modeRows
      .map((r) => {
        const mode = String(r.mode || 'OTHER').toUpperCase();
        return {
          mode,
          label: PAYMENT_MODE_LABEL[mode as PaymentMode] || 'Other',
          count: num(r.n),
          value: money(r.v),
          share: share(num(r.v), modeTotal),
        };
      })
      .sort((a, b) => b.value - a.value),
  };
};

export type InvoiceSummary = ReturnType<typeof buildSummary>;
