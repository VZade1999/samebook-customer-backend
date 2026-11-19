// Pure rules for the quotation page: which stage a quotation is in, the list
// filters and sorts, and the summary shown above the list. SQL fragments use
// the alias `q`; nothing here touches the database, so it is unit-tested.

import { addDays, isIsoDate, money, num, pctChange } from '../dashboard/dashboard.rules';

/** Where a quotation is in its life. Invoiced wins over the stored status. */
export const STAGES = ['draft', 'sent', 'approved', 'invoiced', 'rejected', 'expired'] as const;
export type Stage = (typeof STAGES)[number];

/** Statuses that mean "approved" (dispatching against it doesn't undo that). */
export const APPROVED_STATUSES = ['APPROVED', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'];
/** Still waiting for an outcome: can be shared, approved or invoiced. */
export const OPEN_STAGES: Stage[] = ['draft', 'sent', 'approved'];

/** List filters: a stage, or one of two "needs attention" views. */
export const LIST_FILTERS = ['DRAFT', 'SENT', 'APPROVED', 'INVOICED', 'REJECTED', 'EXPIRED', 'EXPIRING', 'LAPSED'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const SORTS = ['newest', 'oldest', 'value_high', 'value_low'] as const;
export type Sort = (typeof SORTS)[number];

// ── Closing a quotation (lost or expired) with the customer's feedback ──────

export const CLOSE_OUTCOMES = ['REJECTED', 'EXPIRED'] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

/** Stable keys (stored, reported on) with the label shown in the app. */
export const CLOSE_REASONS: Record<CloseOutcome, { key: string; label: string }[]> = {
  REJECTED: [
    { key: 'PRICE', label: 'Price too high' },
    { key: 'COMPETITOR', label: 'Went with a competitor' },
    { key: 'NOT_NEEDED', label: 'Requirement cancelled' },
    { key: 'DELIVERY', label: "Delivery time didn't suit" },
    { key: 'BUDGET', label: 'No budget / postponed' },
    { key: 'SPEC', label: "Product didn't match the need" },
    { key: 'OTHER', label: 'Other' },
  ],
  EXPIRED: [
    { key: 'NO_RESPONSE', label: 'No response from the customer' },
    { key: 'UNREACHABLE', label: "Couldn't reach the customer" },
    { key: 'REPLACED', label: 'Replaced by a newer quotation' },
    { key: 'OTHER', label: 'Other' },
  ],
};
export const REMARK_MAX = 1000;

export const closeReasonLabel = (outcome: string | null | undefined, key: string | null | undefined) =>
  (CLOSE_REASONS[outcome as CloseOutcome] || []).find((r) => r.key === key)?.label || null;

/** Why a quotation can't be closed right now, or null when it can. */
export const closeBlocker = (q: { status?: string | null; has_invoice?: unknown }): string | null => {
  const status = q.status ?? '';
  if (status === 'DELETED') return 'Quotation not found';
  if (Number(q.has_invoice) === 1 || q.has_invoice === true || status === 'INVOICED') {
    return "An invoice was made from this quotation, so it can't be closed";
  }
  if (status === 'REJECTED' || status === 'EXPIRED') return 'This quotation is already closed';
  if (status === 'PARTIALLY_DISPATCHED' || status === 'FULLY_DISPATCHED') {
    return "Goods were already dispatched against this quotation, so it can't be closed";
  }
  return null;
};

/** Why a quotation can't be reopened, or null when it can. */
export const reopenBlocker = (q: { status?: string | null; has_invoice?: unknown }): string | null => {
  if (q.status === 'DELETED') return 'Quotation not found';
  if (q.status !== 'REJECTED' && q.status !== 'EXPIRED') return 'Only a closed quotation can be reopened';
  if (Number(q.has_invoice) === 1 || q.has_invoice === true) return "An invoice was made from this quotation, so it can't be reopened";
  return null;
};

/** Validates a close request; returns the cleaned values or the first problem. */
export const parseClose = (
  body: { outcome?: unknown; reason?: unknown; remark?: unknown },
): { ok: true; outcome: CloseOutcome; reason: string; remark: string | null } | { ok: false; message: string } => {
  const outcome = String(body.outcome ?? '').trim().toUpperCase();
  if (!(CLOSE_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, message: 'Choose whether the customer rejected it or it expired' };
  const reason = String(body.reason ?? '').trim().toUpperCase();
  if (!CLOSE_REASONS[outcome as CloseOutcome].some((r) => r.key === reason)) return { ok: false, message: 'Pick a reason for closing' };
  const remark = typeof body.remark === 'string' ? body.remark.trim().replace(/\r\n/g, '\n') : '';
  if (remark.length > REMARK_MAX) return { ok: false, message: `Keep the remark under ${REMARK_MAX} characters` };
  if (reason === 'OTHER' && remark.length < 3) return { ok: false, message: 'Add a remark explaining why it was closed' };
  return { ok: true, outcome: outcome as CloseOutcome, reason, remark: remark || null };
};

// ── The customer's purchase order ("Buyer's Order No. & Date") ──────────────
// It belongs to the approved quotation; challans and invoices print it from
// there, so it locks once an invoice is made.

export const PO_NUMBER_MAX = 40;

const isInvoiced = (q: { status?: string | null; has_invoice?: unknown }) =>
  Number(q.has_invoice) === 1 || q.has_invoice === true || q.status === 'INVOICED';

/** Why the PO of this quotation can't be set or changed now, or null when it can. */
export const poBlocker = (q: { status?: string | null; has_invoice?: unknown }): string | null => {
  if (q.status === 'DELETED') return 'Quotation not found';
  if (isInvoiced(q)) return "An invoice was made from this quotation, so its PO can't be changed";
  if (!APPROVED_STATUSES.includes(q.status ?? '')) return 'The PO is added when the customer approves the quotation';
  return null;
};

/** Why a quotation can't be approved now, or null when it can. */
export const approveBlocker = (q: { status?: string | null; has_invoice?: unknown }): string | null => {
  if (q.status === 'DELETED') return 'Quotation not found';
  if (isInvoiced(q)) return 'An invoice was made from this quotation, so it is already approved';
  if (APPROVED_STATUSES.includes(q.status ?? '')) return 'This quotation is already approved';
  if (q.status === 'REJECTED' || q.status === 'EXPIRED') return 'This quotation is closed — reopen it first';
  return null;
};

/**
 * Cleans the customer's PO number and date. A date needs a number, a future
 * date is refused, and `required` (the customer always sends a PO) makes the
 * number compulsory.
 */
export const parsePo = (
  body: { customer_po_number?: unknown; customer_po_date?: unknown } | null | undefined,
  ctx: { today: string; required: boolean },
): { ok: true; number: string | null; date: string | null } | { ok: false; message: string } => {
  const raw = body?.customer_po_number;
  if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, message: 'The PO number is not valid' };
  const number = raw == null ? '' : String(raw).trim().replace(/\s+/g, ' ');
  if (number.length > PO_NUMBER_MAX) return { ok: false, message: `The PO number can have at most ${PO_NUMBER_MAX} characters` };

  const rawDate = body?.customer_po_date;
  let date: string | null = null;
  if (rawDate != null && rawDate !== '') {
    if (!isIsoDate(rawDate)) return { ok: false, message: 'The PO date is not a valid date' };
    if (rawDate > ctx.today) return { ok: false, message: "The PO date can't be in the future" };
    date = rawDate;
  }
  if (!number && date) return { ok: false, message: 'Enter the PO number for this PO date' };
  if (!number && ctx.required) return { ok: false, message: 'This customer always sends a purchase order — enter the PO number' };
  return { ok: true, number: number || null, date };
};

/**
 * Why a quotation can't be edited, or null when it can. Once a challan or an
 * invoice exists, its items and prices are what the goods were sent and
 * billed against — editing would change them under those documents.
 */
export const editBlocker = (links: { challans?: unknown; invoices?: unknown }): string | null => {
  if (Number(links.invoices) > 0) {
    return 'This quotation has an invoice, so its items and prices are locked. Make a new quotation for any changes.';
  }
  if (Number(links.challans) > 0) {
    return 'This quotation has delivery challans, so its items and prices are locked. Delete its draft challans or cancel them first — or make a new quotation for the changes.';
  }
  return null;
};

/** Status to restore on reopen: what it was before closing, if that was an open one. */
export const reopenStatus = (previous: unknown): 'DRAFT' | 'SENT' | 'APPROVED' => {
  const s = String(previous ?? '').toUpperCase();
  return s === 'SENT' || s === 'APPROVED' ? s : 'DRAFT';
};

/** "Expiring soon" = valid for at most this many more days. */
export const EXPIRING_DAYS = 7;
export const TREND_MONTHS = 6;

/** Soft-deleted quotations and other document types never count. */
export const LIVE_SQL = `COALESCE(q.status, '') <> 'DELETED' AND COALESCE(q.document_type, 'QT') = 'QT'`;

export const STAGE_SQL = `(CASE
  WHEN COALESCE(q.has_invoice, 0) = 1 OR q.status = 'INVOICED' THEN 'invoiced'
  WHEN q.status = 'REJECTED' THEN 'rejected'
  WHEN q.status = 'EXPIRED' THEN 'expired'
  WHEN q.status IN ('APPROVED', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED') THEN 'approved'
  WHEN q.status = 'SENT' THEN 'sent'
  ELSE 'draft' END)`;

/** The quotation's business date: its own date, else the local day it was made. */
export const QUOTE_DATE_SQL = `COALESCE(q.quotation_date, DATE(DATE_ADD(q.created_at, INTERVAL :tz MINUTE)))`;

export const parseListFilter = (v: unknown): ListFilter | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (LIST_FILTERS as readonly string[]).includes(s) ? (s as ListFilter) : null;
};

export const parseSort = (v: unknown): Sort => {
  const s = String(v ?? '').trim().toLowerCase();
  return (SORTS as readonly string[]).includes(s) ? (s as Sort) : 'newest';
};

/** Month keys (YYYY-MM) ending with the month of `today`, oldest first. */
export const monthKeys = (today: string, n: number = TREND_MONTHS): string[] => {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

/** Whole days from `today` to `date` (negative once it has passed). */
export const daysBetween = (today: string, date: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The same stretch of the previous month as "this month so far": on the 13th,
 * the 1st–13th of last month (clipped to its length, e.g. 31 Mar → 1–28 Feb).
 */
export const lastMonthToDate = (today: string) => {
  const [y, m, d] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const daysInPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const ym = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
  return { from: `${ym}-01`, to: `${ym}-${String(Math.min(d, daysInPrev)).padStart(2, '0')}` };
};

export const summaryWindow = (today: string) => {
  const months = monthKeys(today);
  const prev = lastMonthToDate(today);
  return { months, from: `${months[0]}-01`, soon: addDays(today, EXPIRING_DAYS), prevFrom: prev.from, prevTo: prev.to };
};

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export interface StageRow {
  stage: string;
  n: unknown;
  v: unknown;
  lapsed_n?: unknown;
  lapsed_v?: unknown;
  soon_n?: unknown;
  soon_v?: unknown;
  pipe_n?: unknown;
  pipe_v?: unknown;
}

export interface SummaryInput {
  today: string;
  /** Quotations dated in the same days of last month (see lastMonthToDate). */
  prevToDate?: { n: unknown; v: unknown };
  stageRows: StageRow[];
  monthRows: { m: string; n: unknown; v: unknown; inv_n: unknown; inv_v: unknown }[];
  expiringRows: { id: unknown; quotation_number: string; customer_name: string | null; validity_date: string; grand_total: unknown; stage: string }[];
  customerRows: { id: unknown; name: string | null; n: unknown; v: unknown; won: unknown }[];
  /** Closed quotations by outcome and reason. */
  closedRows?: { outcome: string; reason: string | null; n: unknown; v: unknown }[];
}

export const buildSummary = ({ today, prevToDate, stageRows, monthRows, expiringRows, customerRows, closedRows = [] }: SummaryInput) => {
  const stages = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }])) as Record<Stage, { count: number; value: number }>;
  const acc = { lapsed_n: 0, lapsed_v: 0, soon_n: 0, soon_v: 0, pipe_n: 0, pipe_v: 0 };
  for (const r of stageRows) {
    const key = ((STAGES as readonly string[]).includes(r.stage) ? r.stage : 'draft') as Stage;
    stages[key].count += num(r.n);
    stages[key].value = money(stages[key].value + num(r.v));
    acc.lapsed_n += num(r.lapsed_n);
    acc.lapsed_v += num(r.lapsed_v);
    acc.soon_n += num(r.soon_n);
    acc.soon_v += num(r.soon_v);
    acc.pipe_n += num(r.pipe_n);
    acc.pipe_v += num(r.pipe_v);
  }
  const sum = (keys: Stage[]) => ({
    count: keys.reduce((a, k) => a + stages[k].count, 0),
    value: money(keys.reduce((a, k) => a + stages[k].value, 0)),
  });
  const total = sum([...STAGES]);
  const open = sum(OPEN_STAGES);
  // Of everything shown to customers, how much did they accept?
  const shared = sum(['sent', 'approved', 'invoiced', 'rejected', 'expired']);
  const accepted = sum(['approved', 'invoiced']);

  const months = monthKeys(today).map((key) => {
    const r = monthRows.find((x) => x.m === key);
    return {
      key,
      count: num(r?.n),
      value: money(r?.v),
      invoiced_count: num(r?.inv_n),
      invoiced_value: money(r?.inv_v),
    };
  });
  const cur = months[months.length - 1];
  // Month so far against the same days of last month, never a whole month.
  const prev = { count: num(prevToDate?.n), value: money(prevToDate?.v) };
  const prevRange = lastMonthToDate(today);

  return {
    today,
    stages,
    total,
    open,
    pipeline: { count: acc.pipe_n, value: money(acc.pipe_v) },
    lapsed: { count: acc.lapsed_n, value: money(acc.lapsed_v) },
    expiring: {
      days: EXPIRING_DAYS,
      count: acc.soon_n,
      value: money(acc.soon_v),
      items: expiringRows.map((r) => ({
        id: num(r.id),
        quotation_number: r.quotation_number,
        customer_name: r.customer_name || '—',
        validity_date: r.validity_date,
        days_left: daysBetween(today, r.validity_date),
        grand_total: money(r.grand_total),
        stage: r.stage as Stage,
      })),
    },
    win_rate: share(stages.invoiced.count, total.count),
    acceptance_rate: share(accepted.count, shared.count),
    avg_value: total.count ? money(total.value / total.count) : 0,
    this_month: { count: cur.count, value: cur.value, from: `${cur.key}-01`, to: today },
    last_month: { count: prev.count, value: prev.value, from: prevRange.from, to: prevRange.to },
    count_change: pctChange(cur.count, prev.count),
    value_change: pctChange(cur.value, prev.value),
    months,
    top_customers: customerRows.map((r) => ({
      id: r.id === null || r.id === undefined ? null : num(r.id),
      name: r.name || '—',
      count: num(r.n),
      value: money(r.v),
      invoiced_value: money(r.won),
    })),
    // Why quotations were closed, most common first (no reason = closed
    // before reasons were recorded).
    close_reasons: closedRows
      .map((r) => ({
        outcome: r.outcome as CloseOutcome,
        reason: r.reason || null,
        label: closeReasonLabel(r.outcome, r.reason) || 'No reason given',
        count: num(r.n),
        value: money(r.v),
      }))
      .sort((a, b) => b.count - a.count || b.value - a.value),
  };
};

export type QuotationSummary = ReturnType<typeof buildSummary>;
