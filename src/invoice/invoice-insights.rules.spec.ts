import {
  buildSummary,
  dateOnly,
  isIsoDate,
  parseInvoiceDates,
  parseListFilter,
  parsePayment,
  parseSort,
  paymentBlocker,
  stateOf,
  statusAfterPayment,
  summaryWindow,
  toPaise,
} from './invoice-insights.rules';

describe('invoice state', () => {
  it('reads the payment state the same way as the SQL', () => {
    expect(stateOf({ status: 'GENERATED', balance_amount: 100, paid_amount: 0 })).toBe('unpaid');
    expect(stateOf({ status: 'PARTIAL_PAID', balance_amount: 40, paid_amount: 60 })).toBe('partial');
    expect(stateOf({ status: 'PAID', balance_amount: 0, paid_amount: 100 })).toBe('paid');
    // A zero balance is paid whatever the stored status says.
    expect(stateOf({ status: 'GENERATED', balance_amount: 0, paid_amount: 0 })).toBe('paid');
    expect(stateOf({ status: 'CANCELLED', balance_amount: 100, paid_amount: 0 })).toBe('cancelled');
    expect(stateOf({ status: 'SUPERSEDED', balance_amount: 100 })).toBe('cancelled');
  });

  it('accepts only known filters and sorts', () => {
    expect(parseListFilter('overdue')).toBe('OVERDUE');
    expect(parseListFilter(' due_soon ')).toBe('DUE_SOON');
    expect(parseListFilter('DRAFT')).toBeNull();
    expect(parseListFilter(undefined)).toBeNull();
    expect(parseSort('BALANCE_HIGH')).toBe('balance_high');
    expect(parseSort('nope')).toBe('newest');
  });

  it('works out the window: six months, a week of "due soon", last month to date', () => {
    expect(summaryWindow('2026-11-18')).toEqual({
      months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      from: '2026-06-01',
      soon: '2026-11-24',
      prevFrom: '2026-10-01',
      prevTo: '2026-10-18',
    });
  });
});

describe('payments', () => {
  it('keeps money in paise', () => {
    expect(toPaise('0.1') + toPaise('0.2')).toBe(30);
    expect(toPaise(1234.565)).toBe(123457);
    expect(statusAfterPayment(10000, 10000)).toBe('PAID');
    expect(statusAfterPayment(10000, 1)).toBe('PARTIAL_PAID');
    expect(statusAfterPayment(10000, 0)).toBe('GENERATED');
  });

  it('blocks payments on cancelled or settled invoices', () => {
    expect(paymentBlocker({ status: 'CANCELLED', grand_total: 100, paid_amount: 0 })).toMatch(/cancelled/);
    expect(paymentBlocker({ status: 'PAID', grand_total: 100, paid_amount: 100 })).toMatch(/already paid/);
    expect(paymentBlocker({ status: 'GENERATED', grand_total: 100, paid_amount: 100 })).toMatch(/already paid/);
    expect(paymentBlocker({ status: 'PARTIAL_PAID', grand_total: 100, paid_amount: 40 })).toBeNull();
    // A credit note can settle what is left.
    expect(paymentBlocker({ status: 'PARTIAL_PAID', grand_total: 100, paid_amount: 40, credited_amount: 60 })).toMatch(/already paid/);
  });

  const ctx = { balancePaise: 50000, today: '2026-11-18' };

  it('accepts a valid payment and cleans the text', () => {
    const r = parsePayment({ amount: '499.995', payment_mode: 'upi', payment_date: '2026-11-17', transaction_reference: '  UTR123  ', notes: '' }, ctx);
    expect(r).toEqual({ ok: true, amountPaise: 50000, date: '2026-11-17', mode: 'UPI', reference: 'UTR123', notes: null });
  });

  it('defaults the date to today', () => {
    const r = parsePayment({ amount: 10, payment_mode: 'CASH' }, ctx);
    expect(r.ok && r.date).toBe('2026-11-18');
  });

  it('rejects bad amounts, modes and dates', () => {
    expect(parsePayment({ amount: 0, payment_mode: 'CASH' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/greater than zero/) });
    expect(parsePayment({ amount: -5, payment_mode: 'CASH' }, ctx)).toMatchObject({ ok: false });
    expect(parsePayment({ amount: 'abc', payment_mode: 'CASH' }, ctx)).toMatchObject({ ok: false });
    expect(parsePayment({ amount: 0.001, payment_mode: 'CASH' }, ctx)).toMatchObject({ ok: false });
    expect(parsePayment({ amount: 500.01, payment_mode: 'CASH' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/more than the balance due \(₹500\.00\)/) });
    expect(parsePayment({ amount: 10, payment_mode: 'BARTER' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/how the payment was made/) });
    expect(parsePayment({ amount: 10, payment_mode: 'CASH', payment_date: '2026-02-30' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/valid payment date/) });
    expect(parsePayment({ amount: 10, payment_mode: 'CASH', payment_date: '2026-11-21' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/future/) });
    // One day of slack for time zones ahead of the business's.
    expect(parsePayment({ amount: 10, payment_mode: 'CASH', payment_date: '2026-11-19' }, ctx).ok).toBe(true);
  });

  it('reads dates from strings and Date objects', () => {
    expect(isIsoDate('2026-11-18')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(dateOnly('2026-11-18T10:00:00.000Z')).toBe('2026-11-18');
    expect(dateOnly(new Date('2026-11-18T00:00:00Z'))).toBe('2026-11-18');
    expect(dateOnly('')).toBeNull();
  });
});

describe('new invoice dates', () => {
  const ctx = { today: '2026-11-18', quotationDate: '2026-11-01' };

  it('defaults the invoice date to today and needs a due date', () => {
    expect(parseInvoiceDates({ payment_due_date: '2026-12-18' }, ctx)).toEqual({ ok: true, invoiceDate: '2026-11-18', dueDate: '2026-12-18' });
    expect(parseInvoiceDates({}, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/when payment is due/) });
  });

  it('keeps the dates in order', () => {
    expect(parseInvoiceDates({ invoice_date: '2026-11-10', payment_due_date: '2026-11-10' }, ctx)).toEqual({ ok: true, invoiceDate: '2026-11-10', dueDate: '2026-11-10' });
    expect(parseInvoiceDates({ invoice_date: '2026-11-10', payment_due_date: '2026-11-09' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/before the invoice date/) });
    expect(parseInvoiceDates({ invoice_date: '2026-10-31', payment_due_date: '2026-12-01' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/before the quotation/) });
    expect(parseInvoiceDates({ invoice_date: '2026-11-25', payment_due_date: '2026-12-25' }, ctx)).toMatchObject({ ok: false, message: expect.stringMatching(/future/) });
  });
});

