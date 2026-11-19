// Pure rules for the delivery challan page: the list filters and sorts, what
// counts as "ready to invoice", what is still to send on approved quotations,
// and the summary above the list. SQL fragments use the alias `dc`
// (delivery_challans) and `qi` (quotation_items); nothing here touches the
// database, so it is unit-tested. "Ready to invoice" is the dashboard's
// "waiting to be invoiced": dispatched or delivered, made from a quotation and
// not linked to an invoice yet.

import { addDays, money, num, pctChange } from '../dashboard/dashboard.rules';
import { daysBetween, lastMonthToDate, monthKeys } from '../quotations/quotation-insights.rules';

export const STATUSES = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'INVOICED', 'CANCELLED'] as const;
export type Status = (typeof STATUSES)[number];

/** List filters: a status, or the "ready to invoice" view. */
export const LIST_FILTERS = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'TO_INVOICE', 'INVOICED', 'CANCELLED'] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export const SORTS = ['newest', 'oldest', 'value_high', 'value_low'] as const;
export type Sort = (typeof SORTS)[number];

export const REASONS = [
  'SALE',
  'PARTIAL_SUPPLY',
  'SUPPLY_ON_APPROVAL',
  'JOB_WORK',
  'STOCK_TRANSFER',
  'EXHIBITION',
  'REPAIR',
  'OTHER',
] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_LABEL: Record<Reason, string> = {
  SALE: 'Sale',
  PARTIAL_SUPPLY: 'Part delivery',
  SUPPLY_ON_APPROVAL: 'On approval',
  JOB_WORK: 'Job work',
  STOCK_TRANSFER: 'Stock transfer',
  EXHIBITION: 'Exhibition',
  REPAIR: 'Repair',
  OTHER: 'Other',
};

/** A draft made this many days ago or more is called out as forgotten. */
export const STALE_DRAFT_DAYS = 7;
/** Goods worth this much or more usually need an e-way bill (GST rule 138). */
export const EWAY_BILL_THRESHOLD = 50_000;
export const ATTENTION_ITEMS = 6;
/** Oldest drafts shown on the dispatch desk. */
export const DRAFT_ITEMS = 4;
export const BACKLOG_ITEMS = 5;

/**
 * Challans made without a quotation that are still a sale to bill: goods
 * sold or sent on approval to a customer. Job work, repair, exhibition and
 * own-warehouse transfers are never billed.
 */
export const BILLABLE_STANDALONE_REASONS = ['SALE', 'PARTIAL_SUPPLY', 'SUPPLY_ON_APPROVAL'];

/**
 * Dispatched or delivered, no invoice linked yet, and made from a quotation —
 * or a sale to a customer made without one (billed in the invoice editor).
 */
export const TO_INVOICE_SQL = `(dc.status IN ('DISPATCHED', 'DELIVERED') AND dc.invoice_id IS NULL
  AND (dc.quotation_id IS NOT NULL OR (dc.customer_id IS NOT NULL AND dc.reason IN ('SALE', 'PARTIAL_SUPPLY', 'SUPPLY_ON_APPROVAL'))))`;

/** Same rule as TO_INVOICE_SQL, for one row in code. */
export const isToInvoice = (c: { status?: string | null; quotation_id?: unknown; invoice_id?: unknown; customer_id?: unknown; reason?: unknown }) =>
  (c.status === 'DISPATCHED' || c.status === 'DELIVERED') &&
  (c.invoice_id === null || c.invoice_id === undefined) &&
  ((c.quotation_id !== null && c.quotation_id !== undefined) ||
    (c.customer_id !== null && c.customer_id !== undefined && BILLABLE_STANDALONE_REASONS.includes(String(c.reason ?? ''))));

/** Invoices that are cancelled or replaced are never linked to a challan. */
export const DEAD_INVOICE_STATUSES = ['CANCELLED', 'SUPERSEDED'];

/** The rate a quotation line goes out at: its discounted rate when it has one (as the challan form does). */
export const QUOTE_RATE_SQL = `(CASE WHEN qi.discounted_rate IS NOT NULL AND qi.discounted_rate > 0 THEN qi.discounted_rate ELSE COALESCE(qi.rate, 0) END)`;

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Still to send on a quotation line: ordered minus what live challans carry, never below zero. */
export const pendingQty = (ordered: unknown, sent: unknown) => Math.max(0, round3(num(ordered) - num(sent)));

export const parseListFilter = (v: unknown): ListFilter | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (LIST_FILTERS as readonly string[]).includes(s) ? (s as ListFilter) : null;
};

export const parseSort = (v: unknown): Sort => {
  const s = String(v ?? '').trim().toLowerCase();
  return (SORTS as readonly string[]).includes(s) ? (s as Sort) : 'newest';
};

