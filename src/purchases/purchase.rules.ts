// Pure rules for Purchases — suppliers, purchase orders (POs), goods received
// (GRN), supplier bills and payments to suppliers. No database here, so every
// rule is unit-tested (purchase.rules.spec.ts).
//
// Indian GST, as the buyer:
//   - only a REGISTERED supplier charges GST; a composition or unregistered
//     supplier bills without it;
//   - same state as the place of supply (where the goods are delivered) →
//     CGST + SGST, another state → IGST;
//   - every line keeps its own HSN and GST rate;
//   - freight / packing charged with the goods is part of the supply, so it
//     carries GST too, shared over the lines by value (company switch
//     "GST on transport", common/transport-gst.rules.ts);
//   - the total is rounded to the rupee with a round-off line.
import { GST_STATE_CODES, getStateCodeFromGstin, getStateCodeFromName } from '../common/gst-state.util';

export const PURCHASES_MODULE = 'purchases';
export const PURCHASE_PERMS = {
  view: 'purchases.view',
  create: 'purchases.create',
  approve: 'purchases.approve',
  receive: 'purchases.receive',
  bills: 'purchases.bills',
} as const;

export const GST_TYPES = ['REGISTERED', 'COMPOSITION', 'UNREGISTERED'] as const;
export type GstType = (typeof GST_TYPES)[number];
export const MSME_TYPES = ['MICRO', 'SMALL', 'MEDIUM'] as const;
export type MsmeType = (typeof MSME_TYPES)[number];
export const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CARD'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export type TaxType = 'INTRA_STATE' | 'INTER_STATE' | 'NO_GST';

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
/** Statuses whose PO can still be edited as a draft (before approval). */
export const DRAFT_STATUSES: PoStatus[] = ['DRAFT', 'PENDING_APPROVAL'];
/** Goods may arrive against these. */
export const RECEIVABLE_STATUSES: PoStatus[] = ['APPROVED', 'SENT', 'PARTLY_RECEIVED'];
/** An approved PO is changed by amending it in these. */
export const AMENDABLE_STATUSES: PoStatus[] = ['APPROVED', 'SENT', 'PARTLY_RECEIVED'];
/** Still expecting goods (for "on order" and "late"). */
export const OPEN_STATUSES: PoStatus[] = ['APPROVED', 'SENT', 'PARTLY_RECEIVED'];

export const DEFAULT_GST = 18;
export const LINES_MAX = 200;
export const QTY_MAX = 10_000_000;
export const MONEY_MAX = 1_000_000_000;
export const MSME_DAYS = 45;
export const ITC_DAYS = 180;
export const OVER_RECEIPT_MAX = 50;
export const SOON_DAYS = 7;

export const DEFAULT_PO_TERMS = [
  'Please quote our PO number and date on your invoice, delivery challan and all letters.',
  'Your tax invoice must show our GSTIN, and the HSN code and GST rate of every item.',
  'Goods are accepted after our inspection on arrival; rejected goods go back at your cost.',
  'Deliver to the address above by the expected date, with the e-way bill where one is needed.',
  'Payment as per the terms above, counted from when we receive the goods and a correct invoice.',
  'If you are a Micro or Small enterprise (MSME), please quote your Udyam registration number on the invoice.',
]
  .map((t, i) => `${i + 1}. ${t}`)
  .join('\n');

// ── Small helpers ──────────────────────────────────────────────────────────
export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (v: unknown) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const round3 = (v: unknown) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;
const EPS = 0.0005;
const decimals = (v: number, d: number) => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6;
const text = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const longText = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\r\n/g, '\n').trim();
  return s ? s.slice(0, max) : null;
};
const upper = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

// ── GSTIN, PAN, Udyam, bank ────────────────────────────────────────────────
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,}@[A-Za-z][\w.\-]*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 \-]{5,18}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

/** The check character of a GSTIN's first 14 characters (GSTN's mod-36 rule). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    const p = v * ((i % 2) + 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Null when the GSTIN is fine, else what's wrong with it. */
export function gstinProblem(raw: unknown): string | null {
  const g = upper(raw);
  if (g.length !== 15) return 'A GSTIN has 15 characters';
  if (!GSTIN_RE.test(g)) return "That GSTIN doesn't look right — it is like 27AAPFU0939F1ZV";
  if (!GST_STATE_CODES[g.slice(0, 2)]) return `${g.slice(0, 2)} is not a GST state code`;
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return "That GSTIN doesn't add up — check it for a typo (the last character is a check digit)";
  return null;
}

export const panFromGstin = (g: string) => upper(g).slice(2, 12);

// ── Suppliers ──────────────────────────────────────────────────────────────
export interface SupplierAddress {
  label: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  postal_code: string | null;
  country: string | null;
  gstin: string | null;
  is_primary: number;
}
export interface SupplierContact {
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  is_primary: number;
}
export interface SupplierInput {
  name: string;
  legal_name: string | null;
  gst_type: GstType;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  state_code: string | null;
  phone: string | null;
  email: string | null;
  msme_type: MsmeType | null;
  udyam_number: string | null;
  credit_days: number | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  upi_id: string | null;
  notes: string | null;
  addresses: SupplierAddress[];
  contacts: SupplierContact[];
}

