import {
  accessOf,
  billedOn,
  buildTrail,
  compact,
  likeEscape,
  matchRank,
  parseDocType,
  parseSearch,
  placeOfSupply,
} from './document-links.rules';

const ALL = { quotation: true, challan: true, invoice: true };

const quotation = {
  id: 23,
  quotation_number: 'QT-0012',
  quotation_date: '2026-10-28',
  status: 'FULLY_DISPATCHED',
  has_invoice: 1,
  customer_name: 'Sharma Traders',
  grand_total: '118000.00',
  customer_po_number: '4500123',
  customer_po_date: '2026-11-01',
};
// QT-0012 billed in full (unlinked challans then count as billed on its newest invoice).
const fullyBilledLedger = [
  { quotation_item_id: 1, quotation_id: 23, product_name: 'Chair', unit: 'pcs', ordered: 100, rate: 1000, discount_percent: 0, sent: 100, billed: 100 },
];
const challan = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  challan_number: `DC-00${id}`,
  challan_date: `2026-11-0${id % 9}`,
  status: 'DELIVERED',
  reason: 'SALE',
  quotation_id: 23,
  total_quantity: '30.000',
  total_value: '30000.00',
  vehicle_number: `MH12AB00${id}`,
  transporter_name: 'VRL',
  eway_bill_number: null,
  invoice_id: null,
  ...over,
});
const invoice = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  invoice_number: `KD/26-27/0${id}`,
  invoice_date: '2026-11-15',
  due_date: '2026-12-15',
  status: 'SENT',
  grand_total: '118000.00',
  paid_amount: '50000.00',
  balance_amount: '68000.00',
  shipping_address_snapshot: JSON.stringify({ city: 'Pune', state: 'maharashtra' }),
  billing_address_snapshot: { state: 'Gujarat' },
  customer_gst_number: '24AAAAA0000A1Z5',
  quotation_id: 23,
  ...over,
});

