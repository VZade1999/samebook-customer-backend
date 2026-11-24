import {
  ageBucket,
  balanceSheet,
  gstByMonth,
  profitAndLoss,
  creditNotePosting,
  debitNotePosting,
  gstAt,
  gstOnLines,
  noteGstDeadline,
  parseNote,
  parseRefund,
  priceReturn,
  refundPosting,
  takeCredits,
  unitValues,
  allocateReceipt,
  expensePosting,
  journalPosting,
  parseExpense,
  parseJournal,
  parseNewAccount,
  parseReceipt,
  parseTransfer,
  receiptPosting,
  transferPosting,
  voucherPrefix,
  CASH_RECEIPT_LIMIT,
  balanceWords,
  balanced,
  bankCode,
  bankLabel,
  billPosting,
  cashWarnings,
  defaultBooksStart,
  drCr,
  fyEndOf,
  fyLabel,
  fyStartOf,
  invoicePaymentPosting,
  invoicePosting,
  isIsoDate,
  openingPosting,
  openingTarget,
  parseOpenings,
  parseRange,
  parseSettings,
  partyTypeOf,
  supplierPaymentPosting,
  withRunningBalance,
  PostLine,
} from './ledger.rules';

const sums = (lines: PostLine[]) => ({ dr: lines.reduce((s, l) => s + l.dr, 0), cr: lines.reduce((s, l) => s + l.cr, 0) });
const byCode = (lines: PostLine[]) => Object.fromEntries(lines.map((l) => [l.code, l.dr ? l.dr : -l.cr]));