export const parseReason = (v: unknown): Reason | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (REASONS as readonly string[]).includes(s) ? (s as Reason) : null;
};

export const summaryWindow = (today: string) => {
  const months = monthKeys(today);
  const prev = lastMonthToDate(today);
  return {
    months,
    from: `${months[0]}-01`,
    prevFrom: prev.from,
    prevTo: prev.to,
    /** Drafts made on or before this day are forgotten ones. */
    staleOn: addDays(today, -STALE_DRAFT_DAYS),
  };
};

// ── Summary ─────────────────────────────────────────────────────────────────

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const reasonLabel = (r: unknown) => REASON_LABEL[String(r ?? '').toUpperCase() as Reason] || 'Other';

export interface SummaryInput {
  today: string;
  /** Live challans by status; `stale` counts forgotten drafts, `first_sent` is the oldest dispatch day. */
  statusRows: { status: string; n: unknown; v: unknown; stale?: unknown; first_sent?: string | null }[];
  toInvoice?: { n: unknown; v: unknown; link_n: unknown };
  eway?: { n: unknown; v: unknown };
  /** Dispatched, not confirmed delivered, oldest first. */
  onRoadRows: {
    id: unknown;
    challan_number: string;
    customer_name: string | null;
    reason: string;
    from_name: string | null;
    to_name: string | null;
    sent_on: string | null;
    total_value: unknown;
    vehicle_number: string | null;
  }[];
  /** Drafts not sent yet, oldest first (with what the dispatch prompt needs). */
  draftRows?: {
    id: unknown;
    challan_number: string;
    customer_name: string | null;
    reason: string;
    affects_stock: unknown;
    from_warehouse_id: unknown;
    from_name: string | null;
    to_name: string | null;
    made_on: string | null;
    total_value: unknown;
    eway_bill_number: string | null;
  }[];
  /** Ready to invoice, oldest first. */
  readyRows: {
    id: unknown;
    challan_number: string;
    customer_name: string | null;
    /** Null for a sale made without a quotation (billed in the invoice editor). */
    quotation_id?: unknown;
    quotation_number: string | null;
    status: string;
    since: string | null;
    total_value: unknown;
    invoice_number: string | null;
  }[];
  /** Challans dispatched in each month (by dispatch day); `c` = since confirmed delivered or invoiced. */
  monthRows: { m: string; n: unknown; v: unknown; c: unknown }[];
  /** The same days of last month as "this month so far". */
  prev?: { n: unknown; v: unknown };
  reasonRows: { reason: string | null; n: unknown; v: unknown }[];
  /** Hours from dispatch to delivery, for deliveries confirmed in the window. */
  speed?: { avg_hours: unknown; n: unknown };
  /** Approved quotations with goods still to send. */
  backlogRows: {
    quotation_id: unknown;
    quotation_number: string;
    customer_id: unknown;
    customer_name: string | null;
    items: unknown;
    pending_items: unknown;
    pending_value: unknown;
    challans: unknown;
    invoiced: unknown;
  }[];
}