describe('document links rules', () => {
  it('knows the three document types and who may open them', () => {
    expect(parseDocType(' Invoice ')).toBe('invoice');
    expect(parseDocType('payment')).toBeNull();
    expect(accessOf(['quotations.view', 'invoices.view', 'challans.create'])).toEqual({ quotation: true, challan: false, invoice: true });
    expect(accessOf(undefined)).toEqual({ quotation: false, challan: false, invoice: false });
  });

  it('a challan is billed on its own invoice, else on the quotation invoice once the goods left', () => {
    expect(billedOn({ invoice_id: 7, status: 'INVOICED' }, 9)).toEqual({ id: 7, linked: true });
    expect(billedOn({ invoice_id: null, status: 'DISPATCHED' }, 9)).toEqual({ id: 9, linked: false });
    expect(billedOn({ invoice_id: null, status: 'DRAFT' }, 9)).toEqual({ id: null, linked: false });
    expect(billedOn({ invoice_id: null, status: 'CANCELLED' }, 9)).toEqual({ id: null, linked: false });
    expect(billedOn({ invoice_id: null, status: 'DELIVERED' }, null)).toEqual({ id: null, linked: false });
  });

  it('place of supply is the delivery state with its GST code', () => {
    expect(placeOfSupply('{"state":"maharashtra"}', { state: 'Gujarat' })).toEqual({ state: 'Maharashtra', code: '27' });
    expect(placeOfSupply(null, { state: 'Gujarat' })).toEqual({ state: 'Gujarat', code: '24' });
    expect(placeOfSupply({ state: 'MH' }, null)).toEqual({ state: 'MH', code: null });
    expect(placeOfSupply(null, null, '29ABCDE1234F1Z5')).toEqual({ state: 'Karnataka', code: '29' });
    expect(placeOfSupply('not json', null)).toBeNull();
  });

  it('an invoice trail lists the quotation, its challans and what the invoice prints', () => {
    const t = buildTrail({
      focus: { type: 'invoice', id: 35 },
      access: ALL,
      quotations: [quotation],
      ledger: fullyBilledLedger,
      challans: [
        challan(2, { invoice_id: 35, status: 'INVOICED', eway_bill_number: '391000000001' }),
        challan(1, { status: 'DELIVERED' }), // not linked yet: billed on the quotation's live invoice
        challan(3, { status: 'DRAFT' }), // never left
        challan(4, { status: 'CANCELLED' }),
      ],
      invoices: [invoice(35)],
      payments: [{ invoice_id: 35, n: '2', amount: '50000.00', last_date: '2026-11-20' }],
    });
    expect(t.quotation).toMatchObject({ number: 'QT-0012', po_number: '4500123', po_date: '2026-11-01', invoiced: true, total: 118000 });
    expect(t.challans.map((c) => c.number)).toEqual(['DC-001', 'DC-002', 'DC-003', 'DC-004']);
    expect(t.challans[0].invoice).toEqual({ id: 35, number: 'KD/26-27/035', date: '2026-11-15', linked: false });
    expect(t.challans[1].invoice).toMatchObject({ id: 35, linked: true });
    expect(t.challans[2].invoice).toBeNull();
    expect(t.references.po).toEqual({ number: '4500123', date: '2026-11-01' });
    expect(t.references.quotation).toEqual({ number: 'QT-0012', date: '2026-10-28' });
    expect(t.references.challans.map((c) => c.number)).toEqual(['DC-001', 'DC-002']);
    expect(t.references.challans[1]).toMatchObject({ eway_bill_number: '391000000001', vehicle_number: 'MH12AB002' });
    expect(t.references.invoice).toBeNull();
    expect(t.payments).toEqual({ count: 2, amount: 50000, last_date: '2026-11-20' });
    expect(t.invoices[0]).toMatchObject({ number: 'KD/26-27/035', live: true, total: 118000, paid: 50000, balance: 68000, payments: 2 });
    expect(t.place_of_supply).toEqual({ state: 'Maharashtra', code: '27' });
  });

  it('a challan trail prints the invoice its goods are billed on', () => {
    const base = { access: ALL, quotations: [quotation], ledger: fullyBilledLedger, invoices: [invoice(35)], payments: [] };
    const sent = buildTrail({ ...base, focus: { type: 'challan', id: 1 }, challans: [challan(1)] });
    expect(sent.references.invoice).toEqual({ number: 'KD/26-27/035', date: '2026-11-15' });
    expect(sent.references.challans).toEqual([]);
    expect(sent.place_of_supply).toBeNull();
    const draft = buildTrail({ ...base, focus: { type: 'challan', id: 3 }, challans: [challan(3, { status: 'DRAFT' })] });
    expect(draft.references.invoice).toBeNull();
  });

  it('bill first, send in lots: lots are numbered per invoice and the last one is marked', () => {
    // Billed 100 up front; 60 sent so far in two lots, 40 still to send.
    const ledger = (sent: number) => [{ ...fullyBilledLedger[0], sent, billed: 100 }];
    const lots = [
      challan(2, { invoice_id: 35, status: 'DISPATCHED' }),
      challan(1, { invoice_id: 35, status: 'DELIVERED' }),
      challan(3, { status: 'DRAFT' }), // not sent yet: no lot
      challan(4, { invoice_id: 35, status: 'INVOICED' }), // billed by its own invoice, not a lot
    ];
    const base = { access: ALL, quotations: [quotation], invoices: [invoice(35)], payments: [], challans: lots };
    const midway = buildTrail({ ...base, ledger: ledger(60), focus: { type: 'challan', id: 2 } });
    expect(midway.challans.map((c) => c.lot)).toEqual([{ number: 1, last: false }, { number: 2, last: false }, null, null]);
    expect(midway.references.lot).toEqual({ number: 2, last: false });
    expect(midway.references.invoice).toEqual({ number: 'KD/26-27/035', date: '2026-11-15' });
    // Everything sent: the newest lot is the last one (it carries the original invoice).
    const done = buildTrail({ ...base, ledger: ledger(100), focus: { type: 'challan', id: 2 } });
    expect(done.references.lot).toEqual({ number: 2, last: true });
    expect(done.challans[0].lot).toEqual({ number: 1, last: false });
    // An invoice trail never reports a lot of its own.
    expect(buildTrail({ ...base, ledger: ledger(60), focus: { type: 'invoice', id: 35 } }).references.lot).toBeNull();
  });

  it("an invoice that travels with the goods prints its own dispatch details", () => {
    const base = { access: ALL, quotations: [quotation], ledger: fullyBilledLedger, challans: [], payments: [] };
    const moving = buildTrail({
      ...base,
      focus: { type: 'invoice', id: 35 },
      invoices: [invoice(35, { vehicle_number: 'MH12AB1234', eway_bill_number: '391000000123', transporter_name: '', lr_number: null })],
    });
    expect(moving.references.dispatch).toEqual({
      vehicle_number: 'MH12AB1234',
      transporter_name: null,
      lr_number: null,
      eway_bill_number: '391000000123',
    });
    const plain = buildTrail({ ...base, focus: { type: 'invoice', id: 35 }, invoices: [invoice(35)] });
    expect(plain.references.dispatch).toBeNull();
  });

  it('an invoice without a quotation still lists the challans it bills', () => {
    const t = buildTrail({
      focus: { type: 'invoice', id: 40 },
      access: ALL,
      quotations: [],
      ledger: [],
      challans: [challan(5, { quotation_id: null, invoice_id: 40, status: 'INVOICED' })],
      invoices: [invoice(40, { quotation_id: null })],
      payments: [],
    });
    expect(t.quotation).toBeNull();
    expect(t.references.quotation).toBeNull();
    expect(t.references.quotations).toEqual([]);
    expect(t.references.challans.map((c) => c.number)).toEqual(['DC-005']);
    expect(t.challans[0].invoice).toMatchObject({ id: 40, linked: true });
    expect(t.balance).toEqual([]);
  });

  it('cancelled invoices bill nothing new; the newest live one counts', () => {
    const t = buildTrail({
      focus: { type: 'quotation', id: 23 },
      access: ALL,
      quotations: [quotation],
      ledger: fullyBilledLedger,
      challans: [challan(1), challan(2, { invoice_id: 30, status: 'INVOICED' })],
      invoices: [invoice(30, { status: 'CANCELLED' }), invoice(36)],
      payments: [],
    });
    expect(t.challans[0].invoice).toMatchObject({ id: 36, linked: false });
    expect(t.challans[1].invoice).toMatchObject({ id: 30, linked: true });
    expect(t.invoices.map((i) => [i.number, i.live])).toEqual([
      ['KD/26-27/030', false],
      ['KD/26-27/036', true],
    ]);
  });

  it('a challan without a quotation has only its own invoice', () => {
    const t = buildTrail({
      focus: { type: 'challan', id: 5 },
      access: ALL,
      quotations: [],
      challans: [challan(5, { invoice_id: null, quotation_id: null })],
      invoices: [],
      payments: [],
    });
    expect(t.quotation).toBeNull();
    expect(t.references).toEqual({ po: null, quotation: null, quotations: [], pos: [], challans: [], invoice: null, lot: null, dispatch: null });
    expect(t.balance).toEqual([]);
  });

  it('part-billed: an unlinked challan is not billed yet, and the balance shows what is left', () => {
    const ledger = [
      { quotation_item_id: 1, quotation_id: 23, product_name: 'Chair', unit: 'pcs', ordered: 100, rate: 1000, discount_percent: 0, sent: 60, billed: 30 },
    ];
    const t = buildTrail({
      focus: { type: 'quotation', id: 23 },
      access: ALL,
      quotations: [quotation],
      ledger,
      challans: [challan(1, { status: 'DELIVERED' }), challan(2, { invoice_id: 35, status: 'INVOICED' })],
      invoices: [invoice(35)],
      payments: [],
    });
    expect(t.challans[0].invoice).toBeNull(); // waits for its own invoice
    expect(t.challans[1].invoice).toMatchObject({ id: 35, linked: true });
    expect(t.quotation).toMatchObject({ fully_billed: false, progress: { sent_pct: 60, billed_pct: 30, to_bill_value: 70000 } });
    expect(t.balance).toEqual([
      {
        quotation_id: 23,
        quotation_number: 'QT-0012',
        lines: [expect.objectContaining({ product_name: 'Chair', ordered: 100, sent: 60, billed: 30, to_send: 40, to_bill: 70, sent_not_billed: 30 })],
      },
    ]);
  });

  it('an invoice billing two quotations prints both quotations and POs', () => {
    const second = { ...quotation, id: 24, quotation_number: 'QT-0013', customer_po_number: '4500999', customer_po_date: '2026-11-03' };
    const t = buildTrail({
      focus: { type: 'invoice', id: 40 },
      access: ALL,
      quotations: [quotation, second],
      challans: [challan(1, { invoice_id: 40, status: 'INVOICED' }), challan(2, { invoice_id: 40, status: 'INVOICED', quotation_id: 24 })],
      invoices: [invoice(40, { quotation_id: 23, quotation_ids: [23, 24] })],
      payments: [],
    });
    expect(t.other_quotations.map((q) => q.number)).toEqual(['QT-0013']);
    expect(t.references.quotations.map((q) => q.number)).toEqual(['QT-0012', 'QT-0013']);
    expect(t.references.pos).toEqual([
      { number: '4500123', date: '2026-11-01' },
      { number: '4500999', date: '2026-11-03' },
    ]);
    expect(t.references.challans.map((c) => c.number)).toEqual(['DC-001', 'DC-002']);
  });

  it('hides money of document types the person cannot open', () => {
    const t = buildTrail({
      focus: { type: 'challan', id: 1 },
      access: { quotation: false, challan: true, invoice: false },
      quotations: [quotation],
      challans: [challan(1)],
      invoices: [invoice(35)],
      payments: [{ invoice_id: 35, n: 1, amount: 100 }],
    });
    expect(t.quotation?.total).toBeNull();
    expect(t.invoices[0]).toMatchObject({ number: 'KD/26-27/035', total: null, paid: null, balance: null, payments: null });
    expect(t.payments).toBeNull();
    expect(t.challans[0].value).toBe(30000);
    // Reference numbers still print.
    expect(t.references.invoice).toEqual({ number: 'KD/26-27/035', date: '2026-11-15' });
  });

  it('search text: trimmed, at least 2 characters, LIKE-safe, spacing ignored', () => {
    expect(parseSearch('  45 00  ')).toBe('45 00');
    expect(parseSearch('4')).toBeNull();
    expect(parseSearch(undefined)).toBeNull();
    expect(parseSearch('x'.repeat(80))).toHaveLength(60);
    expect(likeEscape('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(compact('mh 12-ab.1234/x')).toBe('MH12AB1234X');
  });

  it('ranks exact, then starts/ends with, then contains', () => {
    expect(matchRank('MH 12 AB 1234', 'mh12ab1234')).toBe(0);
    expect(matchRank('KD/26-27/0150', 'KD/26')).toBe(1);
    expect(matchRank('KD/26-27/0150', '0150')).toBe(1);
    expect(matchRank('QT-KD-261015-004-0275', '0150')).toBe(2);
    expect(matchRank('KD/26-27/0150', '9999')).toBe(3);
    expect(matchRank(null, '0150')).toBe(3);
  });
});
