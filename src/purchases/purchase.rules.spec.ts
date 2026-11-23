import {
  allocatePayment,
  amendProblem,
  billAlerts,
  billStatus,
  cancelBlocker,
  closeBlocker,
  docTotals,
  fyOf,
  gstinCheckChar,
  gstinProblem,
  hsnSummary,
  needsApproval,
  overBilled,
  parseBillHeader,
  parseLines,
  parsePayment,
  parsePoHeader,
  parseReceipt,
  parseSettings,
  parseSupplier,
  payBy,
  placeCodeFrom,
  purchaseTaxType,
  rateDifferences,
  receiptStatus,
} from './purchase.rules';

const MH = '27AAPFU0939F1ZV'; // a real-format Maharashtra GSTIN (checks out)
const withCheck = (first14: string) => first14 + gstinCheckChar(first14);
const GJ = withCheck('24AABCS1234K1Z');

describe('GSTIN', () => {
  it('accepts a correct GSTIN and spots typos', () => {
    expect(gstinProblem(MH)).toBeNull();
    expect(gstinProblem(MH.toLowerCase())).toBeNull();
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/typo/);
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
    expect(gstinProblem('99AAPFU0939F1ZV')).toMatch(/not a GST state code/);
    expect(gstinProblem('27AAPF00939F1ZV')).toMatch(/doesn't look right/);
    expect(gstinProblem(GJ)).toBeNull();
  });
});

