// Pure rules for the "linked documents" trail — quotation → delivery challans
// → invoices → payments, plus the order balance — and for the find-any-number
// search. Nothing here touches the database, so it is unit-tested.
//
// Since step 2 a quotation can have several invoices, each billing chosen
// challans or quantities, and one invoice can bill challans of several
// quotations. A challan's goods are billed on the invoice it is linked to; an
// unlinked challan whose quotation is billed in full counts as billed on the
// newest invoice of that quotation ("not linked yet").

import { GST_STATE_CODES, getStateCodeFromGstin, getStateCodeFromName } from '../common/gst-state.util';
import { Balance, LedgerRow, balanceOf, fullyBilled, progressOf } from '../invoice/billing.rules';

export const DOC_TYPES = ['quotation', 'challan', 'invoice'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const parseDocType = (v: unknown): DocType | null => {
  const s = String(v ?? '').trim().toLowerCase();
  return (DOC_TYPES as readonly string[]).includes(s) ? (s as DocType) : null;
};

/** The permission needed to open each kind of document. */
export const VIEW_PERMISSION: Record<DocType, string> = {
  quotation: 'quotations.view',
  challan: 'challans.view',
  invoice: 'invoices.view',
};

export type Access = Record<DocType, boolean>;

export const accessOf = (permissions: unknown): Access => {
  const list = Array.isArray(permissions) ? permissions.map(String) : [];
  return {
    quotation: list.includes(VIEW_PERMISSION.quotation),
    challan: list.includes(VIEW_PERMISSION.challan),
    invoice: list.includes(VIEW_PERMISSION.invoice),
  };
};

/** Cancelled and replaced invoices stay on record but bill nothing. */
export const DEAD_INVOICE_STATUSES = ['CANCELLED', 'SUPERSEDED'];
export const isLiveInvoice = (status: unknown) => !DEAD_INVOICE_STATUSES.includes(String(status ?? '').toUpperCase());

/** Challans whose goods actually left (drafts and cancelled ones never did). */
export const MOVED_STATUSES = ['DISPATCHED', 'DELIVERED', 'INVOICED'];
export const hasMoved = (status: unknown) => MOVED_STATUSES.includes(String(status ?? '').toUpperCase());

/**
 * The invoice a challan's goods are billed on: the one it is linked to, else
 * the quotation's live invoice once the goods have left (`linked: false`).
 */
export const billedOn = (
  challan: { invoice_id?: unknown; status?: unknown },
  quotationInvoiceId: number | null,
): { id: number | null; linked: boolean } => {
  const own = Number(challan.invoice_id) || null;
  if (own) return { id: own, linked: true };
  if (quotationInvoiceId && hasMoved(challan.status)) return { id: quotationInvoiceId, linked: false };
  return { id: null, linked: false };
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

const parseJson = (v: unknown): any => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/**
 * Place of supply for goods: the state where the goods are delivered (the
 * shipping address), else the billing address state, else the buyer GSTIN's
 * state. Known names are normalised to the GST list with their 2-digit code.
 */
export const placeOfSupply = (
  shipping: unknown,
  billing: unknown,
  buyerGstin?: string | null,
): { state: string; code: string | null } | null => {
  const ship = parseJson(shipping);
  const bill = parseJson(billing);
  const state = text(ship?.state) || text(bill?.state);
  if (state) {
    const code = getStateCodeFromName(state);
    return { state: code ? GST_STATE_CODES[code] : state, code };
  }
  const code = getStateCodeFromGstin(buyerGstin);
  return code ? { state: GST_STATE_CODES[code], code } : null;
};

// ── Trail ──────────────────────────────────────────────────────────────────

export interface QuotationRow {
  id: number;
  quotation_number: string;
  quotation_date?: string | null;
  status?: string | null;
  has_invoice?: unknown;
  customer_name?: string | null;
  grand_total?: unknown;
  customer_po_number?: string | null;
  customer_po_date?: string | null;
}

export interface ChallanRow {
  id: number;
  challan_number: string;
  challan_date?: string | null;
  status?: string | null;
  reason?: string | null;
  quotation_id?: unknown;
  total_quantity?: unknown;
  total_value?: unknown;
  vehicle_number?: string | null;
  transporter_name?: string | null;
  eway_bill_number?: string | null;
  invoice_id?: unknown;
}

export interface InvoiceRow {
  id: number;
  invoice_number: string;
  invoice_date?: string | null;
  due_date?: string | null;
  status?: string | null;
  grand_total?: unknown;
  paid_amount?: unknown;
  balance_amount?: unknown;
  shipping_address_snapshot?: unknown;
  billing_address_snapshot?: unknown;
  customer_gst_number?: string | null;
  quotation_id?: unknown;
  /** Quotations its lines bill (an invoice can bill several). */
  quotation_ids?: number[];
  // Its own dispatch details, when it travels with the goods.
  transporter_name?: string | null;
  vehicle_number?: string | null;
  lr_number?: string | null;
  eway_bill_number?: string | null;
}

/** A challan sent against an invoice made first (bill first, send in lots — GST Rule 55(5)). */
export const isLotChallan = (c: { invoice_id?: unknown; status?: unknown }) =>
  !!Number(c.invoice_id) && ['DISPATCHED', 'DELIVERED'].includes(String(c.status ?? '').toUpperCase());

export interface PaymentRow {
  invoice_id: number;
  n: unknown;
  amount: unknown;
  last_date?: string | null;
}

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const qty = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);

/** Does this invoice bill that quotation (by its header or by its lines)? */
const bills = (i: InvoiceRow, quotationId: number) =>
  Number(i.quotation_id) === quotationId || (i.quotation_ids || []).map(Number).includes(quotationId);

export const buildTrail = (input: {
  focus: { type: DocType; id: number };
  access: Access;
  /** The family's quotations, the main one first (an invoice can bill several). */
  quotations: QuotationRow[];
  challans: ChallanRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  /** Ordered / sent / billed per line of those quotations (the order balance). */
  ledger?: LedgerRow[];
}) => {
  const { focus, access } = input;
  const ledger = input.ledger;
  const balanceByQuotation = new Map<number, Balance[]>();
  (ledger || []).forEach((r) => {
    const list = balanceByQuotation.get(Number(r.quotation_id)) || [];
    list.push(balanceOf(r));
    balanceByQuotation.set(Number(r.quotation_id), list);
  });
  // An unlinked challan counts as billed only when its quotation is billed in
  // full — then on the newest live invoice billing that quotation. (Without a
  // ledger, the newest live invoice of the family is used.)
  const liveNewestFirst = [...input.invoices].filter((i) => isLiveInvoice(i.status)).sort((a, b) => Number(b.id) - Number(a.id));
  const coveringInvoiceOf = (quotationId: number | null): number | null => {
    if (!quotationId) return null;
    if (ledger) {
      const rows = balanceByQuotation.get(quotationId) || [];
      if (!fullyBilled(rows)) return null;
      const inv = liveNewestFirst.find((i) => bills(i, quotationId));
      return inv ? Number(inv.id) : null;
    }
    return liveNewestFirst[0] ? Number(liveNewestFirst[0].id) : null;
  };
  const mainQuotationId = input.quotations[0] ? Number(input.quotations[0].id) : null;
  const invoiceById = new Map(input.invoices.map((i) => [Number(i.id), i]));

  const paid = new Map(input.payments.map((p) => [Number(p.invoice_id), p]));
  const payments = input.payments.reduce(
    (acc, p) => ({
      count: acc.count + Number(p.n || 0),
      amount: money(acc.amount + money(p.amount)),
      last_date: [acc.last_date, day(p.last_date)].filter(Boolean).sort().pop() || null,
    }),
    { count: 0, amount: 0, last_date: null as string | null },
  );

  // Lots: challans travelling against an invoice made first, numbered per
  // invoice in the order they went out; the last one is the lot after which
  // nothing of its quotation is left to send (the original invoice goes with it).
  const sorted = [...input.challans].sort(
    (a, b) => String(a.challan_date ?? '').localeCompare(String(b.challan_date ?? '')) || Number(a.id) - Number(b.id),
  );
  const lotNumber = new Map<number, number>();
  const lotsOfInvoice = new Map<number, number[]>();
  sorted.filter(isLotChallan).forEach((c) => {
    const list = lotsOfInvoice.get(Number(c.invoice_id)) || [];
    list.push(Number(c.id));
    lotsOfInvoice.set(Number(c.invoice_id), list);
    lotNumber.set(Number(c.id), list.length);
  });
  const nothingLeftToSend = (quotationId: number | null) => {
    const rows = quotationId ? balanceByQuotation.get(quotationId) : undefined;
    return !!rows && rows.length > 0 && rows.every((r) => r.to_send <= 0);
  };

  const challans = sorted
    .map((c) => {
      const billed = billedOn(c, coveringInvoiceOf(Number(c.quotation_id) || mainQuotationId));
      const inv = billed.id ? invoiceById.get(billed.id) : null;
      return {
        id: Number(c.id),
        number: c.challan_number,
        date: day(c.challan_date),
        status: c.status || 'DRAFT',
        reason: c.reason || null,
        quotation_id: Number(c.quotation_id) || null,
        quantity: qty(c.total_quantity),
        value: access.challan ? money(c.total_value) : null,
        vehicle_number: c.vehicle_number || null,
        transporter_name: c.transporter_name || null,
        eway_bill_number: c.eway_bill_number || null,
        moved: hasMoved(c.status),
        invoice: inv ? { id: Number(inv.id), number: inv.invoice_number, date: day(inv.invoice_date), linked: billed.linked } : null,
        lot: lotNumber.has(Number(c.id))
          ? {
              number: lotNumber.get(Number(c.id)) as number,
              last:
                (lotsOfInvoice.get(Number(c.invoice_id)) || []).slice(-1)[0] === Number(c.id) &&
                nothingLeftToSend(Number(c.quotation_id) || mainQuotationId),
            }
          : null,
      };
    });

  const invoices = [...input.invoices]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((i) => {
      const p = paid.get(Number(i.id));
      return {
        id: Number(i.id),
        number: i.invoice_number,
        date: day(i.invoice_date),
        due_date: day(i.due_date),
        status: i.status || null,
        live: isLiveInvoice(i.status),
        total: access.invoice ? money(i.grand_total) : null,
        paid: access.invoice ? money(i.paid_amount) : null,
        balance: access.invoice ? money(i.balance_amount) : null,
        payments: access.invoice ? Number(p?.n || 0) : null,
      };
    });

  const quotations = input.quotations.map((q) => {
    const rows = balanceByQuotation.get(Number(q.id));
    return {
      id: Number(q.id),
      number: q.quotation_number,
      date: day(q.quotation_date),
      status: q.status || null,
      invoiced: Number(q.has_invoice) === 1 || q.has_invoice === true,
      customer_name: q.customer_name || null,
      total: access.quotation ? money(q.grand_total) : null,
      po_number: q.customer_po_number || null,
      po_date: day(q.customer_po_date),
      progress: rows ? progressOf(rows) : null,
      fully_billed: rows ? fullyBilled(rows) : null,
    };
  });
  const quotation = quotations[0] || null;

  // What the focused document prints in its reference boxes.
  const focusInvoice = focus.type === 'invoice' ? invoiceById.get(focus.id) || null : null;
  const focusChallan = focus.type === 'challan' ? challans.find((c) => c.id === focus.id) || null : null;
  // An invoice prints every quotation (and PO) it bills; others print their own.
  const printed = focusInvoice ? quotations.filter((q) => bills(focusInvoice, q.id) || q.id === mainQuotationId) : quotation ? [quotation] : [];
  const references = {
    po: quotation?.po_number ? { number: quotation.po_number, date: quotation.po_date } : null,
    quotation: quotation ? { number: quotation.number, date: quotation.date } : null,
    quotations: printed.map((q) => ({ number: q.number, date: q.date })),
    pos: printed.filter((q) => q.po_number).map((q) => ({ number: q.po_number as string, date: q.po_date })),
    // Challans whose goods this invoice bills (only those that actually left).
    challans: focusInvoice
      ? challans
          .filter((c) => c.moved && c.invoice?.id === Number(focusInvoice.id))
          .map((c) => ({
            number: c.number,
            date: c.date,
            vehicle_number: c.vehicle_number,
            transporter_name: c.transporter_name,
            eway_bill_number: c.eway_bill_number,
          }))
      : [],
    // The invoice this challan's goods are billed on.
    invoice: focusChallan?.invoice ? { number: focusChallan.invoice.number, date: focusChallan.invoice.date } : null,
    // A lot sent against an invoice made first: its number, and whether it is the last.
    lot: focusChallan?.lot || null,
    // The invoice's own dispatch details (when it travels with the goods).
    dispatch:
      focusInvoice && (focusInvoice.vehicle_number || focusInvoice.transporter_name || focusInvoice.lr_number || focusInvoice.eway_bill_number)
        ? {
            vehicle_number: focusInvoice.vehicle_number || null,
            transporter_name: focusInvoice.transporter_name || null,
            lr_number: focusInvoice.lr_number || null,
            eway_bill_number: focusInvoice.eway_bill_number || null,
          }
        : null,
  };

  return {
    focus,
    access,
    quotation,
    /** Further quotations an invoice of this family bills (monthly billing across orders). */
    other_quotations: quotations.slice(1),
    challans,
    invoices,
    payments: access.invoice ? payments : null,
    /** Line by line: ordered / sent / billed / still to send / sent, not billed. */
    balance: quotations
      .filter((q) => balanceByQuotation.has(q.id))
      .map((q) => ({ quotation_id: q.id, quotation_number: q.number, lines: balanceByQuotation.get(q.id) as Balance[] })),
    references,
    place_of_supply: focusInvoice
      ? placeOfSupply(focusInvoice.shipping_address_snapshot, focusInvoice.billing_address_snapshot, focusInvoice.customer_gst_number)
      : null,
  };
};

// ── Find any number ────────────────────────────────────────────────────────

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 60;
export const SEARCH_PER_TYPE = 6;

/** The text typed, trimmed and length-checked; null when too short to search. */
export const parseSearch = (v: unknown): string | null => {
  const s = text(v).replace(/\s+/g, ' ');
  if (s.length < SEARCH_MIN) return null;
  return s.slice(0, SEARCH_MAX);
};

/** For LIKE: % and _ typed by the user are matched literally. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Vehicle and e-way bill numbers are compared without spaces, dashes or dots. */
export const compact = (s: string) => s.toUpperCase().replace(/[\s\-./]/g, '');

/**
 * Exact match first; then numbers that start or end with what was typed
 * (people type the prefix or the running number, e.g. "0150" for
 * KD/26-27/0150); then anything merely containing it (often a date part).
 */
export const matchRank = (value: string | null | undefined, typed: string) => {
  const v = compact(String(value ?? ''));
  const t = compact(typed);
  if (!v || !t) return 3;
  if (v === t) return 0;
  if (v.startsWith(t) || v.endsWith(t)) return 1;
  return v.includes(t) ? 2 : 3;
};