describe('ledger rules — postings', () => {
  it('an invoice: customer owes the total; sales, transport and GST credited; Dr = Cr', () => {
    const p = invoicePosting({
      invoice_number: 'INV-0001',
      invoice_date: '2026-04-05',
      customer_id: 7,
      sub_total: 10000,
      discount_amount: 0,
      transport_charges: 500,
      cgst_amount: 945,
      sgst_amount: 945,
      igst_amount: 0,
      grand_total: 12390,
    });
    expect(p.entry_type).toBe('SALES');
    expect(byCode(p.lines)).toEqual({ DEBTORS: 1239000, SALES: -1000000, TRANSPORT_INCOME: -50000, OUTPUT_CGST: -94500, OUTPUT_SGST: -94500 });
    expect(p.lines.find((l) => l.code === 'DEBTORS')?.party).toEqual({ type: 'CUSTOMER', id: 7 });
    expect(sums(p.lines).dr).toBe(sums(p.lines).cr);
    expect(p.amount).toBe(1239000);
    expect(p.narration).toBe('Goods ₹10,000.00 · GST ₹1,890.00 · transport ₹500.00');
  });

  it('a discount lowers sales; an old invoice that is off by paise gets a round-off line', () => {
    const p = invoicePosting({ invoice_date: '2026-06-20', customer_id: 1, sub_total: 1000, discount_amount: 100, igst_amount: 162, grand_total: 1062.4 });
    expect(byCode(p.lines)).toEqual({ DEBTORS: 106240, SALES: -90000, OUTPUT_IGST: -16200, ROUND_OFF: -40 });
    expect(sums(p.lines).dr).toBe(sums(p.lines).cr);
  });

  it('a payment received: cash to Cash, others to the named bank, else the default bank', () => {
    const base = { payment_date: '2026-04-10', payment_amount: 15000, customer_id: 7, invoice_number: 'INV-0001' };
    expect(byCode(invoicePaymentPosting({ ...base, payment_mode: 'CASH' }, 5).lines)).toEqual({ CASH: 1500000, DEBTORS: -1500000 });
    expect(byCode(invoicePaymentPosting({ ...base, payment_mode: 'UPI' }, 5).lines)).toEqual({ 'BANK:5': 1500000, DEBTORS: -1500000 });
    expect(byCode(invoicePaymentPosting({ ...base, payment_mode: 'CHEQUE', bank_account_id: 3 }, 5).lines)).toEqual({ 'BANK:3': 1500000, DEBTORS: -1500000 });
    expect(byCode(invoicePaymentPosting({ ...base, payment_mode: 'BANK_TRANSFER' }, null).lines)).toEqual({ 'BANK:0': 1500000, DEBTORS: -1500000 });
    expect(invoicePaymentPosting({ ...base, payment_mode: 'UPI', transaction_reference: 'UTR123' }, 5).narration).toBe('By UPI · against INV-0001 · ref UTR123');
  });

  it("a supplier's bill: purchases, freight and input GST; the round-off it carries; you owe the total", () => {
    // 2,000 goods + 100 freight + IGST 377.60 = 2,477.60, rounded up by 0.40 to 2,478.
    const p = billPosting({ bill_number: 'GJ/1', bill_date: '2026-05-01', supplier_id: 4, sub_total: 2000, discount_amount: 0, freight_charges: 100, igst_amount: 377.6, round_off: 0.4, grand_total: 2478 });
    expect(byCode(p.lines)).toEqual({ PURCHASES: 200000, FREIGHT_INWARD: 10000, INPUT_IGST: 37760, ROUND_OFF: 40, CREDITORS: -247800 });
    expect(p.lines.find((l) => l.code === 'CREDITORS')?.party).toEqual({ type: 'SUPPLIER', id: 4 });
    expect(sums(p.lines).dr).toBe(sums(p.lines).cr);
  });

  it('a payment to a supplier: you owe less, money out of cash or bank', () => {
    const p = supplierPaymentPosting({ payment_date: '2026-05-10', amount: 1000, mode: 'BANK_TRANSFER', supplier_id: 4, reference: 'NEFT9' }, 5);
    expect(p.entry_type).toBe('PAYMENT');
    expect(byCode(p.lines)).toEqual({ CREDITORS: 100000, 'BANK:5': -100000 });
    expect(p.narration).toBe('By bank transfer · ref NEFT9');
  });

  it('opening balances sit against "Difference in opening balances"', () => {
    const c = openingTarget({ kind: 'customer', id: 7, paise: 1000000, side: 'Dr' });
    const p = openingPosting(c, 1000000, 'Dr', '2026-04-01');
    expect(byCode(p.lines)).toEqual({ DEBTORS: 1000000, OPENING_DIFF: -1000000 });
    expect(c.source).toBe('OPENING_CUSTOMER');
    const s = openingPosting(openingTarget({ kind: 'supplier', id: 4, paise: 50000, side: 'Cr' }), 50000, 'Cr', '2026-04-01');
    expect(byCode(s.lines)).toEqual({ CREDITORS: -50000, OPENING_DIFF: 50000 });
    expect(openingTarget({ kind: 'bank', id: 5, paise: 1, side: 'Dr' })).toMatchObject({ code: 'BANK:5', source: 'OPENING_BANK', sourceId: 5 });
    expect(openingTarget({ kind: 'cash', id: null, paise: 1, side: 'Dr' })).toMatchObject({ code: 'CASH', source: 'OPENING_CASH', sourceId: 0 });
    expect(openingTarget({ kind: 'account', id: 12, paise: 1, side: 'Cr' }).code).toBe('ID:12');
  });

  it('balanced() nets lines of the same account and drops zero lines', () => {
    const out = balanced([
      { code: 'CASH', dr: 500, cr: 0 },
      { code: 'CASH', dr: 0, cr: 200 },
      { code: 'SALES', dr: 0, cr: 300 },
      { code: 'ROUND_OFF', dr: 0, cr: 0 },
    ]);
    expect(out).toEqual([
      { code: 'CASH', party: null, dr: 300, cr: 0 },
      { code: 'SALES', party: null, dr: 0, cr: 300 },
    ]);
  });
});

describe('ledger rules — balances', () => {
  it('Ravi Traders: opening ₹10,000 + invoice ₹11,800 − UPI ₹15,000 = owes ₹6,800', () => {
    const r = withRunningBalance(1000000, [
      { entry_id: 1, entry_date: '2026-04-05', entry_type: 'SALES', number: 'INV-1', narration: null, source_type: 'INVOICE', source_id: 1, debit: 1180000, credit: 0 },
      { entry_id: 2, entry_date: '2026-04-10', entry_type: 'RECEIPT', number: null, narration: null, source_type: 'INVOICE_PAYMENT', source_id: 1, debit: 0, credit: 1500000 },
    ]);
    expect(r.rows.map((x) => x.balance)).toEqual([2180000, 680000]);
    expect(r.closing).toBe(680000);
    expect(drCr(r.closing)).toEqual({ amount: 6800, side: 'Dr' });
    expect(balanceWords('CUSTOMER', r.closing)).toBe('Owes you');
  });

  it('plain words for each side', () => {
    expect(balanceWords('CUSTOMER', -100)).toBe('Paid in advance');
    expect(balanceWords('SUPPLIER', -100)).toBe('You owe');
    expect(balanceWords('SUPPLIER', 100)).toBe('Advance paid');
    expect(balanceWords('SUPPLIER', 0)).toBe('Settled');
    expect(drCr(-12345)).toEqual({ amount: 123.45, side: 'Cr' });
    expect(drCr(0)).toEqual({ amount: 0, side: '' });
  });
});

