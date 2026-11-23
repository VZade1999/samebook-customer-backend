// Pure rules for step 2 of the linking plan — bill what was delivered:
//   - the ledger of each ordered line: ordered / sent / billed / what's left
//   - what an invoice bills (from delivery challans, or chosen quantities of a
//     quotation) and the checks that stop billing more than was ordered
//   - the invoice totals, with the same formula as the quotation
//   - which challans can share one invoice
//   - when an invoice can be cancelled
// No database access here, so it is unit-tested.
import { gstBase } from '../common/transport-gst.rules';

/** Quantities have 3 decimals. */
export const EPS = 0.0005;
export const MAX_CHALLANS_PER_INVOICE = 50;
export const MAX_TRANSPORT = 10_000_000;
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;

export const DEAD_INVOICE_STATUSES = ['CANCELLED', 'SUPERSEDED'];
export const liveInvoiceSql = (alias: string) => `COALESCE(${alias}.status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`;
export const isLiveInvoice = (status: unknown) => !DEAD_INVOICE_STATUSES.includes(String(status ?? '').toUpperCase());

/** Challans whose goods left (they count as "sent"); only the first two can still be billed. */
export const SENT_STATUSES = ['DISPATCHED', 'DELIVERED', 'INVOICED'];
export const READY_STATUSES = ['DISPATCHED', 'DELIVERED'];
/** Quotation statuses that mean "approved" (old data also has the dispatched ones). */
export const BILLABLE_QUOTATION_STATUSES = ['APPROVED', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'];

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (v: unknown) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const round3 = (v: unknown) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;
/** 2, 2.5, 2.125 — no trailing zeros. */
export const fmtQty = (v: unknown) => String(round3(v));

// ── SQL pieces (alias qi = quotation_items) ────────────────────────────────

/** Quantity of an ordered line on challans whose goods left. */
export const SENT_QTY_SQL = `COALESCE((SELECT SUM(dci.quantity) FROM delivery_challan_items dci
  JOIN delivery_challans dc ON dc.id = dci.delivery_challan_id
  WHERE dci.quotation_item_id = qi.id AND dc.is_active = 1 AND dc.status IN ('DISPATCHED', 'DELIVERED', 'INVOICED')), 0)`;

/** Quantity of an ordered line on live invoices. */
export const BILLED_QTY_SQL = `COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii
  JOIN invoices bi ON bi.id = ii.invoice_id
  WHERE ii.quotation_item_id = qi.id AND ${liveInvoiceSql('bi')}), 0)`;

/** True when every line of quotation `alias` is billed in full. */
export const fullyBilledSql = (alias: string) =>
  `(NOT EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.quotation_id = ${alias} AND qi.qty > ${BILLED_QTY_SQL} + ${EPS}))`;

/** True when some line of quotation `alias` still has something to bill. */
export const leftToBillSql = (alias: string) =>
  `EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.quotation_id = ${alias} AND qi.qty > ${BILLED_QTY_SQL} + ${EPS})`;

// ── Ledger ─────────────────────────────────────────────────────────────────

export interface LedgerRow {
  quotation_item_id: number;
  quotation_id: number;
  product_name: string;
  description?: string | null;
  hsn_code?: string | null;
  unit?: string | null;
  ordered: unknown;
  rate: unknown;
  discount_percent: unknown;
  sent: unknown;
  billed: unknown;
}

export interface Balance {
  quotation_item_id: number;
  quotation_id: number;
  product_name: string;
  unit: string | null;
  ordered: number;
  sent: number;
  billed: number;
  to_send: number;
  to_bill: number;
  /** Sent on challans but not on an invoice yet. */
  sent_not_billed: number;
  /** Net price per unit (after the line discount), for "value left to bill". */
  net_rate: number;
}

export const balanceOf = (r: LedgerRow): Balance => {
  const ordered = round3(r.ordered);
  const sent = round3(r.sent);
  const billed = round3(r.billed);
  const pct = num(r.discount_percent);
  return {
    quotation_item_id: Number(r.quotation_item_id),
    quotation_id: Number(r.quotation_id),
    product_name: r.product_name,
    unit: r.unit || null,
    ordered,
    sent,
    billed,
    to_send: Math.max(0, round3(ordered - sent)),
    to_bill: Math.max(0, round3(ordered - billed)),
    sent_not_billed: Math.max(0, round3(sent - billed)),
    net_rate: round2(num(r.rate) * (1 - pct / 100)),
  };
};

export const fullyBilled = (rows: { ordered: unknown; billed: unknown }[]) =>
  rows.length > 0 && rows.every((r) => num(r.billed) + EPS >= num(r.ordered));

/** Order progress in % of ordered value (net of line discounts). */
export const progressOf = (rows: Balance[]) => {
  const value = (q: (b: Balance) => number) => rows.reduce((s, b) => s + q(b) * b.net_rate, 0);
  const ordered = value((b) => b.ordered);
  const pct = (v: number) => (ordered > 0 ? Math.min(100, Math.round((v / ordered) * 100)) : 0);
  return {
    sent_pct: pct(value((b) => Math.min(b.sent, b.ordered))),
    billed_pct: pct(value((b) => Math.min(b.billed, b.ordered))),
    to_bill_value: round2(value((b) => b.to_bill)),
  };
};

// ── What an invoice bills ──────────────────────────────────────────────────

export interface BillLine {
  quotation_item_id: number | null;
  quotation_id: number | null;
  delivery_challan_id?: number | null;
  delivery_challan_item_id?: number | null;
  product_name: string;
  description?: string | null;
  hsn_code?: string | null;
  unit?: string | null;
  qty: number;
  rate: number;
  discount_percent: number;
}

/**
 * Quantities asked for from a quotation: `requested` is [{quotation_item_id,
 * qty}] or missing (= everything not billed yet). Returns the lines to bill
 * or the first problem.
 */
export const parseQuantities = (
  requested: unknown,
  ledger: LedgerRow[],
): { ok: true; lines: BillLine[] } | { ok: false; message: string } => {
  const byId = new Map(ledger.map((r) => [Number(r.quotation_item_id), r]));
  let wanted: { id: number; qty: number }[];
  if (requested === undefined || requested === null) {
    wanted = ledger.map((r) => ({ id: Number(r.quotation_item_id), qty: balanceOf(r).to_bill })).filter((w) => w.qty > EPS);
    if (!wanted.length) return { ok: false, message: 'Everything on this quotation is already billed' };
  } else {
    if (!Array.isArray(requested) || requested.length > 500) return { ok: false, message: 'Choose what to bill' };
    wanted = [];
    for (const raw of requested as any[]) {
      const id = Number(raw?.quotation_item_id);
      const qty = Number(raw?.qty);
      if (!byId.has(id)) return { ok: false, message: 'An item is no longer on this quotation — reopen the dialog and try again' };
      if (!Number.isFinite(qty) || qty < 0) return { ok: false, message: `Enter a valid quantity for ${byId.get(id)!.product_name}` };
      if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return { ok: false, message: 'Quantities can have at most 3 decimals' };
      if (qty > EPS) wanted.push({ id, qty: round3(qty) });
    }
    if (!wanted.length) return { ok: false, message: 'Enter a quantity to bill for at least one item' };
  }
  const lines = wanted.map(({ id, qty }) => {
    const r = byId.get(id)!;
    return {
      quotation_item_id: id,
      quotation_id: Number(r.quotation_id),
      product_name: r.product_name,
      description: r.description ?? null,
      hsn_code: r.hsn_code ?? null,
      unit: r.unit ?? null,
      qty,
      rate: num(r.rate),
      discount_percent: num(r.discount_percent),
    };
  });
  const over = overBilled(lines, ledger);
  return over ? { ok: false, message: over } : { ok: true, lines };
};

/** First ordered line the lines would bill beyond what's left, as a message. */
export const overBilled = (lines: BillLine[], ledger: LedgerRow[]): string | null => {
  const byId = new Map(ledger.map((r) => [Number(r.quotation_item_id), r]));
  const want = new Map<number, number>();
  lines.forEach((l) => {
    if (l.quotation_item_id) want.set(l.quotation_item_id, (want.get(l.quotation_item_id) || 0) + num(l.qty));
  });
  for (const [id, qty] of want) {
    const r = byId.get(id);
    if (!r) return 'An item is no longer on its quotation — reopen the dialog and try again';
    const left = balanceOf(r).to_bill;
    if (qty > left + EPS) {
      const unit = r.unit ? ` ${r.unit}` : '';
      return left <= EPS
        ? `${r.product_name} is already billed in full`
        : `${r.product_name}: only ${fmtQty(left)}${unit} left to bill, not ${fmtQty(qty)}${unit}`;
    }
  }
  return null;
};

// ── Totals (the quotation's formula) ──────────────────────────────────────

/** The money side of a quotation the invoice bills from. */
export interface QuotationMoney {
  id: number;
  sub_total: unknown;
  /** Line discounts + the overall flat discount, as the quotation stores it. */
  discount_amount: unknown;
  /** Σ of its lines' discount_amount. */
  items_discount_total: unknown;
  cgst_percent: unknown;
  sgst_percent: unknown;
  igst_percent: unknown;
  transport_charges?: unknown;
}

export interface PricedLine extends BillLine {
  discount_amount: number;
  discounted_rate: number;
  total: number;
}

export const priceLine = (l: BillLine): PricedLine => {
  const gross = num(l.qty) * num(l.rate);
  const disc = (num(l.discount_percent) / 100) * gross;
  return {
    ...l,
    qty: round3(l.qty),
    discount_amount: round2(disc),
    discounted_rate: num(l.qty) > 0 ? round2((gross - disc) / num(l.qty)) : 0,
    total: round2(gross - disc),
  };
};

/**
 * Invoice totals: sub-total of qty × rate, line discounts plus each
 * quotation's overall discount shared by the value billed, GST at the
 * quotation's rates on the taxable value, plus transport. With
 * `transportGst` (the company's setting when the invoice is made — the GST
 * rule), transport is part of the taxable value and carries the same GST.
 * Billing a whole quotation at once reproduces it when both were worked out
 * the same way. `taxable` is the value GST is charged on.
 */
export const invoiceTotals = (lines: BillLine[], quotations: Map<number, QuotationMoney>, transport: number, transportGst: boolean) => {
  let gross = 0;
  let lineDisc = 0;
  const netByQuotation = new Map<number, number>();
  lines.forEach((l) => {
    const g = num(l.qty) * num(l.rate);
    const d = (num(l.discount_percent) / 100) * g;
    gross += g;
    lineDisc += d;
    if (l.quotation_id) netByQuotation.set(l.quotation_id, (netByQuotation.get(l.quotation_id) || 0) + (g - d));
  });
  let overall = 0;
  for (const [qid, billedNet] of netByQuotation) {
    const q = quotations.get(qid);
    if (!q) continue;
    const flat = Math.max(0, round2(num(q.discount_amount) - num(q.items_discount_total)));
    const base = num(q.sub_total) - num(q.items_discount_total);
    if (flat > 0 && base > 0) overall += flat * Math.min(1, billedNet / base);
  }
  const first = quotations.get(lines.find((l) => l.quotation_id)?.quotation_id as number) || ([...quotations.values()][0] as QuotationMoney | undefined);
  const cgstPct = num(first?.cgst_percent);
  const sgstPct = num(first?.sgst_percent);
  const igstPct = num(first?.igst_percent);

  const subTotal = round2(gross);
  const discount = round2(lineDisc + overall);
  const itemsTaxable = round2(subTotal - discount);
  const t = round2(transport);
  const taxable = gstBase(itemsTaxable, t, transportGst);
  const cgst = round2((taxable * cgstPct) / 100);
  const sgst = round2((taxable * sgstPct) / 100);
  const igst = round2((taxable * igstPct) / 100);
  return {
    sub_total: subTotal,
    discount_percent: subTotal > 0 ? round2((discount / subTotal) * 100) : 0,
    discount_amount: discount,
    items_taxable: itemsTaxable,
    taxable,
    cgst_percent: cgstPct,
    cgst_amount: cgst,
    sgst_percent: sgstPct,
    sgst_amount: sgst,
    igst_percent: igstPct,
    igst_amount: igst,
    transport_charges: t,
    transport_gst: transportGst ? 1 : 0,
    grand_total: round2(itemsTaxable + cgst + sgst + igst + t),
  };
};

// ── An invoice without a quotation (walk-in sale, challans made without one) ──

export interface TaxRates {
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * The GST split for the seller's and buyer's states (same as quotations):
 * no GSTIN → no GST; same state → CGST + SGST; else IGST. When only the
 * other kind was typed (the screen judged the states differently), the same
 * total rate is split this way instead of silently billing without GST.
 */
export const applyTaxType = (taxType: 'INTRA_STATE' | 'INTER_STATE' | 'NO_GST', r: Partial<TaxRates>): TaxRates => {
  if (taxType === 'NO_GST') return { cgst: 0, sgst: 0, igst: 0 };
  const intra = num(r.cgst) + num(r.sgst);
  if (taxType === 'INTRA_STATE') {
    if (intra > 0 || num(r.igst) <= 0) return { cgst: num(r.cgst), sgst: num(r.sgst), igst: 0 };
    const half = round2(num(r.igst) / 2);
    return { cgst: half, sgst: half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: num(r.igst) > 0 ? num(r.igst) : round2(intra) };
};

/** Lines typed in the invoice editor; returns them checked, or the first problem. */
export const parseDirectLines = (items: unknown): { ok: true; lines: BillLine[] } | { ok: false; message: string } => {
  if (!Array.isArray(items) || !items.length) return { ok: false, message: 'Add at least one item' };
  if (items.length > 500) return { ok: false, message: 'An invoice can have at most 500 items' };
  const lines: BillLine[] = [];
  for (const [i, raw] of (items as any[]).entries()) {
    const name = String(raw?.product_name ?? '').trim();
    const where = name || `Item ${i + 1}`;
    const qty = Number(raw?.qty);
    const rate = Number(raw?.rate);
    const pct = Number(raw?.discount_percent || 0);
    if (!name) return { ok: false, message: `${where}: enter the item name` };
    if (name.length > 255) return { ok: false, message: `${where}: the name is too long` };
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: `${where}: enter a quantity above zero` };
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) return { ok: false, message: `${where}: quantities can have at most 3 decimals` };
    if (!Number.isFinite(rate) || rate < 0) return { ok: false, message: `${where}: enter a valid rate` };
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: `${where}: the discount must be between 0 and 100%` };
    lines.push({
      quotation_item_id: null,
      quotation_id: null,
      product_name: name,
      description: raw?.description ? String(raw.description).slice(0, 2000) : null,
      hsn_code: raw?.hsn_code ? String(raw.hsn_code).trim().slice(0, 20) : null,
      unit: raw?.unit ? String(raw.unit).trim().slice(0, 30) : null,
      qty: round3(qty),
      rate: round2(rate),
      discount_percent: round2(pct),
    });
  }
  return { ok: true, lines };
};

