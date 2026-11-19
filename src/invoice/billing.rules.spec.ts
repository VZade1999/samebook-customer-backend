import {
  addressKey,
  applyTaxType,
  balanceOf,
  directTotals,
  parseDirectLines,
  cancelBlocker,
  fullyBilled,
  invoiceTotals,
  mergeKey,
  mergeProblem,
  missingAddress,
  orList,
  overBilled,
  parseCancelReason,
  parseDispatch,
  parseQuantities,
  parseTransport,
  priceLine,
  progressOf,
  statusAfterUnbill,
  suggestedTransport,
} from './billing.rules';

// QT-12: 100 chairs @ ₹1,000 (5% line discount) + 10 tables @ ₹5,000, ₹500 overall discount, 18% (9+9), ₹1,000 transport.
const ledger = [
  { quotation_item_id: 1, quotation_id: 12, product_name: 'Chair', unit: 'pcs', ordered: '100.00', rate: '1000.00', discount_percent: '5.00', sent: '60.000', billed: '0' },
  { quotation_item_id: 2, quotation_id: 12, product_name: 'Table', unit: 'pcs', ordered: '10.00', rate: '5000.00', discount_percent: '0', sent: '10.000', billed: '10.000' },
];
const qt12 = {
  id: 12,
  sub_total: 150000, // 100 × 1000 + 10 × 5000
  discount_amount: 5500, // 5000 line + 500 overall
  items_discount_total: 5000,
  cgst_percent: 9,
  sgst_percent: 9,
  igst_percent: 0,
  transport_charges: 1000,
};

describe('billing ledger', () => {
  it('works out what is left to send and to bill per line', () => {
    expect(balanceOf(ledger[0])).toMatchObject({ ordered: 100, sent: 60, billed: 0, to_send: 40, to_bill: 100, sent_not_billed: 60, net_rate: 950 });
    expect(balanceOf(ledger[1])).toMatchObject({ to_send: 0, to_bill: 0, sent_not_billed: 0 });
    // Billed first (lots): nothing "sent, not billed".
    expect(balanceOf({ ...ledger[0], sent: 30, billed: 100 })).toMatchObject({ to_bill: 0, sent_not_billed: 0, to_send: 70 });
  });

  it('knows when a quotation is billed in full, and the progress in value', () => {
    expect(fullyBilled([{ ordered: 10, billed: 10 }, { ordered: 2.5, billed: 2.4996 }])).toBe(true);
    expect(fullyBilled([{ ordered: 10, billed: 9 }])).toBe(false);
    expect(fullyBilled([])).toBe(false);
    const p = progressOf(ledger.map(balanceOf));
    // ordered value 95,000 + 50,000; sent 57,000 + 50,000; billed 50,000.
    expect(p).toEqual({ sent_pct: 74, billed_pct: 34, to_bill_value: 95000 });
  });
});

describe('what an invoice bills', () => {
  it('defaults to everything not billed yet', () => {
    const r = parseQuantities(undefined, ledger);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.lines.map((l) => [l.quotation_item_id, l.qty])).toEqual([[1, 100]]);
  });

  it('takes chosen quantities and refuses more than is left', () => {
    const ok = parseQuantities([{ quotation_item_id: 1, qty: 40 }, { quotation_item_id: 2, qty: 0 }], ledger);
    expect(ok.ok && ok.lines).toEqual([expect.objectContaining({ quotation_item_id: 1, qty: 40, rate: 1000, discount_percent: 5, quotation_id: 12 })]);
    expect(parseQuantities([{ quotation_item_id: 1, qty: 101 }], ledger)).toEqual({ ok: false, message: 'Chair: only 100 pcs left to bill, not 101 pcs' });
    expect(parseQuantities([{ quotation_item_id: 2, qty: 1 }], ledger)).toEqual({ ok: false, message: 'Table is already billed in full' });
    expect(parseQuantities([{ quotation_item_id: 1, qty: 1.2345 }], ledger)).toMatchObject({ ok: false, message: expect.stringMatching(/3 decimals/) });
    expect(parseQuantities([{ quotation_item_id: 1, qty: -1 }], ledger)).toMatchObject({ ok: false });
    expect(parseQuantities([{ quotation_item_id: 9, qty: 1 }], ledger)).toMatchObject({ ok: false, message: expect.stringMatching(/no longer/) });
    expect(parseQuantities([{ quotation_item_id: 1, qty: 0 }], ledger)).toMatchObject({ ok: false, message: expect.stringMatching(/at least one/) });
    expect(parseQuantities(undefined, [ledger[1]])).toEqual({ ok: false, message: 'Everything on this quotation is already billed' });
  });

  it('adds up challan lines of the same ordered line before checking', () => {
    const line = { quotation_item_id: 1, quotation_id: 12, product_name: 'Chair', qty: 60, rate: 1000, discount_percent: 5 };
    expect(overBilled([line, { ...line, qty: 40 }], ledger)).toBeNull();
    expect(overBilled([line, { ...line, qty: 41 }], ledger)).toMatch(/only 100 pcs left/);
    // Lines that aren't on the quotation aren't limited by it.
    expect(overBilled([{ ...line, quotation_item_id: null, qty: 999 }], ledger)).toBeNull();
  });
});