describe('ledger rules — dates', () => {
  it('financial year April–March', () => {
    expect(fyStartOf('2026-03-31')).toBe('2025-04-01');
    expect(fyStartOf('2026-04-01')).toBe('2026-04-01');
    expect(fyEndOf('2026-11-24')).toBe('2027-03-31');
    expect(fyLabel('2027-01-15')).toBe('FY 2026-27');
    expect(defaultBooksStart('2026-06-20', '2026-11-24')).toBe('2026-04-01');
    expect(defaultBooksStart(null, '2027-02-01')).toBe('2026-04-01');
    expect(isIsoDate('2026-02-30')).toBe(false);
  });

  it('periods: this FY by default, presets, custom, never before the books start', () => {
    const ctx = { today: '2026-11-24', booksStart: '2026-04-01' };
    expect(parseRange({}, ctx)).toEqual({ ok: true, from: '2026-04-01', to: '2026-11-24', preset: 'fy' });
    expect(parseRange({ range: 'month' }, ctx)).toMatchObject({ from: '2026-11-01', to: '2026-11-24' });
    expect(parseRange({ range: 'last_month' }, ctx)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseRange({ range: 'last_fy' }, { today: '2026-11-24', booksStart: '2020-04-01' })).toMatchObject({ from: '2025-04-01', to: '2026-03-31' });
    expect(parseRange({ from: '2026-05-01', to: '2026-05-31' }, ctx)).toMatchObject({ from: '2026-05-01', to: '2026-05-31', preset: 'custom' });
    expect(parseRange({ from: '2026-01-01', to: '2026-05-31' }, ctx)).toMatchObject({ from: '2026-04-01' });
    expect(parseRange({ from: '2026-06-01', to: '2026-05-31' }, ctx)).toEqual({ ok: false, message: "The 'from' date is after the 'to' date" });
    expect(parseRange({ range: 'custom', from: 'x' }, ctx).ok).toBe(false);
    // Last FY before the books start: clamped to the start.
    expect(parseRange({ range: 'last_fy' }, ctx)).toMatchObject({ from: '2026-04-01', to: '2026-04-01' });
  });
});

describe('ledger rules — settings and opening balances', () => {
  it('books start: a real date, not in the future', () => {
    expect(parseSettings({ books_start: '2026-04-01' }, { today: '2026-11-24' })).toEqual({ ok: true, value: { books_start: '2026-04-01', default_bank_account_id: null } });
    expect(parseSettings({ books_start: '2027-04-01' }, { today: '2026-11-24' }).ok).toBe(false);
    expect(parseSettings({ books_start: '1 April' }, { today: '2026-11-24' }).ok).toBe(false);
    expect(parseSettings({ books_start: '2026-04-01', default_bank_account_id: 5 }, { today: '2026-11-24' })).toMatchObject({ value: { default_bank_account_id: 5 } });
  });

  it('openings: natural side by kind, zero allowed (removes), cash never negative, no doubles', () => {
    const r = parseOpenings({ items: [{ kind: 'customer', id: 7, amount: 10000 }, { kind: 'supplier', id: 4, amount: 500.5 }, { kind: 'cash', amount: 0 }] });
    expect(r).toEqual({
      ok: true,
      items: [
        { kind: 'customer', id: 7, paise: 1000000, side: 'Dr' },
        { kind: 'supplier', id: 4, paise: 50050, side: 'Cr' },
        { kind: 'cash', id: null, paise: 0, side: 'Dr' },
      ],
    });
    expect(parseOpenings({ items: [{ kind: 'cash', amount: 10, side: 'Cr' }] })).toEqual({ ok: false, message: "Cash in hand can't be below zero" });
    expect(parseOpenings({ items: [{ kind: 'customer', id: 7, amount: 1 }, { kind: 'customer', id: 7, amount: 2 }] }).ok).toBe(false);
    expect(parseOpenings({ items: [{ kind: 'customer', id: 7, amount: 1.234 }] }).ok).toBe(false);
    expect(parseOpenings({ items: [{ kind: 'customer', amount: 1 }] }).ok).toBe(false);
    expect(parseOpenings({ items: [] }).ok).toBe(false);
  });
});