/** Totals of an invoice without a quotation — the same formula as invoiceTotals. */
export const directTotals = (lines: BillLine[], overallDiscount: unknown, transport: number, rates: TaxRates, transportGst: boolean) => {
  let gross = 0;
  let lineDisc = 0;
  lines.forEach((l) => {
    const g = num(l.qty) * num(l.rate);
    gross += g;
    lineDisc += (num(l.discount_percent) / 100) * g;
  });
  const overall = Math.max(0, num(overallDiscount));
  const subTotal = round2(gross);
  const discount = round2(lineDisc + overall);
  const itemsTaxable = round2(subTotal - discount);
  const t = round2(transport);
  const taxable = gstBase(itemsTaxable, t, transportGst);
  const cgst = round2((taxable * rates.cgst) / 100);
  const sgst = round2((taxable * rates.sgst) / 100);
  const igst = round2((taxable * rates.igst) / 100);
  return {
    sub_total: subTotal,
    discount_percent: subTotal > 0 ? round2((discount / subTotal) * 100) : 0,
    discount_amount: discount,
    items_taxable: itemsTaxable,
    taxable,
    cgst_percent: rates.cgst,
    cgst_amount: cgst,
    sgst_percent: rates.sgst,
    sgst_amount: sgst,
    igst_percent: rates.igst,
    igst_amount: igst,
    transport_charges: t,
    transport_gst: transportGst ? 1 : 0,
    grand_total: round2(itemsTaxable + cgst + sgst + igst + t),
  };
};