const stateOf = (name: unknown, code: unknown): { state: string | null; state_code: string | null } => {
  const c = String(code ?? '').trim().padStart(2, '0');
  if (code && GST_STATE_CODES[c]) return { state: GST_STATE_CODES[c], state_code: c };
  const n = text(name, 60);
  const fromName = getStateCodeFromName(n);
  return { state: fromName ? GST_STATE_CODES[fromName] : n, state_code: fromName };
};

/** Checks a supplier sent by the form; fills state and PAN from the GSTIN. */
export function parseSupplier(body: any): Parsed<SupplierInput> {
  const name = text(body?.name, 200);
  if (!name) return fail("Enter the supplier's name");
  const gstinRaw = upper(body?.gstin);
  let gstType = upper(body?.gst_type) as GstType;
  if (!gstType) gstType = gstinRaw ? 'REGISTERED' : 'UNREGISTERED';
  if (!(GST_TYPES as readonly string[]).includes(gstType)) return fail('Choose how the supplier is registered under GST');
  let gstin: string | null = null;
  if (gstType === 'UNREGISTERED') {
    if (gstinRaw) return fail('An unregistered supplier has no GSTIN — remove it or choose "Registered"');
  } else {
    if (!gstinRaw) return fail(gstType === 'COMPOSITION' ? 'A composition supplier still has a GSTIN — enter it' : 'Enter the GSTIN (or choose "Unregistered")');
    const problem = gstinProblem(gstinRaw);
    if (problem) return fail(problem);
    gstin = gstinRaw;
  }
  let pan = upper(body?.pan) || (gstin ? panFromGstin(gstin) : '');
  if (pan && !PAN_RE.test(pan)) return fail("That PAN doesn't look right — it is like ABCDE1234F");
  if (gstin && pan && panFromGstin(gstin) !== pan) return fail("The PAN doesn't match the GSTIN (characters 3 to 12 of a GSTIN are the PAN)");
  const where = gstin ? { state: GST_STATE_CODES[gstin.slice(0, 2)], state_code: gstin.slice(0, 2) } : stateOf(body?.state, body?.state_code);

  const phone = text(body?.phone, 20);
  if (phone && !PHONE_RE.test(phone)) return fail('Enter a valid phone number');
  const email = text(body?.email, 150)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return fail('Enter a valid email address');

  let msme = upper(body?.msme_type) as MsmeType | '';
  const udyam = upper(body?.udyam_number);
  if (msme && !(MSME_TYPES as readonly string[]).includes(msme)) return fail('MSME type is Micro, Small or Medium');
  if (udyam && !UDYAM_RE.test(udyam)) return fail("That Udyam number doesn't look right — it is like UDYAM-MH-26-0012345");
  if (udyam && !msme) return fail('Choose whether the supplier is a Micro, Small or Medium enterprise');

  let credit: number | null = null;
  if (body?.credit_days !== undefined && body?.credit_days !== null && body?.credit_days !== '') {
    credit = Number(body.credit_days);
    if (!Number.isInteger(credit) || credit < 0 || credit > 365) return fail('Credit days are a whole number from 0 to 365');
  }

  const account = upper(body?.bank_account_number);
  if (account && !/^[0-9]{6,20}$/.test(account)) return fail('A bank account number has 6 to 20 digits');
  const ifsc = upper(body?.bank_ifsc);
  if (ifsc && !IFSC_RE.test(ifsc)) return fail("That IFSC doesn't look right — it is like SBIN0001234");
  const upi = text(body?.upi_id, 100);
  if (upi && !UPI_RE.test(upi)) return fail("That UPI ID doesn't look right — it is like name@bank");

  const rawAddresses = Array.isArray(body?.addresses) ? body.addresses : [];
  if (rawAddresses.length > 10) return fail('A supplier can have at most 10 addresses');
  const addresses: SupplierAddress[] = [];
  for (const [i, a] of rawAddresses.entries()) {
    const line1 = text(a?.address_line_1, 255);
    if (!line1) return fail(`Address ${i + 1}: enter the address line`);
    const pin = text(a?.postal_code, 10);
    if (pin && !PIN_RE.test(pin)) return fail(`Address ${i + 1}: a PIN code has 6 digits`);
    const branchGstin = upper(a?.gstin);
    if (branchGstin) {
      const problem = gstinProblem(branchGstin);
      if (problem) return fail(`Address ${i + 1}: ${problem}`);
    }
    const st = branchGstin ? { state: GST_STATE_CODES[branchGstin.slice(0, 2)], state_code: branchGstin.slice(0, 2) } : stateOf(a?.state, a?.state_code);
    addresses.push({
      label: text(a?.label, 60),
      address_line_1: line1,
      address_line_2: text(a?.address_line_2, 255),
      city: text(a?.city, 100),
      state: st.state,
      state_code: st.state_code,
      postal_code: pin,
      country: text(a?.country, 60) || 'India',
      gstin: branchGstin || null,
      is_primary: a?.is_primary ? 1 : 0,
    });
  }
  if (addresses.length && !addresses.some((a) => a.is_primary)) addresses[0].is_primary = 1;
  if (addresses.filter((a) => a.is_primary).length > 1) return fail('Only one address can be the main one');

  const rawContacts = Array.isArray(body?.contacts) ? body.contacts : [];
  if (rawContacts.length > 20) return fail('A supplier can have at most 20 contacts');
  const contacts: SupplierContact[] = [];
  for (const [i, c] of rawContacts.entries()) {
    const cname = text(c?.name, 120);
    if (!cname) return fail(`Contact ${i + 1}: enter the name`);
    const cphone = text(c?.phone, 20);
    if (cphone && !PHONE_RE.test(cphone)) return fail(`${cname}: enter a valid phone number`);
    const cemail = text(c?.email, 150)?.toLowerCase() ?? null;
    if (cemail && !EMAIL_RE.test(cemail)) return fail(`${cname}: enter a valid email address`);
    contacts.push({ name: cname, designation: text(c?.designation, 80), phone: cphone, email: cemail, is_primary: c?.is_primary ? 1 : 0 });
  }
  if (contacts.length && !contacts.some((c) => c.is_primary)) contacts[0].is_primary = 1;

  // The supplier's state: GSTIN first, else the main address.
  const main = addresses.find((a) => a.is_primary);
  const state = where.state_code ? where : main ? { state: main.state, state_code: main.state_code } : where;

  return {
    ok: true,
    value: {
      name,
      legal_name: text(body?.legal_name, 200),
      gst_type: gstType,
      gstin,
      pan: pan || null,
      state: state.state,
      state_code: state.state_code,
      phone,
      email,
      msme_type: (msme || null) as MsmeType | null,
      udyam_number: udyam || null,
      credit_days: credit,
      bank_account_name: text(body?.bank_account_name, 150),
      bank_account_number: account || null,
      bank_ifsc: ifsc || null,
      bank_name: text(body?.bank_name, 100),
      upi_id: upi,
      notes: longText(body?.notes, 2000),
      addresses,
      contacts,
    },
  };
}

