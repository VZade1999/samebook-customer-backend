// GST on transport — pure rules, no database.
//
// Transport (freight) that the seller charges on its own quotation or invoice
// is part of the sale under GST: the value of supply includes it (CGST Act
// section 15), and goods delivered with freight are a composite supply taxed
// at the goods' rate. So it joins the taxable value and carries the
// document's GST rate.
//
// A company Admin can turn this off (companies.transport_gst = 0), e.g. when
// the CA treats the freight as a pure-agent reimbursement (the transporter's
// bill is in the customer's name and is recovered at cost). Each quotation
// and invoice remembers how its own totals were worked out
// (transport_gst on the document), so older documents keep showing exactly
// what was issued.

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Every company starts with transport taxed (the GST rule). */
export const TRANSPORT_GST_DEFAULT = true;

/** A stored flag (TINYINT, boolean or missing) as a yes/no; missing = `fallback`. */
export const transportTaxed = (v: unknown, fallback = TRANSPORT_GST_DEFAULT): boolean => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return num(v) !== 0;
};

/** The value GST is charged on: the items after discounts, plus transport when it is taxed. */
export const gstBase = (itemsTaxable: unknown, transport: unknown, taxed: boolean): number =>
  round2(num(itemsTaxable) + (taxed ? Math.max(0, num(transport)) : 0));