describe('suppliers', () => {
  const base = { name: 'Sharma Supplies', gstin: MH };

  it('fills state and PAN from the GSTIN', () => {
    const r = parseSupplier(base);
    expect(r).toMatchObject({ ok: true, value: { gst_type: 'REGISTERED', gstin: MH, pan: 'AAPFU0939F', state: 'Maharashtra', state_code: '27' } });
  });

  it('needs a GSTIN when registered, refuses one when unregistered', () => {
    expect(parseSupplier({ name: 'A', gst_type: 'REGISTERED' })).toMatchObject({ ok: false, message: expect.stringMatching(/Enter the GSTIN/) });
    expect(parseSupplier({ name: 'A', gst_type: 'COMPOSITION' })).toMatchObject({ ok: false, message: expect.stringMatching(/composition supplier still has a GSTIN/) });
    expect(parseSupplier({ name: 'A', gst_type: 'UNREGISTERED', gstin: MH })).toMatchObject({ ok: false });
    expect(parseSupplier({ name: 'Local shop', state: 'gujarat' })).toMatchObject({ ok: true, value: { gst_type: 'UNREGISTERED', gstin: null, state: 'Gujarat', state_code: '24' } });
    expect(parseSupplier({ gstin: MH })).toMatchObject({ ok: false, message: expect.stringMatching(/name/) });
  });

  it('checks PAN, MSME, credit days and bank details', () => {
    expect(parseSupplier({ ...base, pan: 'ABCDE1234F' })).toMatchObject({ ok: false, message: expect.stringMatching(/doesn't match the GSTIN/) });
    expect(parseSupplier({ ...base, udyam_number: 'UDYAM-MH-26-0012345' })).toMatchObject({ ok: false, message: expect.stringMatching(/Micro, Small or Medium/) });
    expect(parseSupplier({ ...base, msme_type: 'micro', udyam_number: 'udyam-mh-26-0012345' })).toMatchObject({ ok: true, value: { msme_type: 'MICRO', udyam_number: 'UDYAM-MH-26-0012345' } });
    expect(parseSupplier({ ...base, udyam_number: 'UDYAM-12', msme_type: 'SMALL' })).toMatchObject({ ok: false });
    expect(parseSupplier({ ...base, credit_days: 30 })).toMatchObject({ ok: true, value: { credit_days: 30 } });
    expect(parseSupplier({ ...base, credit_days: 400 })).toMatchObject({ ok: false });
    expect(parseSupplier({ ...base, bank_ifsc: 'sbin0001234', bank_account_number: '123456789' })).toMatchObject({ ok: true, value: { bank_ifsc: 'SBIN0001234' } });
    expect(parseSupplier({ ...base, bank_ifsc: 'SBIN1234' })).toMatchObject({ ok: false });
    expect(parseSupplier({ ...base, email: 'not-an-email' })).toMatchObject({ ok: false });
  });

  it('keeps one main address and contact; a branch GSTIN sets the branch state', () => {
    const r = parseSupplier({
      ...base,
      addresses: [
        { address_line_1: 'Plot 4, MIDC', city: 'Pune', state: 'Maharashtra', postal_code: '411019' },
        { address_line_1: 'Godown 2', city: 'Surat', gstin: GJ },
      ],
      contacts: [{ name: 'Ravi', phone: '98200 12345' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.addresses.map((a) => [a.is_primary, a.state_code])).toEqual([
        [1, '27'],
        [0, '24'],
      ]);
      expect(r.value.contacts[0]).toMatchObject({ name: 'Ravi', is_primary: 1 });
    }
    expect(parseSupplier({ ...base, addresses: [{ city: 'Pune' }] })).toMatchObject({ ok: false, message: expect.stringMatching(/address line/) });
    expect(parseSupplier({ ...base, addresses: [{ address_line_1: 'X', postal_code: '4110' }] })).toMatchObject({ ok: false, message: expect.stringMatching(/6 digits/) });
  });
});

describe('who charges GST', () => {
  it('same state → CGST + SGST, other state → IGST, unregistered or composition → none', () => {
    expect(purchaseTaxType({ gst_type: 'REGISTERED', gstin: MH }, '27')).toBe('INTRA_STATE');
    expect(purchaseTaxType({ gst_type: 'REGISTERED', gstin: GJ }, '27')).toBe('INTER_STATE');
    expect(purchaseTaxType({ gst_type: 'COMPOSITION', gstin: MH }, '27')).toBe('NO_GST');
    expect(purchaseTaxType({ gst_type: 'UNREGISTERED' }, '27')).toBe('NO_GST');
    expect(purchaseTaxType({ gst_type: 'REGISTERED', gstin: MH }, null)).toBe('INTER_STATE');
  });

  it('finds the place of supply from a code, a GSTIN or a state name', () => {
    expect(placeCodeFrom(null, 'Maharashtra')).toBe('27');
    expect(placeCodeFrom('', GJ)).toBe('24');
    expect(placeCodeFrom('7')).toBe('07');
    expect(placeCodeFrom('Atlantis', null)).toBeNull();
  });
});

describe('lines and totals', () => {
  it('checks lines; stock lines are whole numbers; rate defaults from the product', () => {
    expect(parseLines([])).toMatchObject({ ok: false });
    expect(parseLines([{ item_name: 'MCB', product_id: 5, qty: 2.5, rate: 200 }])).toMatchObject({ ok: false, message: expect.stringMatching(/whole units/) });
    expect(parseLines([{ item_name: 'Labour', qty: 2.5, rate: 200 }])).toMatchObject({ ok: true });
    const r = parseLines([{ item_name: 'MCB', product_id: 5, qty: 10, rate: 200 }], { gstFor: () => 12 });
    expect(r).toMatchObject({ ok: true, lines: [{ gst_rate: 12, discount_percent: 0 }] });
    expect(parseLines([{ item_name: 'MCB', qty: 1, rate: 1, hsn_code: '85A6' }])).toMatchObject({ ok: false, message: expect.stringMatching(/HSN/) });
    expect(parseLines([{ item_name: 'MCB', qty: 1, rate: 1, discount_percent: 120 }])).toMatchObject({ ok: false });
    expect(parseLines([{ item_name: 'MCB', qty: 1, rate: 1.005 }])).toMatchObject({ ok: false, message: expect.stringMatching(/2 decimals/) });
    expect(parseLines([{ item_name: 'MCB', qty: 1, rate: 1 }], { requirePoItem: true })).toMatchObject({ ok: false });
  });

  const mcb = { product_id: 1, item_name: 'MCB 16A', description: null, hsn_code: '85362010', unit: 'NOS', qty: 100, rate: 200, discount_percent: 0, gst_rate: 18 };

  it('the plan example: 100 MCBs at ₹200 from Gujarat → ₹20,000 + IGST ₹3,600 = ₹23,600', () => {
    const t = docTotals([mcb], 0, 'INTER_STATE', true);
    expect(t).toMatchObject({ sub_total: 20000, taxable_amount: 20000, igst_amount: 3600, cgst_amount: 0, round_off: 0, grand_total: 23600 });
    // From Maharashtra (same state): CGST ₹1,800 + SGST ₹1,800.
    expect(docTotals([mcb], 0, 'INTRA_STATE', true)).toMatchObject({ cgst_amount: 1800, sgst_amount: 1800, igst_amount: 0, grand_total: 23600 });
    // Unregistered supplier: no GST at all.
    expect(docTotals([mcb], 0, 'NO_GST', true)).toMatchObject({ taxable_amount: 20000, igst_amount: 0, grand_total: 20000 });
  });

  it('each line at its own rate; freight shared by value and taxed with them; total rounded to the rupee', () => {
    const wire = { ...mcb, product_id: 2, item_name: 'Wire', hsn_code: '85444999', qty: 3, rate: 1000, discount_percent: 10, gst_rate: 5 };
    const t = docTotals([mcb, wire], 330, 'INTRA_STATE', true);
    // MCB 20,000 + wire 2,700 = 22,700 of items; freight 330 shared 290.75 / 39.25.
    expect(t.items_value).toBe(22700);
    expect(t.discount_amount).toBe(300);
    expect(t.lines.map((l) => l.freight_share)).toEqual([290.75, 39.25]);
    expect(t.taxable_amount).toBe(23030);
    // MCB: 18% of 20,290.75 = 3,652.335 → CGST 1,826.17 ×2; wire: 5% of 2,739.25 = 136.9625 → CGST 68.48 ×2.
    expect(t.cgst_amount).toBe(1894.65);
    expect(t.sgst_amount).toBe(1894.65);
    // 22,700 + 330 + 3,789.30 = 26,819.30 → ₹26,819 with −0.30 round-off.
    expect(t.round_off).toBe(-0.3);
    expect(t.grand_total).toBe(26819);
    expect(hsnSummary(t.lines)).toEqual([
      { hsn: '85362010', rate: 18, taxable: 20290.75, cgst: 1826.17, sgst: 1826.17, igst: 0 },
      { hsn: '85444999', rate: 5, taxable: 2739.25, cgst: 68.48, sgst: 68.48, igst: 0 },
    ]);
    // Freight not taxed (switched off): added after GST.
    const off = docTotals([mcb], 500, 'INTRA_STATE', false);
    expect(off).toMatchObject({ freight_gst: 0, taxable_amount: 20000, cgst_amount: 1800, grand_total: 24100 });
  });
});

describe('PO header, approval and status', () => {
  const today = '2026-11-23';
  it('checks the header', () => {
    expect(parsePoHeader({}, today)).toMatchObject({ ok: false, message: 'Choose the supplier' });
    expect(parsePoHeader({ supplier_id: 3, po_date: '2026-11-24' }, today)).toMatchObject({ ok: false, message: expect.stringMatching(/future/) });
    expect(parsePoHeader({ supplier_id: 3, expected_date: '2026-11-20' }, today)).toMatchObject({ ok: false, message: expect.stringMatching(/before the PO date/) });
    expect(parsePoHeader({ supplier_id: 3, freight_charges: -5 }, today)).toMatchObject({ ok: false });
    expect(parsePoHeader({ supplier_id: 3, warehouse_id: '4', freight_charges: '250' }, today)).toMatchObject({ ok: true, value: { po_date: today, warehouse_id: 4, freight_charges: 250 } });
  });

  it('approval: approvers never wait; others wait unless within the limit', () => {
    expect(needsApproval(99999, true, null)).toBe(false);
    expect(needsApproval(100, false, null)).toBe(true);
    expect(needsApproval(40000, false, 50000)).toBe(false);
    expect(needsApproval(60000, false, 50000)).toBe(true);
    expect(needsApproval(1, false, 0)).toBe(true);
  });

  it('status after goods arrive', () => {
    expect(receiptStatus([{ ordered: 100, received: 60 }], 'SENT')).toBe('PARTLY_RECEIVED');
    expect(receiptStatus([{ ordered: 100, received: 100 }, { ordered: 5, received: 5 }], 'SENT')).toBe('RECEIVED');
    expect(receiptStatus([{ ordered: 100, received: 0 }], 'SENT')).toBe('SENT');
    expect(receiptStatus([{ ordered: 100, received: 105 }], 'SENT')).toBe('RECEIVED');
  });

  it('cancel only when nothing arrived; close only an open PO where something arrived', () => {
    expect(cancelBlocker({ status: 'SENT' }, false)).toBeNull();
    expect(cancelBlocker({ status: 'PARTLY_RECEIVED' }, true)).toMatch(/close it instead/);
    expect(cancelBlocker({ status: 'CANCELLED' }, false)).toMatch(/already/);
    expect(closeBlocker({ status: 'PARTLY_RECEIVED' }, true)).toBeNull();
    expect(closeBlocker({ status: 'SENT' }, false)).toMatch(/cancel the PO instead/);
    expect(closeBlocker({ status: 'RECEIVED' }, true)).toMatch(/can't be closed/);
  });

  it('an amendment keeps what already arrived', () => {
    const ledger = [
      { po_item_id: 1, item_name: 'MCB', product_id: 9, unit: 'NOS', ordered: 100, received: 60, billed: 0 },
      { po_item_id: 2, item_name: 'Wire', product_id: null, unit: 'MTR', ordered: 50, received: 0, billed: 0 },
    ];
    const line = (id: number | null, qty: number, product: number | null = 9) => ({ po_item_id: id, product_id: product, item_name: 'X', description: null, hsn_code: null, unit: null, qty, rate: 1, discount_percent: 0, gst_rate: 18 });
    expect(amendProblem([line(1, 80)], ledger)).toBeNull(); // wire removed: nothing arrived
    expect(amendProblem([line(1, 50)], ledger)).toMatch(/60 NOS already arrived/);
    expect(amendProblem([line(2, 5, null)], ledger)).toMatch(/can't be removed/);
    expect(amendProblem([line(1, 80, 7)], ledger)).toMatch(/product can't change/);
    expect(amendProblem([line(1, 80), line(99, 1)], ledger)).toMatch(/isn't on this PO/);
  });
});

describe('goods received', () => {
  const ledger = [
    { po_item_id: 1, item_name: 'MCB', product_id: 9, unit: 'NOS', ordered: 100, received: 60 },
    { po_item_id: 2, item_name: 'Labour', product_id: null, unit: 'HRS', ordered: 10, received: 0 },
  ];
  const ctx = { today: '2026-11-23', poDate: '2026-11-01', overPercent: 0 };

  it('takes part deliveries and keeps rejected goods out of stock', () => {
    const r = parseReceipt({ lines: [{ po_item_id: 1, received_qty: 40, rejected_qty: 2, reject_reason: 'broken' }] }, ledger, ctx);
    expect(r).toMatchObject({ ok: true, header: { receipt_date: '2026-11-23' }, lines: [{ po_item_id: 1, accepted_qty: 38, rejected_qty: 2 }] });
  });

  it('refuses more than ordered, unless an extra % is allowed', () => {
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 41 }] }, ledger, ctx)).toMatchObject({ ok: false, message: 'MCB: only 40 NOS left to receive, not 41 NOS' });
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 45 }] }, ledger, { ...ctx, overPercent: 5 })).toMatchObject({ ok: true });
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 46 }] }, ledger, { ...ctx, overPercent: 5 })).toMatchObject({ ok: false, message: expect.stringMatching(/5% extra/) });
  });

  it('checks whole units, reasons, dates and e-way bills', () => {
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 2.5 }] }, ledger, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/whole units/) });
    expect(parseReceipt({ lines: [{ po_item_id: 2, received_qty: 2.5 }] }, ledger, ctx)).toMatchObject({ ok: true });
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 5, rejected_qty: 1 }] }, ledger, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/say why/) });
    expect(parseReceipt({ lines: [{ po_item_id: 1, received_qty: 0 }] }, ledger, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/at least one/) });
    expect(parseReceipt({ receipt_date: '2026-10-01', lines: [{ po_item_id: 1, received_qty: 1 }] }, ledger, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/before the PO date/) });
    expect(parseReceipt({ eway_bill_number: '1234', lines: [{ po_item_id: 1, received_qty: 1 }] }, ledger, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/12 digits/) });
    expect(parseReceipt({ lines: [{ po_item_id: 7, received_qty: 1 }] }, ledger, ctx)).toMatchObject({ ok: false });
  });
});