describe('invoice totals', () => {
  const chairs = (qty: number) => ({ quotation_item_id: 1, quotation_id: 12, product_name: 'Chair', qty, rate: 1000, discount_percent: 5 });
  const tables = (qty: number) => ({ quotation_item_id: 2, quotation_id: 12, product_name: 'Table', qty, rate: 5000, discount_percent: 0 });
  const money = new Map([[12, qt12]]);

  it('billing the whole quotation reproduces its totals', () => {
    const t = invoiceTotals([chairs(100), tables(10)], money, 1000);
    // taxable 150,000 − 5,500 = 144,500; GST 9% + 9% = 26,010; + transport 1,000.
    expect(t).toEqual({
      sub_total: 150000,
      discount_percent: 3.67,
      discount_amount: 5500,
      taxable: 144500,
      cgst_percent: 9,
      cgst_amount: 13005,
      sgst_percent: 9,
      sgst_amount: 13005,
      igst_percent: 0,
      igst_amount: 0,
      transport_charges: 1000,
      grand_total: 171510,
    });
  });

  it('a part bill shares the overall discount by value billed', () => {
    // 60 chairs: gross 60,000, line discount 3,000, net 57,000 = 57,000/145,000 of the net → 196.55 of the ₹500.
    const t = invoiceTotals([chairs(60)], money, 0);
    expect(t.sub_total).toBe(60000);
    expect(t.discount_amount).toBe(3196.55);
    expect(t.taxable).toBe(56803.45);
    expect(t.cgst_amount).toBe(5112.31);
    expect(t.grand_total).toBe(67028.07);
  });

  it('inter-state quotations bill IGST', () => {
    const t = invoiceTotals([tables(1)], new Map([[12, { ...qt12, cgst_percent: 0, sgst_percent: 0, igst_percent: 18, discount_amount: 5000 }]]), 0);
    expect(t).toMatchObject({ taxable: 5000, igst_amount: 900, cgst_amount: 0, grand_total: 5900 });
  });

  it('prices each line like the quotation does', () => {
    expect(priceLine(chairs(3))).toMatchObject({ qty: 3, discount_amount: 150, discounted_rate: 950, total: 2850 });
    expect(priceLine({ ...chairs(0.125), rate: 99.99 })).toMatchObject({ qty: 0.125, total: 11.87 });
  });

  it('suggests each quotation’s transport on its first invoice only', () => {
    expect(suggestedTransport([{ id: 1, transport_charges: 1000, has_live_invoice: false }, { id: 2, transport_charges: 700, has_live_invoice: true }])).toBe(1000);
    expect(parseTransport(undefined, 1000)).toEqual({ ok: true, value: 1000 });
    expect(parseTransport('250.456', 1000)).toEqual({ ok: true, value: 250.46 });
    expect(parseTransport(-1, 0)).toMatchObject({ ok: false });
    expect(parseTransport('abc', 0)).toMatchObject({ ok: false });
  });
});

