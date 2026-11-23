// A quotation's totals — pure, no database, unit-tested. The server works
// these out itself and never trusts the figures a client sends.
import { gstBase } from '../common/transport-gst.rules';

/**
 * The state on an address snapshot. Snapshots saved on a quotation come back
 * from the database as JSON text (sometimes encoded twice), so a plain
 * `.state` read missed them and an edit judged the customer out-of-state.
 */
export const snapshotState = (v: unknown): string | undefined => {
  let s: any = v;
  try {
    while (typeof s === 'string') s = JSON.parse(s);
  } catch {
    return undefined;
  }
  const state = s && typeof s === 'object' ? String(s.state ?? '').trim() : '';
  return state || undefined;
};

export interface TotalsItem {
  qty?: number;
  rate?: number;
  discount_percent?: number;
}

/**
 * Items' sub-total (qty × rate); line discounts plus the overall discount
 * amount; GST at the document's rates on the taxable value; transport on top.
 * When `transportGst` is on, transport is part of the taxable value (the GST
 * rule — see common/transport-gst.rules.ts), so GST is charged on it too.
 */
export function quotationTotals(
  items: TotalsItem[],
  overallDiscount: number | undefined,
  transportCharges: number | undefined,
  cgstPercent: number | undefined,
  sgstPercent: number | undefined,
  igstPercent: number | undefined,
  transportGst: boolean,
) {
  const subTotal = items.reduce((sum, item) => sum + (item.qty || 0) * (item.rate || 0), 0);

  const itemDiscountTotal = items.reduce((sum, item) => {
    const lineSubtotal = (item.qty || 0) * (item.rate || 0);
    return sum + ((item.discount_percent ?? 0) / 100) * lineSubtotal;
  }, 0);

  const overallDisc = Number(overallDiscount ?? 0);
  const transport = Number(transportCharges ?? 0);
  const cgstPct = Number(cgstPercent ?? 0);
  const sgstPct = Number(sgstPercent ?? 0);
  const igstPct = Number(igstPercent ?? 0);

  const totalDiscount = Number((itemDiscountTotal + overallDisc).toFixed(2));
  const discountPercent = subTotal > 0 ? (totalDiscount / subTotal) * 100 : 0;
  const taxableAmount = Number((subTotal - totalDiscount).toFixed(2));
  const base = gstBase(taxableAmount, transport, transportGst);

  const cgstAmount = Number(((base * cgstPct) / 100).toFixed(2));
  const sgstAmount = Number(((base * sgstPct) / 100).toFixed(2));
  const igstAmount = Number(((base * igstPct) / 100).toFixed(2));
  const taxTotal = Number((cgstAmount + sgstAmount + igstAmount).toFixed(2));

  const grandTotal = Number((taxableAmount + taxTotal + transport).toFixed(2));

  return {
    sub_total: Number(subTotal.toFixed(2)),
    discount_percent: Number(discountPercent.toFixed(2)),
    discount_amount: totalDiscount,
    cgst_percent: cgstPct,
    cgst_amount: cgstAmount,
    sgst_percent: sgstPct,
    sgst_amount: sgstAmount,
    igst_percent: igstPct,
    igst_amount: igstAmount,
    transport_charges: transport,
    transport_gst: transportGst ? 1 : 0,
    grand_total: grandTotal,
  };
}