describe('ledger rules — Indian cash limits', () => {
  const mv = (date: string, direction: 'IN' | 'OUT', id: number, rupees: number) => ({ date, direction, party_type: 'CUSTOMER' as const, party_id: id, party_name: `P${id}`, paise: rupees * 100 });

  it('269ST: ₹2 lakh or more received in cash from one person in a day', () => {
    const w = cashWarnings([mv('2026-06-30', 'IN', 1, 150000), mv('2026-06-30', 'IN', 1, 60000), mv('2026-07-01', 'IN', 1, 199999), mv('2026-06-30', 'IN', 2, 199999)]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ rule: '269ST', date: '2026-06-30', party_id: 1, amount: 210000 });
    expect(w[0].message).toContain('₹2,10,000.00 received in cash from P1');
    expect(cashWarnings([mv('2026-06-30', 'IN', 1, CASH_RECEIPT_LIMIT / 100)])).toHaveLength(1);
  });

  it('40A(3): more than ₹10,000 paid in cash to one person in a day', () => {
    expect(cashWarnings([mv('2026-06-30', 'OUT', 1, 10000)])).toHaveLength(0);
    const w = cashWarnings([mv('2026-06-30', 'OUT', 1, 6000), mv('2026-06-30', 'OUT', 1, 4001)]);
    expect(w).toEqual([expect.objectContaining({ rule: '40A(3)', amount: 10001 })]);
  });
});

