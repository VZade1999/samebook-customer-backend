import { gstBase, transportTaxed, TRANSPORT_GST_DEFAULT } from './transport-gst.rules';

describe('GST on transport', () => {
  it('reads the stored flag, defaulting to the GST rule', () => {
    expect(TRANSPORT_GST_DEFAULT).toBe(true);
    expect(transportTaxed(1)).toBe(true);
    expect(transportTaxed('1')).toBe(true);
    expect(transportTaxed(true)).toBe(true);
    expect(transportTaxed(0)).toBe(false);
    expect(transportTaxed('0')).toBe(false);
    expect(transportTaxed(false)).toBe(false);
    expect(transportTaxed(undefined)).toBe(true);
    expect(transportTaxed(null)).toBe(true);
    // A document with no flag (older rows read without it) → not taxed when asked so.
    expect(transportTaxed(undefined, false)).toBe(false);
  });

  it('the GST base is the items plus transport when taxed', () => {
    expect(gstBase(100, 100, true)).toBe(200);
    expect(gstBase(100, 100, false)).toBe(100);
    expect(gstBase(144500, 1000, true)).toBe(145500);
    expect(gstBase('10.10', '0.20', true)).toBe(10.3);
    // Bad or negative transport never lowers the base.
    expect(gstBase(100, -50, true)).toBe(100);
    expect(gstBase(100, 'abc', true)).toBe(100);
  });
});