describe('supplier bills', () => {
  const today = '2026-11-23';
  it('checks the header', () => {
    expect(parseBillHeader({ supplier_id: 2, bill_date: today }, today)).toMatchObject({ ok: false, message: expect.stringMatching(/bill \(invoice\) number/) });
    expect(parseBillHeader({ supplier_id: 2, bill_number: 'GJ/123', bill_date: '2026-12-01' }, today)).toMatchObject({ ok: false });
    expect(parseBillHeader({ supplier_id: 2, bill_number: 'GJ/123', bill_date: today, due_date: '2026-11-01' }, today)).toMatchObject({ ok: false });
    expect(parseBillHeader({ supplier_id: 2, bill_number: ' GJ/123 ', bill_date: today }, today)).toMatchObject({ ok: true, value: { bill_number: 'GJ/123' } });
  });

  it('bills only what arrived and is not billed yet', () => {
    const ledger = [{ po_item_id: 1, item_name: 'MCB', product_id: 9, unit: 'NOS', ordered: 100, received: 60, billed: 20 }];
    const l = (qty: number) => ({ po_item_id: 1, product_id: 9, item_name: 'MCB', description: null, hsn_code: null, unit: 'NOS', qty, rate: 200, discount_percent: 0, gst_rate: 18 });
    expect(overBilled([l(40)], ledger)).toBeNull();
    expect(overBilled([l(41)], ledger)).toMatch(/only 40 NOS arrived/);
    expect(overBilled([l(20), l(21)], ledger)).toMatch(/only 40/);
  });

  it('warns when the bill rate differs from the PO', () => {
    const l = { po_item_id: 1, product_id: 9, item_name: 'MCB', description: null, hsn_code: null, unit: 'NOS', qty: 1, rate: 205, discount_percent: 0, gst_rate: 18 };
    const po = new Map([[1, { rate: 200, discount_percent: 0, item_name: 'MCB' }]]);
    expect(rateDifferences([l], po)).toEqual(['MCB: ₹205 on the bill vs ₹200 on the PO (+2.5%)']);
    expect(rateDifferences([{ ...l, rate: 200 }], po)).toEqual([]);
  });

  it('status, MSME 45 days and the 180-day GST credit rule', () => {
    expect(billStatus(23600, 0)).toBe('UNPAID');
    expect(billStatus(23600, 10000)).toBe('PARTLY_PAID');
    expect(billStatus(23600, 23600)).toBe('PAID');
    expect(payBy({ bill_date: '2026-11-01', due_date: '2027-01-30' }, 'MICRO')).toEqual({ date: '2026-12-16', msme: true });
    expect(payBy({ bill_date: '2026-11-01', due_date: '2026-12-01' }, 'SMALL')).toEqual({ date: '2026-12-01', msme: false });
    expect(payBy({ bill_date: '2026-11-01', due_date: '2027-01-30' }, 'MEDIUM')).toEqual({ date: '2027-01-30', msme: false });
    const a = billAlerts({ bill_date: '2026-11-01', due_date: '2026-11-15', balance_amount: 13600 }, 'MICRO', '2026-11-23');
    expect(a).toEqual({ overdue_days: 8, msme_due: '2026-12-16', msme_days_left: 23, itc_due: '2027-04-30', itc_days_left: 158 });
    expect(billAlerts({ bill_date: '2026-11-01', balance_amount: 0 }, null, '2026-11-23')).toBeNull();
  });

  it('knows the Indian financial year', () => {
    expect(fyOf('2026-11-23')).toBe('2026-27');
    expect(fyOf('2027-03-31')).toBe('2026-27');
    expect(fyOf('2027-04-01')).toBe('2027-28');
  });
});

