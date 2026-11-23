import { quotationTotals, snapshotState } from './quotation-totals.rules';

describe('address snapshot state', () => {
  it('reads the state whether the snapshot is an object or JSON text (even encoded twice)', () => {
    const snap = { address_line_1: '1 Test Road', city: 'Pune', state: 'Maharashtra' };
    expect(snapshotState(snap)).toBe('Maharashtra');
    expect(snapshotState(JSON.stringify(snap))).toBe('Maharashtra');
    expect(snapshotState(JSON.stringify(JSON.stringify(snap)))).toBe('Maharashtra');
    expect(snapshotState({ state: '  Gujarat ' })).toBe('Gujarat');
  });

  it('gives nothing for a missing or broken snapshot', () => {
    expect(snapshotState(undefined)).toBeUndefined();
    expect(snapshotState(null)).toBeUndefined();
    expect(snapshotState('not json')).toBeUndefined();
    expect(snapshotState({ city: 'Pune' })).toBeUndefined();
    expect(snapshotState('')).toBeUndefined();
  });
});

describe('quotation totals', () => {
  const items = [
    { qty: 100, rate: 1000, discount_percent: 5 },
    { qty: 10, rate: 5000, discount_percent: 0 },
  ];

  it('works the totals out the way invoices do, transport untaxed the old way', () => {
    // 150,000 − line discounts 5,000 − overall 500 = 144,500; GST 9% + 9% = 26,010; + transport 1,000.
    expect(quotationTotals(items, 500, 1000, 9, 9, 0, false)).toEqual({
      sub_total: 150000,
      discount_percent: 3.67,
      discount_amount: 5500,
      cgst_percent: 9,
      cgst_amount: 13005,
      sgst_percent: 9,
      sgst_amount: 13005,
      igst_percent: 0,
      igst_amount: 0,
      transport_charges: 1000,
      transport_gst: 0,
      grand_total: 171510,
    });
  });

  it('taxes transport like the goods (the GST rule)', () => {
    // GST on 144,500 + 1,000 = 145,500 → 13,095 + 13,095.
    expect(quotationTotals(items, 500, 1000, 9, 9, 0, true)).toMatchObject({
      cgst_amount: 13095,
      sgst_amount: 13095,
      transport_charges: 1000,
      transport_gst: 1,
      grand_total: 171690,
    });
    // Inter-state: IGST on the same base.
    expect(quotationTotals(items, 500, 1000, 0, 0, 18, true)).toMatchObject({ igst_amount: 26190, grand_total: 171690 });
  });

  it('item ₹100 + transport ₹100 at 18%: ₹236 (₹218 the old way)', () => {
    const one = [{ qty: 1, rate: 100 }];
    expect(quotationTotals(one, 0, 100, 9, 9, 0, true)).toMatchObject({ cgst_amount: 18, sgst_amount: 18, grand_total: 236 });
    expect(quotationTotals(one, 0, 100, 9, 9, 0, false)).toMatchObject({ cgst_amount: 9, sgst_amount: 9, grand_total: 218 });
  });

  it('no transport or no GST: the setting changes nothing', () => {
    expect(quotationTotals(items, 500, 0, 9, 9, 0, true).grand_total).toBe(quotationTotals(items, 500, 0, 9, 9, 0, false).grand_total);
    expect(quotationTotals(items, 0, 1000, 0, 0, 0, true).grand_total).toBe(146000);
  });
});