describe('ledger rules — money in & out (step 2)', () => {
  const ctx = { today: '2026-11-24', booksStart: '2026-04-01' };

  it('a receipt: customer, amount, mode; not before the books start, not in the future', () => {
    expect(parseReceipt({ customer_id: 7, amount: 15000, mode: 'UPI' }, ctx)).toEqual({
      ok: true,
      value: { customerId: 7, paise: 1500000, date: '2026-11-24', mode: 'UPI', bankAccountId: null, reference: null, notes: null, allocations: null },
    });
    expect(parseReceipt({ customer_id: 7, amount: 1, mode: 'CASH', date: '2026-03-31' }, ctx)).toMatchObject({ ok: false });
    expect(parseReceipt({ customer_id: 7, amount: 1, mode: 'CASH', date: '2026-12-01' }, ctx)).toEqual({ ok: false, message: "The date can't be in the future" });
    expect(parseReceipt({ customer_id: 7, amount: 0, mode: 'CASH' }, ctx).ok).toBe(false);
    expect(parseReceipt({ customer_id: 7, amount: 5, mode: 'GOLD' }, ctx).ok).toBe(false);
    expect(parseReceipt({ customer_id: 7, amount: 5, mode: 'CASH', bank_account_id: 5 }, ctx)).toMatchObject({ value: { bankAccountId: null } });
  });

  it('allocation: oldest first, the rest is an advance; or the amounts asked for', () => {
    const open = [
      { id: 1, number: 'INV-1', balancePaise: 1180000 },
      { id: 2, number: 'INV-2', balancePaise: 200000 },
    ];
    expect(allocateReceipt(1500000, open, null)).toEqual({ ok: true, lines: [{ invoice_id: 1, paise: 1180000 }, { invoice_id: 2, paise: 200000 }], advance: 120000 });
    expect(allocateReceipt(500000, open, null)).toEqual({ ok: true, lines: [{ invoice_id: 1, paise: 500000 }], advance: 0 });
    expect(allocateReceipt(500000, open, [{ invoice_id: 2, amount: 2000 }])).toEqual({ ok: true, lines: [{ invoice_id: 2, paise: 200000 }], advance: 300000 });
    expect(allocateReceipt(500000, open, [{ invoice_id: 2, amount: 2500 }])).toMatchObject({ ok: false, message: expect.stringContaining('INV-2') });
    expect(allocateReceipt(100000, open, [{ invoice_id: 1, amount: 2000 }])).toMatchObject({ ok: false });
    expect(allocateReceipt(100000, open, [{ invoice_id: 9, amount: 1 }])).toMatchObject({ ok: false });
  });

  it('a receipt in the books: one entry, money in, the customer owes less', () => {
    const p = receiptPosting({ receipt_number: 'RCT/26-27/0001', receipt_date: '2026-11-24', amount: 15000, mode: 'UPI', customer_id: 7, reference: 'UTR1' }, 5);
    expect(byCode(p.lines)).toEqual({ 'BANK:5': 1500000, DEBTORS: -1500000 });
    expect(p.number).toBe('RCT/26-27/0001');
    expect(p.narration).toBe('By UPI · ref UTR1');
  });

  it('an expense: GST credit only with a GSTIN; same state CGST + SGST, other state IGST', () => {
    const base = { account_id: 12, amount: 1000, mode: 'BANK_TRANSFER' };
    const ec = { ...ctx, ourStateCode: '27', gstinProblem: (g: unknown) => (String(g).length === 15 ? null : 'A GSTIN has 15 characters') };
    expect(parseExpense({ ...base, gst_rate: 18, payee_gstin: '27AAPFU0939F1ZV' }, ec)).toMatchObject({ value: { taxType: 'INTRA_STATE', cgst: 9000, sgst: 9000, igst: 0, totalPaise: 118000 } });
    expect(parseExpense({ ...base, gst_rate: 18, payee_gstin: '24AAPFU0939F1ZV' }, ec)).toMatchObject({ value: { taxType: 'INTER_STATE', igst: 18000, totalPaise: 118000 } });
    expect(parseExpense({ ...base, gst_rate: 18 }, ec)).toEqual({ ok: false, message: "GST credit needs the payee's GSTIN — enter it, or leave GST at 0%" });
    expect(parseExpense({ ...base }, ec)).toMatchObject({ value: { taxType: 'NO_GST', totalPaise: 100000 } });
    expect(parseExpense({ ...base, gst_rate: 7 }, ec).ok).toBe(false);
    const p = expensePosting({ expense_number: 'EXP/26-27/0001', expense_date: '2026-11-24', account_id: 12, amount: 1000, cgst_amount: 90, sgst_amount: 90, total: 1180, mode: 'CASH', payee: 'Shree Electric', bill_number: 'B-9' }, 5);
    expect(byCode(p.lines)).toEqual({ 'ID:12': 100000, INPUT_CGST: 9000, INPUT_SGST: 9000, CASH: -118000 });
    expect(p.narration).toBe('Paid to Shree Electric · bill B-9 · by cash');
  });

  it('a transfer (contra): cash deposited in the bank', () => {
    const t = parseTransfer({ from: 'cash', to: { id: 5 }, amount: 50000 }, ctx);
    expect(t).toMatchObject({ ok: true, value: { from: { kind: 'cash' }, to: { kind: 'bank', id: 5 }, paise: 5000000 } });
    if (!t.ok) throw new Error('parse');
    const p = transferPosting({ ...t.value, number: 'CTR/26-27/0001', fromName: 'Cash', toName: 'HDFC …4369' });
    expect(byCode(p.lines)).toEqual({ 'BANK:5': 5000000, CASH: -5000000 });
    expect(p.narration).toBe('Cash → HDFC …4369');
    expect(parseTransfer({ from: 'cash', to: 'cash', amount: 1 }, ctx).ok).toBe(false);
  });

  it('a journal: each line one side, accounts or parties, Dr must equal Cr', () => {
    const ok = parseJournal(
      {
        date: '2026-11-20',
        narration: 'Discount allowed to Ravi',
        lines: [
          { account_id: 30, debit: 500 },
          { party_type: 'customer', party_id: 7, credit: 500 },
        ],
      },
      ctx,
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error('parse');
    const p = journalPosting({ ...ok.value, number: 'JV/26-27/0001' });
    expect(byCode(p.lines)).toEqual({ 'ID:30': 50000, DEBTORS: -50000 });
    expect(p.party).toEqual({ type: 'CUSTOMER', id: 7 });
    expect(parseJournal({ narration: 'x', lines: [{ account_id: 1, debit: 5 }, { account_id: 2, credit: 4 }] }, ctx)).toMatchObject({ ok: false, message: expect.stringContaining('must be equal') });
    expect(parseJournal({ narration: 'x', lines: [{ account_id: 1, debit: 5, credit: 5 }, { account_id: 2, credit: 5 }] }, ctx).ok).toBe(false);
    expect(parseJournal({ narration: '', lines: [] }, ctx).ok).toBe(false);
  });

  it('voucher numbers follow the financial year of the date', () => {
    expect(voucherPrefix('RCT', '2026-11-24')).toBe('RCT/26-27/');
    expect(voucherPrefix('JV', '2027-03-31')).toBe('JV/26-27/');
    expect(voucherPrefix('EXP', '2027-04-01')).toBe('EXP/27-28/');
  });

  it('40A(3) for expenses: by payee name when there is no party', () => {
    const w = cashWarnings([
      { date: '2026-11-24', direction: 'OUT', party_type: null, party_id: null, party_name: 'Shree Electric', paise: 600000 },
      { date: '2026-11-24', direction: 'OUT', party_type: null, party_id: null, party_name: 'shree electric ', paise: 500000 },
    ]);
    expect(w).toEqual([expect.objectContaining({ rule: '40A(3)', amount: 11000 })]);
  });

  it('new accounts: a name and a group you may make', () => {
    expect(parseNewAccount({ name: 'Partner capital — Ravi', group_code: 'CAPITAL' })).toMatchObject({ ok: true, value: { group: 'CAPITAL' } });
    expect(parseNewAccount({ name: 'X', group_code: 'CAPITAL' }).ok).toBe(false);
    expect(parseNewAccount({ name: 'Debtor', group_code: 'SUNDRY_DEBTORS' }).ok).toBe(false);
  });
});

describe('ledger rules — credit & debit notes, refunds (step 3)', () => {
  const ctx = { today: '2026-11-24', booksStart: '2026-04-01' };

  it('unit values carry the line discount and a share of the overall discount', () => {
    // 2 × 100 (no line discount) + 1 × 200 less 10% = 380; overall discount 38 → ratio 0.9
    const u = unitValues({ sub_total: 400, discount_amount: 58 }, [
      { id: 1, qty: 2, rate: 100 },
      { id: 2, qty: 1, rate: 200, discount_percent: 10 },
    ]);
    expect(u.get(1)).toBeCloseTo(90, 6);
    expect(u.get(2)).toBeCloseTo(162, 6);
  });

  it('goods returned: priced at those values, never more than is left to return', () => {
    const lines = [{ id: 1, name: 'MCB', qty: 10, returned: 3, unit: 200 }];
    expect(priceReturn([{ item_id: 1, qty: 2 }], lines)).toEqual({ ok: true, lines: [{ item_id: 1, qty: 2, rate: 200, taxablePaise: 40000 }], taxablePaise: 40000 });
    expect(priceReturn([{ item_id: 1, qty: 8 }], lines)).toEqual({ ok: false, message: 'MCB: only 7 can still come back' });
    expect(priceReturn([{ item_id: 9, qty: 1 }], lines).ok).toBe(false);
  });

  it('GST at the invoice rates, or per line on a bill', () => {
    expect(gstAt(40000, { cgst: 9, sgst: 9, igst: 0 })).toEqual({ cgst: 3600, sgst: 3600, igst: 0 });
    expect(gstOnLines([{ taxablePaise: 100000, gstRate: 18 }, { taxablePaise: 50000, gstRate: 5 }], 'INTRA_STATE')).toEqual({ cgst: 10250, sgst: 10250, igst: 0 });
    expect(gstOnLines([{ taxablePaise: 100000, gstRate: 18 }], 'INTER_STATE')).toEqual({ cgst: 0, sgst: 0, igst: 18000 });
    expect(gstOnLines([{ taxablePaise: 100000, gstRate: 18 }], 'NO_GST')).toEqual({ cgst: 0, sgst: 0, igst: 0 });
  });

  it('the GST deadline for a credit note: 30 November after the financial year', () => {
    expect(noteGstDeadline('2026-11-24')).toBe('2027-11-30');
    expect(noteGstDeadline('2027-03-31')).toBe('2027-11-30');
    expect(noteGstDeadline('2027-04-01')).toBe('2028-11-30');
  });

  it('parsing a note: goods returned needs lines; anything else needs an amount', () => {
    const c = { ...ctx, docKey: 'invoice_id' as const };
    expect(parseNote({ invoice_id: 5, reason: 'GOODS_RETURNED', lines: [{ item_id: 1, qty: 2 }, { item_id: 2, qty: 0 }] }, c)).toEqual({
      ok: true,
      value: { docId: 5, date: '2026-11-24', reason: 'GOODS_RETURNED', note: null, lines: [{ item_id: 1, qty: 2 }], taxablePaise: null, stock: true, warehouseId: null },
    });
    expect(parseNote({ invoice_id: 5, reason: 'PRICE_REDUCED', amount: 500 }, c)).toMatchObject({ value: { taxablePaise: 50000, lines: null, stock: false } });
    expect(parseNote({ invoice_id: 5, reason: 'GOODS_RETURNED', lines: [] }, c).ok).toBe(false);
    expect(parseNote({ invoice_id: 5, reason: 'PRICE_REDUCED' }, c).ok).toBe(false);
    expect(parseNote({ invoice_id: 5, reason: 'WHY' }, c).ok).toBe(false);
    expect(parseNote({ reason: 'OTHER', amount: 1 }, { ...ctx, docKey: 'bill_id' })).toEqual({ ok: false, message: "Choose the supplier's bill" });
  });

  it('credit note, debit note and refund in the books', () => {
    const cn = creditNotePosting({ cn_number: 'CN/26-27/0001', cn_date: '2026-11-24', customer_id: 7, taxable_amount: 400, cgst_amount: 36, sgst_amount: 36, total: 472, invoice_number: 'INV-1', reason: 'GOODS_RETURNED' });
    expect(byCode(cn.lines)).toEqual({ SALES_RETURNS: 40000, OUTPUT_CGST: 3600, OUTPUT_SGST: 3600, DEBTORS: -47200 });
    expect(cn.narration).toBe('Against INV-1 · Goods returned');
    const dn = debitNotePosting({ dn_number: 'DN/26-27/0001', dn_date: '2026-11-24', supplier_id: 4, taxable_amount: 1000, igst_amount: 180, total: 1180, bill_number: 'GJ/1', reason: 'GOODS_RETURNED' });
    expect(byCode(dn.lines)).toEqual({ CREDITORS: 118000, PURCHASE_RETURNS: -100000, INPUT_IGST: -18000 });
    const rf = refundPosting({ refund_number: 'RFD/26-27/0001', refund_date: '2026-11-24', amount: 840, mode: 'UPI', customer_id: 7 }, 5);
    expect(byCode(rf.lines)).toEqual({ DEBTORS: 84000, 'BANK:5': -84000 });
    expect(rf.entry_type).toBe('PAYMENT');
  });

  it('a refund takes advances oldest first, and only what is there', () => {
    const src = [
      { id: 1, leftPaise: 50000 },
      { id: 2, leftPaise: 30000 },
    ];
    expect(takeCredits(src, 60000)).toEqual([
      { source: src[0], paise: 50000 },
      { source: src[1], paise: 10000 },
    ]);
    expect(takeCredits(src, 90000)).toBeNull();
    expect(parseRefund({ customer_id: 7, amount: 840, mode: 'CASH' }, ctx)).toMatchObject({ ok: true, value: { paise: 84000, mode: 'CASH' } });
  });
});

describe('ledger rules — reports (step 4)', () => {
  const m = (id: number, code: string | null, name: string, group: any, rupees: number) => ({ id, code, name, group, paise: rupees * 100 });

  it('ageing buckets by days late', () => {
    expect([0, -5, 1, 30, 31, 60, 61, 90, 91].map(ageBucket)).toEqual(['not_due', 'not_due', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd90_plus']);
  });

  // Sales 10,000 (−400 returns), purchases 6,000, freight 200, rent 1,000; opening stock 2,000, closing 3,000.
  const moves = [
    m(1, 'SALES', 'Sales', 'SALES', -10000),
    m(2, 'SALES_RETURNS', 'Sales returns', 'SALES', 400),
    m(3, 'PURCHASES', 'Purchases', 'PURCHASES', 6000),
    m(4, 'FREIGHT_INWARD', 'Freight', 'DIRECT_EXPENSES', 200),
    m(5, 'EXP_RENT', 'Rent', 'INDIRECT_EXPENSES', 1000),
  ];

  it('profit & loss: gross profit after stock, then net profit', () => {
    const p = profitAndLoss(moves, { opening: 200000, closing: 300000 });
    // Gross = (10,000 − 400) − (2,000 + 6,000 + 200 − 3,000) = 9,600 − 5,200 = 4,400; net = 4,400 − 1,000 = 3,400.
    expect(p.totals.sales).toBe(960000);
    expect(p.gross_profit).toBe(440000);
    expect(p.net_profit).toBe(340000);
    expect(p.sales.map((r) => r.paise)).toEqual([1000000, -40000]);
    const noStock = profitAndLoss(moves, { opening: null, closing: null });
    expect(noStock.gross_profit).toBe(340000);
  });

  it('balance sheet balances: assets = liabilities + profit (with stock and GST)', () => {
    // Books (Dr +): capital 5,000 Cr; opening stock 2,000 Dr; bank 9,000 Dr; debtors 1,000 Dr; creditors 2,000 Cr;
    // output GST 1,500 Cr, input GST 500 Dr; P&L accounts as above (net Dr 3,400 → profit with stock).
    const bal = [
      m(10, 'CAPITAL', 'Capital', 'CAPITAL', -5000),
      m(11, 'STOCK', 'Stock in hand (opening)', 'CURRENT_ASSETS', 2000),
      m(12, 'BANK:1', 'HDFC', 'BANK_ACCOUNTS', 9000),
      m(13, 'DEBTORS', 'Customers', 'SUNDRY_DEBTORS', 1000),
      m(14, 'CREDITORS', 'Suppliers', 'SUNDRY_CREDITORS', -2000),
      m(15, 'OUTPUT_CGST', 'Output CGST', 'DUTIES_TAXES', -1500),
      m(16, 'INPUT_CGST', 'Input CGST', 'DUTIES_TAXES', 500),
    ];
    // Trial-balance check of this setup: Σ = −5,000 + 2,000 + 9,000 + 1,000 − 2,000 − 1,500 + 500 + (P&L −9,600 + 6,200 + 1,000 = −2,400)… = 1,600 ≠ 0,
    // so add the P&L movements' counterpart: profit without stock = 2,400; profit with stock = 2,400 − 2,000 + 3,000 = 3,400.
    const pl = profitAndLoss(moves, { opening: 200000, closing: 300000 });
    const fixed = [...bal, m(17, 'OPENING_DIFF', 'Difference', 'SUSPENSE', -1600)];
    const bs = balanceSheet(fixed, pl.net_profit, 300000);
    expect(bs.difference).toBe(0);
    expect(bs.assets.some((g) => g.rows.some((r) => r.code === 'STOCK'))).toBe(false);
    expect(bs.assets.some((g) => g.rows.some((r) => r.code === 'CLOSING_STOCK' && r.paise === 300000))).toBe(true);
    expect(bs.liabilities.some((g) => g.rows.some((r) => r.code === 'GST_NET' && r.paise === 100000))).toBe(true);
  });

  it('GST by month: output minus input per head', () => {
    const g = gstByMonth([
      { ym: '2026-11', code: 'OUTPUT_CGST', paise: 9000 },
      { ym: '2026-11', code: 'OUTPUT_SGST', paise: 9000 },
      { ym: '2026-11', code: 'INPUT_CGST', paise: -2000 },
      { ym: '2026-11', code: 'INPUT_IGST', paise: -1000 },
      { ym: '2026-11', code: 'SALES', paise: 100000 },
      { ym: '2026-11', code: 'SALES_RETURNS', paise: -10000 },
    ]);
    expect(g).toEqual([
      expect.objectContaining({ month: '2026-11', sales: 90000, output_total: 18000, input_total: 3000, net: 15000, input: { cgst: 2000, sgst: 0, igst: 1000 } }),
    ]);
  });
});

describe('ledger rules — small helpers', () => {
  it('bank labels never show the full number; codes and party types', () => {
    expect(bankLabel({ bank_name: ' HDFC  BANK ', account_number: '50100123454369' })).toBe('HDFC BANK …4369');
    expect(bankLabel(null)).toBe('Bank');
    expect(bankCode(5)).toBe('BANK:5');
    expect(bankCode(null)).toBe('BANK:0');
    expect(partyTypeOf('customers')).toBe('CUSTOMER');
    expect(partyTypeOf('supplier')).toBe('SUPPLIER');
    expect(partyTypeOf('x')).toBeNull();
  });
});