/** Same name ignoring case and spaces. */
export const sameName = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// ── Tax type ───────────────────────────────────────────────────────────────
/**
 * Who charges what: only a registered supplier charges GST; then the
 * supplier's state against the place of supply (where the goods go). An
 * unknown place of supply is treated as another state (IGST), like sales.
 */
export function purchaseTaxType(supplier: { gst_type?: unknown; gstin?: unknown; state_code?: unknown }, placeOfSupplyCode: string | null): TaxType {
  if (String(supplier.gst_type ?? 'REGISTERED').toUpperCase() !== 'REGISTERED') return 'NO_GST';
  const from = getStateCodeFromGstin(String(supplier.gstin ?? '')) || (supplier.state_code ? String(supplier.state_code) : null);
  if (!from) return 'NO_GST';
  if (!placeOfSupplyCode) return 'INTER_STATE';
  return from === placeOfSupplyCode ? 'INTRA_STATE' : 'INTER_STATE';
}

export const placeCodeFrom = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    const s = String(c ?? '').trim();
    if (!s) continue;
    if (/^\d{1,2}$/.test(s) && GST_STATE_CODES[s.padStart(2, '0')]) return s.padStart(2, '0');
    const fromGstin = s.length === 15 ? getStateCodeFromGstin(s) : null;
    if (fromGstin) return fromGstin;
    const fromName = getStateCodeFromName(s);
    if (fromName) return fromName;
  }
  return null;
};

