// "How do you sell?" — a company setting that only changes defaults (which
// button comes first, what the screens say). It never blocks another way of
// working on a single order.
//
//   ALL         Show everything (the default; also what "Skip" saves)
//   WITH_GOODS  Bill with the goods: the invoice travels with them
//   SEND_FIRST  Send first, bill later: challans, then an invoice for what was delivered
//   BILL_FIRST  Bill first, send in lots: one invoice, then a challan per lot (GST Rule 55(5))
//   SERVICES    Services only: no goods move, so challans are hidden

export const SALES_FLOWS = ['ALL', 'WITH_GOODS', 'SEND_FIRST', 'BILL_FIRST', 'SERVICES'] as const;
export type SalesFlow = (typeof SALES_FLOWS)[number];

export const parseSalesFlow = (v: unknown): SalesFlow | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return (SALES_FLOWS as readonly string[]).includes(s) ? (s as SalesFlow) : null;
};

/** The setting as stored: null (never chosen — admins are asked once) or a known flow. */
export const storedSalesFlow = (v: unknown): SalesFlow | null => parseSalesFlow(v);