describe('payments to suppliers', () => {
  const today = '2026-11-23';
  it('checks a payment', () => {
    expect(parsePayment({ supplier_id: 2, amount: 0, mode: 'UPI' }, today)).toMatchObject({ ok: false });
    expect(parsePayment({ supplier_id: 2, amount: 100, mode: 'GOLD' }, today)).toMatchObject({ ok: false });
    expect(parsePayment({ supplier_id: 2, amount: 100, mode: 'upi', allocations: [{ bill_id: 1, amount: 150 }] }, today)).toMatchObject({ ok: false, message: expect.stringMatching(/more than/) });
    expect(parsePayment({ supplier_id: 2, amount: '10000', mode: 'bank_transfer' }, today)).toMatchObject({ ok: true, value: { amount: 10000, mode: 'BANK_TRANSFER', allocations: null } });
  });

  const bills = [
    { id: 1, balance: 23600, pay_by: '2026-12-16', bill_number: 'A' },
    { id: 2, balance: 5000, pay_by: '2026-12-01', bill_number: 'B' },
  ];
  it('pays the oldest due first; the rest is an advance', () => {
    expect(allocatePayment(10000, bills, null)).toEqual({ ok: true, allocations: [{ bill_id: 2, amount: 5000 }, { bill_id: 1, amount: 5000 }], advance: 0 });
    expect(allocatePayment(30000, bills, null)).toEqual({ ok: true, allocations: [{ bill_id: 2, amount: 5000 }, { bill_id: 1, amount: 23600 }], advance: 1400 });
    expect(allocatePayment(10000, [], null)).toEqual({ ok: true, allocations: [], advance: 10000 });
  });

  it('follows the split given, within each bill', () => {
    expect(allocatePayment(10000, bills, [{ bill_id: 1, amount: 10000 }])).toEqual({ ok: true, allocations: [{ bill_id: 1, amount: 10000 }], advance: 0 });
    expect(allocatePayment(10000, bills, [{ bill_id: 2, amount: 6000 }])).toMatchObject({ ok: false, message: expect.stringMatching(/only ₹5000/) });
    expect(allocatePayment(10000, bills, [{ bill_id: 9, amount: 100 }])).toMatchObject({ ok: false });
  });
});

describe('settings', () => {
  it('approval limit, extra %, terms', () => {
    expect(parseSettings({})).toMatchObject({ ok: true, value: { approval_limit: null, over_receipt_percent: 0 } });
    expect(parseSettings({ approval_limit: '50000', over_receipt_percent: 5 })).toMatchObject({ ok: true, value: { approval_limit: 50000, over_receipt_percent: 5 } });
    expect(parseSettings({ approval_limit: -1 })).toMatchObject({ ok: false });
    expect(parseSettings({ over_receipt_percent: 80 })).toMatchObject({ ok: false });
  });
});