describe('challans on one invoice', () => {
  const site = { address_line_1: 'Plot 4, MIDC', city: 'Pune', state: 'Maharashtra', postal_code: '411019' };
  const office = { address_line_1: 'Office 2', city: 'Pune', state: 'Maharashtra', postal_code: '411001' };
  const q = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    quotation_number: `QT-${id}`,
    customer_id: 7,
    billing_address_snapshot: JSON.stringify(office),
    cgst_percent: 9,
    sgst_percent: 9,
    igst_percent: 0,
    ...over,
  });
  const c = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    challan_number: `DC-${id}`,
    customer_id: 7,
    quotation_id: 12,
    shipping_address_snapshot: { ...site, address_line_1: ' plot 4,  midc ' },
    ...over,
  });

  it('allows the same customer, GST rate, billing and delivery address — across quotations', () => {
    const qs = new Map([
      [12, q(12)],
      [13, q(13)],
    ]);
    expect(mergeProblem([c(1), c(2, { quotation_id: 13, shipping_address_snapshot: JSON.stringify(site) })], qs)).toBeNull();
    expect(mergeKey(c(1), qs.get(12))).toBe(mergeKey(c(2, { quotation_id: 13, shipping_address_snapshot: site }), qs.get(13)));
  });

  it('explains why challans must be billed separately', () => {
    const qs = new Map([
      [12, q(12)],
      [13, q(13, { igst_percent: 18, cgst_percent: 0, sgst_percent: 0 })],
      [14, q(14, { billing_address_snapshot: site })],
      [15, q(15, { customer_id: 8 })],
    ]);
    expect(mergeProblem([c(1), c(2, { customer_id: 8 })], qs)).toMatch(/same customer/);
    expect(mergeProblem([c(1), c(2, { quotation_id: 13 })], qs)).toBe('QT-13 has a different GST rate — bill it on its own invoice');
    expect(mergeProblem([c(1), c(2, { quotation_id: 14 })], qs)).toMatch(/different billing address/);
    expect(mergeProblem([c(1), c(2, { quotation_id: 15, customer_id: 7 })], qs)).toMatch(/different customer/);
    expect(mergeProblem([c(1), c(2, { shipping_address_snapshot: office })], qs)).toBe('DC-2 goes to a different delivery address — bill it on its own invoice');
    expect(mergeProblem([c(1, { quotation_id: null })], qs)).toMatch(/without a quotation/);
    expect(mergeProblem([c(1, { quotation_id: 99 })], qs)).toMatch(/not approved/);
    expect(mergeProblem([], qs)).toMatch(/Choose/);
  });

  it('says which parts of an address are missing', () => {
    const full = { address_line_1: 'Plot 4', city: 'Pune', state: 'Maharashtra', country: 'India', postal_code: '411019' };
    expect(missingAddress(full)).toEqual([]);
    expect(missingAddress(JSON.stringify(JSON.stringify({ ...full, address_line_1: ' ' })))).toEqual(['address line']);
    expect(missingAddress({ ...full, postal_code: null, country: '' })).toEqual(['country', 'PIN code']);
    expect(missingAddress(null)).toHaveLength(5);
    expect(orList(['country', 'PIN code'])).toBe('country or PIN code');
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c');
    expect(orList(['state'])).toBe('state');
  });

  it('compares addresses by the place, not the spacing or case', () => {
    expect(addressKey({ ...site, city: ' PUNE ' })).toBe(addressKey(JSON.stringify(site)));
    expect(addressKey(null)).toBe('||||');
  });
});