// ── Lines and totals (POs and bills) ───────────────────────────────────────
export interface DocLine {
  po_item_id?: number | null;
  product_id: number | null;
  item_name: string;
  description: string | null;
  hsn_code: string | null;
  unit: string | null;
  qty: number;
  rate: number;
  discount_percent: number;
  gst_rate: number;
}
export interface PricedDocLine extends DocLine {
  /** qty × rate after the line discount — the line's taxable value before freight. */
  amount: number;
  /** This line's share of taxed freight. */
  freight_share: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * Checks document lines. `gstFor(line)` gives the rate when the line doesn't
 * say (the product's own, else 18%). Lines from the product list are counted
 * in whole units, because stock is kept in whole numbers.
 */
export function parseLines(
  items: unknown,
  opts: { gstFor?: (raw: any) => number | null; requirePoItem?: boolean } = {},
): { ok: true; lines: DocLine[] } | { ok: false; message: string } {
  if (!Array.isArray(items) || !items.length) return fail('Add at least one item');
  if (items.length > LINES_MAX) return fail(`At most ${LINES_MAX} items on one document`);
  const lines: DocLine[] = [];
  for (const [i, raw] of (items as any[]).entries()) {
    const name = text(raw?.item_name ?? raw?.product_name, 255);
    const where = name || `Item ${i + 1}`;
    if (!name) return fail(`${where}: enter the item name`);
    const productId = Number(raw?.product_id) > 0 ? Number(raw.product_id) : null;
    const poItemId = Number(raw?.po_item_id) > 0 ? Number(raw.po_item_id) : null;
    if (opts.requirePoItem && !poItemId) return fail(`${where}: this line isn't on the purchase order`);
    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return fail(`${where}: enter a quantity above zero`);
    if (qty > QTY_MAX) return fail(`${where}: that quantity is too large`);
    if (!decimals(qty, 3)) return fail(`${where}: quantities can have at most 3 decimals`);
    if (productId && !decimals(qty, 0)) return fail(`${where}: stock is counted in whole units — enter a whole number`);
    const rate = Number(raw?.rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > MONEY_MAX) return fail(`${where}: enter a valid rate`);
    if (!decimals(rate, 2)) return fail(`${where}: a rate can have at most 2 decimals (paise)`);
    const disc = Number(raw?.discount_percent || 0);
    if (!Number.isFinite(disc) || disc < 0 || disc > 100) return fail(`${where}: the discount is between 0 and 100%`);
    let gst: number | null = raw?.gst_rate === undefined || raw?.gst_rate === null || raw?.gst_rate === '' ? null : Number(raw.gst_rate);
    if (gst === null) gst = opts.gstFor ? opts.gstFor(raw) : DEFAULT_GST;
    if (gst === null || !Number.isFinite(gst) || gst < 0 || gst > 100) return fail(`${where}: enter a GST rate between 0 and 100%`);
    const hsn = text(raw?.hsn_code, 20);
    if (hsn && !/^[0-9]{2,8}$/.test(hsn)) return fail(`${where}: an HSN / SAC code is 2 to 8 digits`);
    lines.push({
      ...(poItemId ? { po_item_id: poItemId } : {}),
      product_id: productId,
      item_name: name,
      description: longText(raw?.description, 2000),
      hsn_code: hsn,
      unit: text(raw?.unit, 30),
      qty: round3(qty),
      rate: round2(rate),
      discount_percent: round2(disc),
      gst_rate: round2(gst),
    });
  }
  return { ok: true, lines };
}

export const lineAmount = (l: { qty: unknown; rate: unknown; discount_percent?: unknown }) =>
  round2(num(l.qty) * num(l.rate) * (1 - num(l.discount_percent) / 100));

/**
 * Totals of a PO or bill: each line's taxable value; freight shared over the
 * lines by value and taxed with them when `freightTaxed`; GST per line at its
 * own rate (CGST and SGST are half each, IGST the whole); the grand total
 * rounded to the rupee.
 */
export function docTotals(lines: DocLine[], freightCharges: unknown, taxType: TaxType, freightTaxed: boolean) {
  const freight = Math.max(0, round2(freightCharges));
  const priced: PricedDocLine[] = lines.map((l) => ({ ...l, amount: lineAmount(l), freight_share: 0, cgst: 0, sgst: 0, igst: 0 }));
  const itemsValue = round2(priced.reduce((s, l) => s + l.amount, 0));
  const taxFreight = freightTaxed && freight > 0 && taxType !== 'NO_GST';
  if (taxFreight && priced.length) {
    // Share by value; the biggest line takes the paise left over.
    let given = 0;
    priced.forEach((l) => {
      l.freight_share = itemsValue > 0 ? round2((freight * l.amount) / itemsValue) : 0;
      given += l.freight_share;
    });
    const biggest = priced.reduce((b, l) => (l.amount > b.amount ? l : b), priced[0]);
    biggest.freight_share = round2(biggest.freight_share + freight - given);
  }
  priced.forEach((l) => {
    if (taxType === 'NO_GST') return;
    const base = l.amount + l.freight_share;
    if (taxType === 'INTRA_STATE') {
      l.cgst = round2((base * l.gst_rate) / 200);
      l.sgst = l.cgst;
    } else {
      l.igst = round2((base * l.gst_rate) / 100);
    }
  });
  const gross = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0));
  const cgst = round2(priced.reduce((s, l) => s + l.cgst, 0));
  const sgst = round2(priced.reduce((s, l) => s + l.sgst, 0));
  const igst = round2(priced.reduce((s, l) => s + l.igst, 0));
  const exact = round2(itemsValue + freight + cgst + sgst + igst);
  const grand = Math.round(exact);
  return {
    lines: priced,
    sub_total: gross,
    discount_amount: round2(gross - itemsValue),
    items_value: itemsValue,
    freight_charges: freight,
    freight_gst: taxFreight ? 1 : 0,
    taxable_amount: round2(itemsValue + (taxFreight ? freight : 0)),
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    round_off: round2(grand - exact),
    grand_total: grand,
  };
}