export const buildSummary = (inp: SummaryInput) => {
  const { today } = inp;
  const statuses = Object.fromEntries(STATUSES.map((s) => [s.toLowerCase(), { count: 0, value: 0 }])) as Record<
    Lowercase<Status>,
    { count: number; value: number }
  >;
  let stale = 0;
  let firstSent: string | null = null;
  for (const r of inp.statusRows) {
    const key = String(r.status || '').toLowerCase() as Lowercase<Status>;
    if (!statuses[key]) continue;
    statuses[key].count += num(r.n);
    statuses[key].value = money(statuses[key].value + num(r.v));
    if (key === 'draft') stale += num(r.stale);
    if (key === 'dispatched' && r.first_sent) firstSent = r.first_sent;
  }
  const live: Lowercase<Status>[] = ['draft', 'dispatched', 'delivered', 'invoiced'];
  const total = {
    count: live.reduce((a, k) => a + statuses[k].count, 0),
    value: money(live.reduce((a, k) => a + statuses[k].value, 0)),
  };

  const months = monthKeys(today).map((key) => {
    const r = inp.monthRows.find((x) => x.m === key);
    return { key, count: num(r?.n), value: money(r?.v), confirmed: num(r?.c) };
  });
  const cur = months[months.length - 1];
  const prevRange = lastMonthToDate(today);
  const prev = { count: num(inp.prev?.n), value: money(inp.prev?.v) };

  const reasonTotal = inp.reasonRows.reduce((a, r) => a + num(r.n), 0);
  const speedN = num(inp.speed?.n);
  const hours = inp.speed?.avg_hours;

  const backlog = inp.backlogRows
    .map((r) => ({
      quotation_id: num(r.quotation_id),
      quotation_number: r.quotation_number,
      customer_id: r.customer_id === null || r.customer_id === undefined ? null : num(r.customer_id),
      customer_name: r.customer_name || '—',
      items: num(r.items),
      pending_items: num(r.pending_items),
      pending_value: money(r.pending_value),
      challans: num(r.challans),
      invoiced: num(r.invoiced) > 0,
    }))
    .filter((r) => r.pending_items > 0)
    .sort((a, b) => b.pending_value - a.pending_value || b.quotation_id - a.quotation_id);

  return {
    today,
    statuses,
    /** Every live challan (cancelled ones never count). */
    total,
    drafts: {
      count: statuses.draft.count,
      value: statuses.draft.value,
      stale,
      stale_days: STALE_DRAFT_DAYS,
      items: (inp.draftRows || []).map((r) => {
        const transfer = r.reason === 'STOCK_TRANSFER';
        return {
          id: num(r.id),
          challan_number: r.challan_number,
          status: 'DRAFT' as const,
          customer_name: transfer ? null : r.customer_name || null,
          reason: r.reason,
          reason_label: reasonLabel(r.reason),
          route: transfer ? `${r.from_name || 'Warehouse'} → ${r.to_name || 'Warehouse'}` : null,
          made_on: r.made_on,
          days: r.made_on ? Math.max(0, -daysBetween(today, r.made_on)) : 0,
          total_value: money(r.total_value),
          affects_stock: num(r.affects_stock) === 1,
          from_warehouse_id: r.from_warehouse_id === null || r.from_warehouse_id === undefined ? null : num(r.from_warehouse_id),
          from_warehouse_name: r.from_name || null,
          to_warehouse_name: r.to_name || null,
          eway_bill_number: r.eway_bill_number || null,
        };
      }),
    },
    on_road: {
      count: statuses.dispatched.count,
      value: statuses.dispatched.value,
      oldest_days: firstSent ? Math.max(0, -daysBetween(today, firstSent)) : null,
      items: inp.onRoadRows.map((r) => ({
        id: num(r.id),
        challan_number: r.challan_number,
        customer_name: r.reason === 'STOCK_TRANSFER' ? null : r.customer_name || null,
        reason: r.reason,
        reason_label: reasonLabel(r.reason),
        route: r.reason === 'STOCK_TRANSFER' ? `${r.from_name || 'Warehouse'} → ${r.to_name || 'Warehouse'}` : r.from_name || null,
        sent_on: r.sent_on,
        days: r.sent_on ? Math.max(0, -daysBetween(today, r.sent_on)) : 0,
        total_value: money(r.total_value),
        vehicle_number: r.vehicle_number || null,
      })),
    },
    to_invoice: {
      count: num(inp.toInvoice?.n),
      value: money(inp.toInvoice?.v),
      /** Of those, how many belong to a quotation that already has an invoice (they get linked to it). */
      link_count: num(inp.toInvoice?.link_n),
      items: inp.readyRows.map((r) => ({
        id: num(r.id),
        challan_number: r.challan_number,
        customer_name: r.customer_name || '—',
        quotation_id: r.quotation_id === null || r.quotation_id === undefined ? null : num(r.quotation_id),
        quotation_number: r.quotation_number || null,
        status: r.status,
        since: r.since,
        days: r.since ? Math.max(0, -daysBetween(today, r.since)) : 0,
        total_value: money(r.total_value),
        invoice_number: r.invoice_number || null,
      })),
    },
    eway_missing: { count: num(inp.eway?.n), value: money(inp.eway?.v), threshold: EWAY_BILL_THRESHOLD },
    backlog: {
      quotations: backlog.length,
      items: backlog.reduce((a, r) => a + r.pending_items, 0),
      value: money(backlog.reduce((a, r) => a + r.pending_value, 0)),
      list: backlog.slice(0, BACKLOG_ITEMS),
    },
    months,
    this_month: { from: `${cur.key}-01`, to: today, count: cur.count, value: cur.value, confirmed: cur.confirmed },
    last_month: { from: prevRange.from, to: prevRange.to, count: prev.count, value: prev.value },
    sent_change: pctChange(cur.count, prev.count),
    reasons: inp.reasonRows
      .map((r) => ({
        reason: String(r.reason || 'OTHER').toUpperCase(),
        label: reasonLabel(r.reason),
        count: num(r.n),
        value: money(r.v),
        share: share(num(r.n), reasonTotal),
      }))
      .sort((a, b) => b.count - a.count || b.value - a.value),
    /** Average days from dispatch to confirmed delivery (one decimal), last six months. */
    avg_days_to_deliver:
      speedN && hours !== null && hours !== undefined ? Math.round((num(hours) / 24) * 10) / 10 : null,
    delivered_count: speedN,
  };
};

export type ChallanSummary = ReturnType<typeof buildSummary>;