describe('summary', () => {
  const base = {
    today: '2026-11-18',
    stateRows: [
      { state: 'unpaid', n: '3', v: '3000', p: '0', b: '3000', od_n: '2', od_v: '2000', soon_n: '1', soon_v: '1000', nodue_n: '0', nodue_v: '0' },
      { state: 'partial', n: '1', v: '1000', p: '400', b: '600', od_n: '1', od_v: '600', soon_n: '0', soon_v: '0', nodue_n: '0', nodue_v: '0' },
      { state: 'paid', n: '2', v: '5000', p: '5000', b: '0' },
      { state: 'cancelled', n: '1', v: '900', p: '0', b: '900' },
    ],
    billedRows: [
      { m: '2026-10', n: '2', v: '2000' },
      { m: '2026-11', n: '3', v: '4500.555' },
    ],
    collectedRows: [{ m: '2026-11', n: '2', v: '1400' }],
    prev: { bn: '1', bv: '3000', cn: '0', cv: '0' },
    attentionRows: [
      { id: '7', invoice_number: 'INV-7', customer_name: 'Acme', due_date: '2026-11-08', grand_total: '1000', paid_amount: '0', balance_amount: '1000', state: 'unpaid' },
    ],
    agingRows: [
      { bucket: 'current', n: '1', v: '1000' },
      { bucket: 'd30', n: '3', v: '2600' },
    ],
    debtorRows: [{ id: '5', name: 'Acme', n: '2', due: '2000', late: '1000', oldest: '2026-10-01' }],
    speed: { avg_days: '12.345', n: '2' },
    modeRows: [
      { mode: 'UPI', n: '1', v: '400' },
      { mode: 'CASH', n: '1', v: '1000' },
    ],
  };

  it('totals live invoices only and splits what is still owed', () => {
    const s = buildSummary(base);
    expect(s.total).toEqual({ count: 6, value: 9000, paid: 5400, balance: 3600 });
    expect(s.outstanding).toEqual({ count: 4, value: 3600 });
    expect(s.states.cancelled.count).toBe(1);
    expect(s.overdue).toEqual({ count: 3, value: 2600 });
    expect(s.due_soon).toEqual({ days: 7, count: 1, value: 1000 });
    expect(s.collection_rate).toBe(60);
  });

  it('compares this month so far with the same days of last month', () => {
    const s = buildSummary(base);
    expect(s.this_month).toEqual({ from: '2026-11-01', to: '2026-11-18', billed: { count: 3, value: 4500.56 }, collected: { count: 2, value: 1400 } });
    expect(s.last_month).toMatchObject({ from: '2026-10-01', to: '2026-10-18' });
    expect(s.billed_change).toBe(50);
    expect(s.collected_change).toBeNull();
    expect(s.months).toHaveLength(6);
    expect(s.months[4]).toEqual({ key: '2026-10', billed_count: 2, billed: 2000, collected_count: 0, collected: 0 });
  });

  it('shapes attention, aging, debtors, speed and payment modes', () => {
    const s = buildSummary(base);
    expect(s.attention[0]).toMatchObject({ id: 7, days: -10, balance_amount: 1000, state: 'unpaid' });
    expect(s.aging.map((a) => a.key)).toEqual(['current', 'd30', 'd60', 'd90', 'd90p']);
    expect(s.aging[1]).toMatchObject({ count: 3, value: 2600 });
    expect(s.aging[4]).toMatchObject({ count: 0, value: 0 });
    expect(s.top_debtors[0]).toEqual({ id: 5, name: 'Acme', count: 2, balance: 2000, overdue: 1000, oldest_due: '2026-10-01' });
    expect(s.avg_days_to_pay).toBe(12.3);
    expect(s.payment_modes.map((m) => m.label)).toEqual(['Cash', 'UPI']);
    expect(s.payment_modes[0].share).toBe(71.4);
  });

  it('copes with a company that has no invoices yet', () => {
    const s = buildSummary({ today: '2026-11-18', stateRows: [], billedRows: [], collectedRows: [], attentionRows: [], agingRows: [], debtorRows: [], modeRows: [] });
    expect(s.total).toEqual({ count: 0, value: 0, paid: 0, balance: 0 });
    expect(s.collection_rate).toBeNull();
    expect(s.avg_days_to_pay).toBeNull();
    expect(s.billed_change).toBe(0);
  });
});