/** HSN-wise tax summary: taxable value (with freight shares) and tax per HSN and rate. */
export function hsnSummary(priced: PricedDocLine[]) {
  const map = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  priced.forEach((l) => {
    const key = `${l.hsn_code || '—'}|${l.gst_rate}`;
    const row = map.get(key) || { hsn: l.hsn_code || '—', rate: l.gst_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable = round2(row.taxable + l.amount + l.freight_share);
    row.cgst = round2(row.cgst + l.cgst);
    row.sgst = round2(row.sgst + l.sgst);
    row.igst = round2(row.igst + l.igst);
    map.set(key, row);
  });
  return [...map.values()];
}

// ── PO header, approval and status ─────────────────────────────────────────
export interface PoHeader {
  supplier_id: number;
  supplier_address_id: number | null;
  supplier_ref: string | null;
  po_date: string;
  expected_date: string | null;
  warehouse_id: number | null;
  issuing_location_id: number | null;
  freight_charges: number;
  payment_terms: string | null;
  delivery_terms: string | null;
  notes: string | null;
  terms_conditions: string | null;
}

export function parsePoHeader(body: any, today: string): Parsed<PoHeader> {
  const supplierId = Number(body?.supplier_id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return fail('Choose the supplier');
  const poDate = body?.po_date ? String(body.po_date) : today;
  if (!isIsoDate(poDate)) return fail('Pick the PO date');
  if (poDate > today) return fail("The PO date can't be in the future");
  const expected = body?.expected_date ? String(body.expected_date) : null;
  if (expected !== null && !isIsoDate(expected)) return fail('Pick the expected delivery date');
  if (expected && expected < poDate) return fail("The expected delivery date can't be before the PO date");
  const freight = body?.freight_charges === undefined || body?.freight_charges === null || body?.freight_charges === '' ? 0 : Number(body.freight_charges);
  if (!Number.isFinite(freight) || freight < 0 || freight > MONEY_MAX) return fail('Freight / other charges must be zero or more');
  const id = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
  return {
    ok: true,
    value: {
      supplier_id: supplierId,
      supplier_address_id: id(body?.supplier_address_id),
      supplier_ref: text(body?.supplier_ref, 80),
      po_date: poDate,
      expected_date: expected,
      warehouse_id: id(body?.warehouse_id),
      issuing_location_id: id(body?.issuing_location_id),
      freight_charges: round2(freight),
      payment_terms: text(body?.payment_terms, 200),
      delivery_terms: text(body?.delivery_terms, 200),
      notes: longText(body?.notes, 2000),
      terms_conditions: longText(body?.terms_conditions, 5000),
    },
  };
}

/**
 * Does a PO wait for approval? Someone who can approve never waits; anyone
 * else waits unless the company set a limit and the PO is within it.
 */
export const needsApproval = (total: number, canApprove: boolean, limit: number | null) =>
  !canApprove && (limit === null || limit === undefined || num(total) > num(limit));

export interface ReceiptLedgerRow {
  po_item_id: number;
  item_name: string;
  product_id: number | null;
  unit: string | null;
  ordered: number;
  received: number;
  billed?: number;
}

/** After goods arrive or a receipt is cancelled: what the PO's status becomes. */
export function receiptStatus(rows: { ordered: unknown; received: unknown }[], fallback: PoStatus): PoStatus {
  const any = rows.some((r) => num(r.received) > EPS);
  if (!any) return fallback;
  return rows.every((r) => num(r.received) + EPS >= num(r.ordered)) ? 'RECEIVED' : 'PARTLY_RECEIVED';
}

export const fmtQty = (v: unknown, unit?: string | null) => `${round3(v)}${unit ? ` ${unit}` : ''}`;

/** Why a PO can't be cancelled (null = it can). Something received → close it instead. */
export function cancelBlocker(po: { status: string }, receivedAny: boolean): string | null {
  if (po.status === 'CANCELLED') return 'This PO is already cancelled';
  if (po.status === 'CLOSED' || po.status === 'RECEIVED') return `This PO is ${po.status.toLowerCase()} — it can't be cancelled`;
  if (receivedAny) return 'Goods have arrived against this PO — close it instead, so the rest is no longer expected';
  return null;
}

/** Why a PO can't be closed early (null = it can): only an open PO where something has arrived. */
export function closeBlocker(po: { status: string }, receivedAny: boolean): string | null {
  if (!OPEN_STATUSES.includes(po.status as PoStatus)) return `A ${po.status.toLowerCase().replace(/_/g, ' ')} PO can't be closed`;
  if (!receivedAny) return 'Nothing has arrived yet — cancel the PO instead';
  return null;
}

export const parseReason = (v: unknown, what = 'a reason'): Parsed<string> => {
  const s = text(v, 300);
  if (!s || s.length < 3) return fail(`Give ${what} (at least 3 letters)`);
  return { ok: true, value: s };
};

/**
 * Checks an amendment against what already happened: lines with goods
 * received stay, keep their product, and can't go below what arrived.
 */
export function amendProblem(
  newLines: (DocLine & { po_item_id?: number | null })[],
  ledger: ReceiptLedgerRow[],
): string | null {
  const byId = new Map(newLines.filter((l) => l.po_item_id).map((l) => [Number(l.po_item_id), l]));
  for (const row of ledger) {
    if (num(row.received) <= EPS && num(row.billed) <= EPS) continue;
    const next = byId.get(row.po_item_id);
    if (!next) return `${row.item_name}: goods have arrived for this line, so it can't be removed`;
    if ((next.product_id ?? null) !== (row.product_id ?? null)) return `${row.item_name}: goods have arrived, so its product can't change`;
    const floor = Math.max(num(row.received), num(row.billed));
    if (num(next.qty) + EPS < floor) return `${row.item_name}: ${fmtQty(floor, row.unit)} already arrived or billed — the quantity can't go below that`;
  }
  const known = new Set(ledger.map((r) => r.po_item_id));
  for (const l of newLines) if (l.po_item_id && !known.has(Number(l.po_item_id))) return `${l.item_name}: that line isn't on this PO`;
  return null;
}

// ── Goods received (GRN) ───────────────────────────────────────────────────
export interface ReceiptHeader {
  receipt_date: string;
  warehouse_id: number | null;
  supplier_challan_no: string | null;
  supplier_invoice_no: string | null;
  vehicle_number: string | null;
  eway_bill_number: string | null;
  transporter_name: string | null;
  notes: string | null;
}
export interface ReceiptLine {
  po_item_id: number;
  received_qty: number;
  rejected_qty: number;
  accepted_qty: number;
  reject_reason: string | null;
}

export function parseReceipt(
  body: any,
  ledger: ReceiptLedgerRow[],
  ctx: { today: string; poDate: string; overPercent: number },
): { ok: true; header: ReceiptHeader; lines: ReceiptLine[] } | { ok: false; message: string } {
  const date = body?.receipt_date ? String(body.receipt_date) : ctx.today;
  if (!isIsoDate(date)) return fail('Pick the date the goods arrived');
  if (date > ctx.today) return fail("The goods can't arrive in the future");
  if (date < ctx.poDate) return fail("The goods can't arrive before the PO date");
  const vehicle = text(body?.vehicle_number, 32)?.toUpperCase() ?? null;
  if (vehicle && !/^[A-Z0-9][A-Z0-9 -]*$/.test(vehicle)) return fail('Vehicle number: only letters, digits, spaces and dashes');
  const eway = text(body?.eway_bill_number, 32)?.replace(/\s/g, '') ?? null;
  if (eway && !/^\d{12}$/.test(eway)) return fail('An e-way bill number has 12 digits');
  const header: ReceiptHeader = {
    receipt_date: date,
    warehouse_id: Number(body?.warehouse_id) > 0 ? Number(body.warehouse_id) : null,
    supplier_challan_no: text(body?.supplier_challan_no, 50),
    supplier_invoice_no: text(body?.supplier_invoice_no, 50),
    vehicle_number: vehicle,
    eway_bill_number: eway,
    transporter_name: text(body?.transporter_name, 120),
    notes: longText(body?.notes, 1000),
  };
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  const byId = new Map(ledger.map((r) => [r.po_item_id, r]));
  const over = Math.min(OVER_RECEIPT_MAX, Math.max(0, num(ctx.overPercent)));
  const lines: ReceiptLine[] = [];
  const seen = new Set<number>();
  for (const r of raw) {
    const id = Number(r?.po_item_id);
    const row = byId.get(id);
    if (!row) return fail("Some lines aren't on this PO any more — reopen it and try again");
    if (seen.has(id)) return fail(`${row.item_name} is listed twice`);
    seen.add(id);
    const received = Number(r?.received_qty ?? 0);
    const rejected = Number(r?.rejected_qty ?? 0);
    if (!Number.isFinite(received) || received < 0) return fail(`${row.item_name}: enter the quantity that arrived`);
    if (!received) continue;
    if (!Number.isFinite(rejected) || rejected < 0 || rejected > received) return fail(`${row.item_name}: rejected can't be more than arrived`);
    if (!decimals(received, 3) || !decimals(rejected, 3)) return fail(`${row.item_name}: at most 3 decimals`);
    if (row.product_id && (!decimals(received, 0) || !decimals(rejected, 0))) return fail(`${row.item_name}: stock is counted in whole units — enter whole numbers`);
    const accepted = round3(received - rejected);
    const allowed = num(row.ordered) * (1 + over / 100);
    const limit = row.product_id ? Math.floor(allowed + EPS) : round3(allowed);
    const left = round3(limit - num(row.received));
    if (accepted > left + EPS) {
      return fail(
        left <= EPS
          ? `${row.item_name}: everything ordered has arrived already`
          : `${row.item_name}: only ${fmtQty(left, row.unit)} left to receive, not ${fmtQty(accepted, row.unit)}${over ? ` (including the ${over}% extra allowed)` : ''}`,
      );
    }
    if (rejected > 0 && !text(r?.reject_reason, 200)) return fail(`${row.item_name}: say why ${fmtQty(rejected, row.unit)} was rejected`);
    lines.push({ po_item_id: id, received_qty: round3(received), rejected_qty: round3(rejected), accepted_qty: accepted, reject_reason: text(r?.reject_reason, 200) });
  }
  if (!lines.length) return fail('Enter how much arrived of at least one item');
  return { ok: true, header, lines };
}

// ── Supplier bills ─────────────────────────────────────────────────────────
export interface BillHeader {
  supplier_id: number;
  po_id: number | null;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  freight_charges: number;
  notes: string | null;
}

export function parseBillHeader(body: any, today: string): Parsed<BillHeader> {
  const supplierId = Number(body?.supplier_id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return fail('Choose the supplier');
  const number = text(body?.bill_number, 40);
  if (!number) return fail("Enter the supplier's bill (invoice) number");
  const date = String(body?.bill_date ?? '');
  if (!isIsoDate(date)) return fail("Pick the bill's date");
  if (date > today) return fail("The bill date can't be in the future");
  const due = body?.due_date ? String(body.due_date) : null;
  if (due !== null && !isIsoDate(due)) return fail('Pick the due date');
  if (due && due < date) return fail("The due date can't be before the bill date");
  const freight = body?.freight_charges ? Number(body.freight_charges) : 0;
  if (!Number.isFinite(freight) || freight < 0 || freight > MONEY_MAX) return fail('Freight / other charges must be zero or more');
  return {
    ok: true,
    value: {
      supplier_id: supplierId,
      po_id: Number(body?.po_id) > 0 ? Number(body.po_id) : null,
      bill_number: number,
      bill_date: date,
      due_date: due,
      freight_charges: round2(freight),
      notes: longText(body?.notes, 2000),
    },
  };
}

/** Indian financial year (April–March) a date falls in, e.g. "2026-27". */
export const fyOf = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** A bill can't bill more of a PO line than has arrived and isn't billed yet. */
export function overBilled(lines: DocLine[], ledger: ReceiptLedgerRow[]): string | null {
  const want = new Map<number, number>();
  lines.forEach((l) => l.po_item_id && want.set(Number(l.po_item_id), (want.get(Number(l.po_item_id)) || 0) + num(l.qty)));
  for (const [id, qty] of want) {
    const row = ledger.find((r) => r.po_item_id === id);
    if (!row) return "Some lines aren't on this PO";
    const left = round3(num(row.received) - num(row.billed));
    if (qty > left + EPS) {
      return left <= EPS
        ? `${row.item_name}: everything that arrived is billed already`
        : `${row.item_name}: only ${fmtQty(left, row.unit)} arrived and isn't billed yet, not ${fmtQty(qty, row.unit)}`;
    }
  }
  return null;
}

/** Lines whose rate is not the PO's — shown as a warning, never blocking. */
export function rateDifferences(lines: DocLine[], poRates: Map<number, { rate: number; discount_percent: number; item_name: string }>): string[] {
  const out: string[] = [];
  lines.forEach((l) => {
    const po = l.po_item_id ? poRates.get(Number(l.po_item_id)) : undefined;
    if (!po) return;
    const billNet = num(l.rate) * (1 - num(l.discount_percent) / 100);
    const poNet = num(po.rate) * (1 - num(po.discount_percent) / 100);
    if (Math.abs(billNet - poNet) >= 0.01) {
      const pct = poNet > 0 ? round2(((billNet - poNet) / poNet) * 100) : 0;
      out.push(`${po.item_name}: ₹${round2(billNet)} on the bill vs ₹${round2(poNet)} on the PO${pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}`);
    }
  });
  return out;
}

export const billStatus = (total: unknown, paid: unknown): 'UNPAID' | 'PARTLY_PAID' | 'PAID' => {
  const t = round2(total);
  const p = round2(paid);
  if (p <= 0.004) return t <= 0.004 ? 'PAID' : 'UNPAID';
  return p + 0.004 >= t ? 'PAID' : 'PARTLY_PAID';
};

/** When a bill must be paid: the earlier of its due date and, for micro and small enterprises, 45 days. */
export function payBy(bill: { bill_date: string; due_date?: string | null }, msmeType?: string | null): { date: string; msme: boolean } {
  const due = bill.due_date && isIsoDate(bill.due_date) ? bill.due_date : null;
  const isMse = ['MICRO', 'SMALL'].includes(String(msmeType ?? '').toUpperCase());
  const msme = isMse ? addDays(bill.bill_date, MSME_DAYS) : null;
  if (msme && (!due || msme < due)) return { date: msme, msme: true };
  return { date: due || bill.bill_date, msme: false };
}

/**
 * Warnings for an unpaid bill: overdue, the MSME 45-day limit, and GST input
 * credit that must be reversed if it stays unpaid for 180 days.
 */
export function billAlerts(
  bill: { bill_date: string; due_date?: string | null; balance_amount: unknown; status?: string },
  msmeType: string | null | undefined,
  today: string,
): { overdue_days: number; msme_due: string | null; msme_days_left: number | null; itc_due: string; itc_days_left: number } | null {
  if (round2(bill.balance_amount) <= 0 || bill.status === 'CANCELLED') return null;
  const by = payBy(bill, msmeType);
  const itcDue = addDays(bill.bill_date, ITC_DAYS);
  const msmeDue = ['MICRO', 'SMALL'].includes(String(msmeType ?? '').toUpperCase()) ? addDays(bill.bill_date, MSME_DAYS) : null;
  return {
    overdue_days: Math.max(0, daysBetween(by.date, today)),
    msme_due: msmeDue,
    msme_days_left: msmeDue ? daysBetween(today, msmeDue) : null,
    itc_due: itcDue,
    itc_days_left: daysBetween(today, itcDue),
  };
}

// ── Payments to suppliers ──────────────────────────────────────────────────
export interface PaymentInput {
  supplier_id: number;
  po_id: number | null;
  payment_date: string;
  amount: number;
  mode: PaymentMode;
  reference: string | null;
  bank_account_id: number | null;
  notes: string | null;
  allocations: { bill_id: number; amount: number }[] | null;
}

export function parsePayment(body: any, today: string): Parsed<PaymentInput> {
  const supplierId = Number(body?.supplier_id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return fail('Choose the supplier');
  const date = body?.payment_date ? String(body.payment_date) : today;
  if (!isIsoDate(date)) return fail('Pick the payment date');
  if (date > today) return fail("The payment date can't be in the future");
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail('Enter an amount above zero');
  if (amount > MONEY_MAX || !decimals(amount, 2)) return fail('Enter a valid amount (at most 2 decimals)');
  const mode = upper(body?.mode) as PaymentMode;
  if (!(PAYMENT_MODES as readonly string[]).includes(mode)) return fail('Choose how it was paid (cash, bank transfer, cheque, UPI or card)');
  let allocations: { bill_id: number; amount: number }[] | null = null;
  if (Array.isArray(body?.allocations)) {
    allocations = [];
    for (const a of body.allocations) {
      const billId = Number(a?.bill_id);
      const amt = Number(a?.amount);
      if (!Number.isInteger(billId) || billId <= 0) return fail('A bill in the split is missing');
      if (!Number.isFinite(amt) || amt < 0 || !decimals(amt, 2)) return fail('Enter valid amounts for the bills');
      if (amt > 0) allocations.push({ bill_id: billId, amount: round2(amt) });
    }
    const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (sum > round2(amount) + 0.004) return fail(`The bills add up to ₹${sum}, more than the ₹${round2(amount)} paid`);
  }
  return {
    ok: true,
    value: {
      supplier_id: supplierId,
      po_id: Number(body?.po_id) > 0 ? Number(body.po_id) : null,
      payment_date: date,
      amount: round2(amount),
      mode,
      reference: text(body?.reference, 100),
      bank_account_id: Number(body?.bank_account_id) > 0 ? Number(body.bank_account_id) : null,
      notes: text(body?.notes, 500),
      allocations,
    },
  };
}

/**
 * Shares a payment over bills: the split given (each within its bill's
 * balance), else the oldest due first. What is left is an advance.
 */
export function allocatePayment(
  amount: number,
  bills: { id: number; balance: number; pay_by: string; bill_number?: string }[],
  explicit: { bill_id: number; amount: number }[] | null,
): { ok: true; allocations: { bill_id: number; amount: number }[]; advance: number } | { ok: false; message: string } {
  const byId = new Map(bills.map((b) => [b.id, b]));
  let left = round2(amount);
  const out: { bill_id: number; amount: number }[] = [];
  if (explicit) {
    for (const a of explicit) {
      const b = byId.get(a.bill_id);
      if (!b) return fail("Some bills in the split aren't this supplier's unpaid bills — reopen and try again");
      if (a.amount > round2(b.balance) + 0.004) return fail(`${b.bill_number || 'A bill'}: only ₹${round2(b.balance)} is still due`);
      out.push({ bill_id: a.bill_id, amount: round2(a.amount) });
      left = round2(left - a.amount);
    }
  } else {
    for (const b of [...bills].sort((x, y) => (x.pay_by < y.pay_by ? -1 : x.pay_by > y.pay_by ? 1 : x.id - y.id))) {
      if (left <= 0) break;
      const take = round2(Math.min(left, round2(b.balance)));
      if (take <= 0) continue;
      out.push({ bill_id: b.id, amount: take });
      left = round2(left - take);
    }
  }
  return { ok: true, allocations: out, advance: Math.max(0, left) };
}

// ── Settings ───────────────────────────────────────────────────────────────
export interface PurchaseSettings {
  approval_limit: number | null;
  over_receipt_percent: number;
  default_payment_terms: string | null;
  default_delivery_terms: string | null;
  default_terms: string | null;
}

export const settingsFrom = (row: any): PurchaseSettings => ({
  approval_limit: row?.approval_limit === null || row?.approval_limit === undefined ? null : round2(row.approval_limit),
  over_receipt_percent: round2(row?.over_receipt_percent ?? 0),
  default_payment_terms: row?.default_payment_terms ?? null,
  default_delivery_terms: row?.default_delivery_terms ?? null,
  default_terms: row?.default_terms ?? null,
});

export function parseSettings(body: any): Parsed<PurchaseSettings> {
  let limit: number | null = null;
  if (body?.approval_limit !== undefined && body?.approval_limit !== null && body?.approval_limit !== '') {
    limit = Number(body.approval_limit);
    if (!Number.isFinite(limit) || limit < 0 || limit > MONEY_MAX) return fail('The approval limit is an amount of zero or more (empty = every PO needs approval)');
  }
  const over = body?.over_receipt_percent === undefined || body?.over_receipt_percent === '' ? 0 : Number(body.over_receipt_percent);
  if (!Number.isFinite(over) || over < 0 || over > OVER_RECEIPT_MAX) return fail(`Extra allowed when receiving is 0 to ${OVER_RECEIPT_MAX}%`);
  return {
    ok: true,
    value: {
      approval_limit: limit === null ? null : round2(limit),
      over_receipt_percent: round2(over),
      default_payment_terms: text(body?.default_payment_terms, 200),
      default_delivery_terms: text(body?.default_delivery_terms, 200),
      default_terms: longText(body?.default_terms, 5000),
    },
  };
}

// ── Lists ──────────────────────────────────────────────────────────────────
export const PO_FILTERS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'TO_SEND', 'TO_RECEIVE', 'LATE', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type PoFilter = (typeof PO_FILTERS)[number];
export const parsePoFilter = (v: unknown): PoFilter => {
  const s = String(v ?? '').toUpperCase();
  return (PO_FILTERS as readonly string[]).includes(s) ? (s as PoFilter) : 'ALL';
};
export const BILL_FILTERS = ['ALL', 'UNPAID', 'OVERDUE', 'DUE_SOON', 'MSME', 'PAID', 'CANCELLED'] as const;
export type BillFilter = (typeof BILL_FILTERS)[number];
export const parseBillFilter = (v: unknown): BillFilter => {
  const s = String(v ?? '').toUpperCase();
  return (BILL_FILTERS as readonly string[]).includes(s) ? (s as BillFilter) : 'ALL';
};
export const pageOf = (page: unknown, limit: unknown, maxLimit = 100) => {
  const l = Math.min(maxLimit, Math.max(1, Math.floor(num(limit) || 25)));
  const p = Math.max(1, Math.floor(num(page) || 1));
  return { limit: l, offset: (p - 1) * l, page: p };
};
export const searchTerm = (v: unknown) => text(v, 80);