/** Transport suggested: each quotation's transport, on its first invoice only. */
export const suggestedTransport = (quotations: { id: number; transport_charges?: unknown; has_live_invoice?: boolean }[]) =>
  round2(quotations.reduce((s, q) => s + (q.has_live_invoice ? 0 : num(q.transport_charges)), 0));

export const parseTransport = (v: unknown, fallback: number): { ok: true; value: number } | { ok: false; message: string } => {
  if (v === undefined || v === null || v === '') return { ok: true, value: round2(fallback) };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'Transport charges must be zero or more' };
  if (n > MAX_TRANSPORT) return { ok: false, message: 'Transport charges look too large' };
  return { ok: true, value: round2(n) };
};

// ── Which challans can share an invoice ───────────────────────────────────

const parseJson = (v: unknown): any => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
const clean = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** What an invoice address must have (GST: the recipient's address with its state). */
const ADDRESS_FIELDS: [string, string][] = [
  ['address_line_1', 'address line'],
  ['city', 'city'],
  ['state', 'state'],
  ['country', 'country'],
  ['postal_code', 'PIN code'],
];
const deepParse = (v: unknown): any => {
  let p: any = v;
  try {
    while (typeof p === 'string') p = JSON.parse(p);
  } catch {
    return null;
  }
  return p;
};

/** The parts an address is missing, in words ("address line", "PIN code"); [] when complete. */
export const missingAddress = (snapshot: unknown): string[] => {
  const a = deepParse(snapshot);
  if (!a || typeof a !== 'object') return ADDRESS_FIELDS.map(([, label]) => label);
  return ADDRESS_FIELDS.filter(([k]) => a[k] === null || a[k] === undefined || String(a[k]).trim() === '').map(([, label]) => label);
};

/** "a", "a or b", "a, b or c". */
export const orList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** An address, reduced to the parts that make it the same place. */
export const addressKey = (snapshot: unknown) => {
  const a = parseJson(snapshot) || {};
  return [a.address_line_1, a.address_line_2, a.city, a.state, a.postal_code].map(clean).join('|');
};
export const ratesKey = (q: { cgst_percent?: unknown; sgst_percent?: unknown; igst_percent?: unknown }) =>
  [q.cgst_percent, q.sgst_percent, q.igst_percent].map((v) => round2(v)).join('/');

export interface MergeChallan {
  id: number;
  challan_number: string;
  customer_id: unknown;
  quotation_id: unknown;
  shipping_address_snapshot: unknown;
}
export interface MergeQuotation {
  id: number;
  quotation_number: string;
  customer_id: unknown;
  billing_address_snapshot: unknown;
  cgst_percent?: unknown;
  sgst_percent?: unknown;
  igst_percent?: unknown;
}

/** Why these challans can't go on one invoice, or null when they can. */
export const mergeProblem = (challans: MergeChallan[], quotations: Map<number, MergeQuotation>): string | null => {
  if (!challans.length) return 'Choose the challans to bill';
  if (challans.length > MAX_CHALLANS_PER_INVOICE) return `Bill at most ${MAX_CHALLANS_PER_INVOICE} challans on one invoice`;
  const first = challans[0];
  for (const c of challans) {
    if (!c.quotation_id) return `${c.challan_number} was made without a quotation — billing those comes in a later step`;
    if (!quotations.get(Number(c.quotation_id))) return `${c.challan_number}: its quotation is not approved`;
    if (Number(c.customer_id) !== Number(first.customer_id)) return 'All challans on one invoice must be for the same customer';
  }
  const qs = [...new Set(challans.map((c) => Number(c.quotation_id)))].map((id) => quotations.get(id)!);
  for (const q of qs) {
    if (Number(q.customer_id) !== Number(first.customer_id)) return `${q.quotation_number} is for a different customer`;
    if (ratesKey(q) !== ratesKey(qs[0])) return `${q.quotation_number} has a different GST rate — bill it on its own invoice`;
    if (addressKey(q.billing_address_snapshot) !== addressKey(qs[0].billing_address_snapshot)) {
      return `${q.quotation_number} has a different billing address — bill it on its own invoice`;
    }
  }
  const ship = addressKey(first.shipping_address_snapshot);
  const other = challans.find((c) => addressKey(c.shipping_address_snapshot) !== ship);
  if (other) return `${other.challan_number} goes to a different delivery address — bill it on its own invoice`;
  return null;
};

/** Challans that can go together share this key (same rates, billing and delivery address). */
export const mergeKey = (c: MergeChallan, q: MergeQuotation | undefined) =>
  q ? `${Number(c.customer_id)}#${ratesKey(q)}#${addressKey(q.billing_address_snapshot)}#${addressKey(c.shipping_address_snapshot)}` : '';

// ── Dispatch details (an invoice that travels with the goods) ─────────────

export interface Dispatch {
  transporter_name: string | null;
  vehicle_number: string | null;
  lr_number: string | null;
  eway_bill_number: string | null;
}

/**
 * Cleans the dispatch details typed for an invoice. Vehicle numbers are kept
 * upper-case; an e-way bill number has 12 digits (spaces are ignored).
 * Only the fields present in `body` are returned.
 */
export const parseDispatch = (body: any): { ok: true; values: Partial<Dispatch> } | { ok: false; message: string } => {
  const values: Partial<Dispatch> = {};
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim().replace(/\s+/g, ' ');
  if (body?.transporter_name !== undefined) {
    const t = str(body.transporter_name);
    if (t.length > 100) return { ok: false, message: 'Keep the transporter name under 100 characters' };
    values.transporter_name = t || null;
  }
  if (body?.vehicle_number !== undefined) {
    const v = str(body.vehicle_number).toUpperCase();
    if (v.length > 20) return { ok: false, message: 'The vehicle number looks too long' };
    if (v && !/^[A-Z0-9][A-Z0-9 -]*$/.test(v)) return { ok: false, message: 'A vehicle number has only letters, digits, spaces and dashes' };
    values.vehicle_number = v || null;
  }
  if (body?.lr_number !== undefined) {
    const l = str(body.lr_number);
    if (l.length > 50) return { ok: false, message: 'Keep the LR number under 50 characters' };
    values.lr_number = l || null;
  }
  if (body?.eway_bill_number !== undefined) {
    const e = str(body.eway_bill_number).replace(/\s/g, '');
    if (e && !/^\d{12}$/.test(e)) return { ok: false, message: 'An e-way bill number has 12 digits' };
    values.eway_bill_number = e || null;
  }
  return { ok: true, values };
};

// ── Cancelling an invoice ─────────────────────────────────────────────────

export const cancelBlocker = (inv: { status?: unknown; paid_amount?: unknown }): string | null => {
  if (!isLiveInvoice(inv.status)) return 'This invoice is already cancelled';
  if (num(inv.paid_amount) > 0.005) {
    return "Payments are recorded on this invoice, so it can't be cancelled. Settle it with a credit note instead.";
  }
  return null;
};

export const parseCancelReason = (v: unknown): { ok: true; reason: string } | { ok: false; message: string } => {
  const reason = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (reason.length < CANCEL_REASON_MIN) return { ok: false, message: 'Say why the invoice is cancelled' };
  if (reason.length > CANCEL_REASON_MAX) return { ok: false, message: `Keep the reason under ${CANCEL_REASON_MAX} characters` };
  return { ok: true, reason };
};

/** Where a challan goes back to when its invoice is cancelled. */
export const statusAfterUnbill = (c: { delivered_at?: unknown }) => (c.delivered_at ? 'DELIVERED' : 'DISPATCHED');