describe('an invoice without a quotation', () => {
  it('checks the typed lines', () => {
    const ok = parseDirectLines([{ product_name: ' LED Panel ', qty: '4', rate: 1250.5, discount_percent: 10, hsn_code: '9405', unit: 'pcs' }]);
    expect(ok).toEqual({
      ok: true,
      lines: [
        {
          quotation_item_id: null,
          quotation_id: null,
          product_name: 'LED Panel',
          description: null,
          hsn_code: '9405',
          unit: 'pcs',
          qty: 4,
          rate: 1250.5,
          discount_percent: 10,
        },
      ],
    });
    expect(parseDirectLines([])).toMatchObject({ ok: false, message: 'Add at least one item' });
    expect(parseDirectLines([{ product_name: '', qty: 1, rate: 1 }])).toMatchObject({ ok: false, message: expect.stringMatching(/item name/) });
    expect(parseDirectLines([{ product_name: 'A', qty: 0, rate: 1 }])).toMatchObject({ ok: false, message: 'A: enter a quantity above zero' });
    expect(parseDirectLines([{ product_name: 'A', qty: 1, rate: -5 }])).toMatchObject({ ok: false });
    expect(parseDirectLines([{ product_name: 'A', qty: 1, rate: 5, discount_percent: 120 }])).toMatchObject({ ok: false });
  });

  it('totals match the quotation formula, with the overall discount and transport', () => {
    const lines = [
      { quotation_item_id: null, quotation_id: null, product_name: 'A', qty: 100, rate: 1000, discount_percent: 5 },
      { quotation_item_id: null, quotation_id: null, product_name: 'B', qty: 10, rate: 5000, discount_percent: 0 },
    ];
    // Same numbers as "billing the whole quotation reproduces its totals".
    expect(directTotals(lines, 500, 1000, { cgst: 9, sgst: 9, igst: 0 })).toMatchObject({
      sub_total: 150000,
      discount_amount: 5500,
      taxable: 144500,
      cgst_amount: 13005,
      sgst_amount: 13005,
      grand_total: 171510,
    });
  });

  it('splits GST by the seller and buyer states', () => {
    expect(applyTaxType('INTRA_STATE', { cgst: 9, sgst: 9, igst: 18 })).toEqual({ cgst: 9, sgst: 9, igst: 0 });
    expect(applyTaxType('INTER_STATE', { cgst: 9, sgst: 9, igst: 18 })).toEqual({ cgst: 0, sgst: 0, igst: 18 });
    expect(applyTaxType('NO_GST', { cgst: 9, sgst: 9, igst: 18 })).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it('never bills without GST because the other kind was typed: the same total rate is split', () => {
    expect(applyTaxType('INTRA_STATE', { igst: 18 })).toEqual({ cgst: 9, sgst: 9, igst: 0 });
    expect(applyTaxType('INTRA_STATE', { igst: 5 })).toEqual({ cgst: 2.5, sgst: 2.5, igst: 0 });
    expect(applyTaxType('INTER_STATE', { cgst: 6, sgst: 6 })).toEqual({ cgst: 0, sgst: 0, igst: 12 });
    // Nothing typed stays nothing (exempt goods).
    expect(applyTaxType('INTRA_STATE', {})).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    expect(applyTaxType('INTER_STATE', { igst: 0 })).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });
});

describe('dispatch details on an invoice', () => {
  it('cleans what was typed and keeps only the fields sent', () => {
    expect(parseDispatch({ vehicle_number: ' mh 12  ab 1234 ', eway_bill_number: '3910 0000 0001', transporter_name: ' VRL Logistics ' })).toEqual({
      ok: true,
      values: { vehicle_number: 'MH 12 AB 1234', eway_bill_number: '391000000001', transporter_name: 'VRL Logistics' },
    });
    expect(parseDispatch({ lr_number: '' })).toEqual({ ok: true, values: { lr_number: null } });
    expect(parseDispatch({})).toEqual({ ok: true, values: {} });
  });

  it('refuses numbers that are not real', () => {
    expect(parseDispatch({ eway_bill_number: '12345' })).toMatchObject({ ok: false, message: expect.stringMatching(/12 digits/) });
    expect(parseDispatch({ vehicle_number: 'MH12@AB' })).toMatchObject({ ok: false });
    expect(parseDispatch({ vehicle_number: 'X'.repeat(21) })).toMatchObject({ ok: false });
    expect(parseDispatch({ transporter_name: 'x'.repeat(101) })).toMatchObject({ ok: false });
  });
});

describe('cancelling an invoice', () => {
  it('only live invoices without payments', () => {
    expect(cancelBlocker({ status: 'GENERATED', paid_amount: 0 })).toBeNull();
    expect(cancelBlocker({ status: 'CANCELLED' })).toMatch(/already cancelled/);
    expect(cancelBlocker({ status: 'PARTIAL_PAID', paid_amount: '500.00' })).toMatch(/Payments are recorded/);
  });

  it('needs a short reason', () => {
    expect(parseCancelReason('  Wrong   GST rate ')).toEqual({ ok: true, reason: 'Wrong GST rate' });
    expect(parseCancelReason('no')).toMatchObject({ ok: false });
    expect(parseCancelReason('x'.repeat(301))).toMatchObject({ ok: false });
    expect(parseCancelReason(undefined)).toMatchObject({ ok: false });
  });

  it('sends challans back to where they were', () => {
    expect(statusAfterUnbill({ delivered_at: '2026-11-05' })).toBe('DELIVERED');
    expect(statusAfterUnbill({ delivered_at: null })).toBe('DISPATCHED');
  });
});
