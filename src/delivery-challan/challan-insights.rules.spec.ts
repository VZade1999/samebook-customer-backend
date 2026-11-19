import {
  BACKLOG_ITEMS,
  buildSummary,
  isToInvoice,
  parseListFilter,
  parseReason,
  parseSort,
  pendingQty,
  summaryWindow,
} from './challan-insights.rules';

describe('challan list rules', () => {
  it('accepts only known filters, sorts and reasons', () => {
    expect(parseListFilter('to_invoice')).toBe('TO_INVOICE');
    expect(parseListFilter(' dispatched ')).toBe('DISPATCHED');
    expect(parseListFilter('ALL')).toBeNull();
    expect(parseListFilter(undefined)).toBeNull();
    expect(parseSort('VALUE_HIGH')).toBe('value_high');
    expect(parseSort('nope')).toBe('newest');
    expect(parseReason('job_work')).toBe('JOB_WORK');
    expect(parseReason('BRIBE')).toBeNull();
  });

  it('reads "ready to invoice" the same way as the SQL and the dashboard', () => {
    expect(isToInvoice({ status: 'DELIVERED', quotation_id: 4, invoice_id: null })).toBe(true);
    expect(isToInvoice({ status: 'DISPATCHED', quotation_id: 4 })).toBe(true);
    // Standalone challans (job work, transfers…) are never invoiced from here.
    expect(isToInvoice({ status: 'DELIVERED', quotation_id: null, invoice_id: null })).toBe(false);
    // Already linked to an invoice, or not sent yet.
    expect(isToInvoice({ status: 'DISPATCHED', quotation_id: 1, invoice_id: 1 })).toBe(false);
    expect(isToInvoice({ status: 'DRAFT', quotation_id: 4, invoice_id: null })).toBe(false);
    expect(isToInvoice({ status: 'CANCELLED', quotation_id: 4, invoice_id: null })).toBe(false);
  });

  it('never lets an over-sent line go negative', () => {
    expect(pendingQty(7, 5)).toBe(2);
    expect(pendingQty('1060.00', '2120.000')).toBe(0);
    expect(pendingQty(0.3, 0.1)).toBe(0.2);
    expect(pendingQty(null, undefined)).toBe(0);
  });

  it('works out the window: six months, last month to date, a week for forgotten drafts', () => {
    expect(summaryWindow('2026-11-18')).toEqual({
      months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      from: '2026-06-01',
      prevFrom: '2026-10-01',
      prevTo: '2026-10-18',
      staleOn: '2026-11-11',
    });
    // Last month shorter than today's date: clipped to its last day.
    expect(summaryWindow('2026-03-31').prevTo).toBe('2026-02-28');
  });
});

describe('challan summary', () => {
  const base = {
    today: '2026-11-18',
    statusRows: [
      { status: 'DRAFT', n: 4, v: '6460.00', stale: '4', first_sent: null },
      { status: 'DISPATCHED', n: 2, v: '21577.50', stale: 0, first_sent: '2026-06-28' },
      { status: 'DELIVERED', n: '4', v: '53317.88', stale: 0, first_sent: null },
      { status: 'INVOICED', n: 3, v: '1236020.00', stale: 0, first_sent: null },
      { status: 'CANCELLED', n: 1, v: '999.00', stale: 0, first_sent: null },
    ],
    toInvoice: { n: 4, v: '72895.38', link_n: '1' },
    eway: { n: 0, v: 0 },
    onRoadRows: [
      { id: 1, challan_number: 'DC-1', customer_name: 'ABC', reason: 'SALE', from_name: null, to_name: null, sent_on: '2026-06-28', total_value: '2000.00', vehicle_number: 'MH40' },
      { id: 9, challan_number: 'DC-9', customer_name: null, reason: 'STOCK_TRANSFER', from_name: 'Main', to_name: null, sent_on: '2026-11-18', total_value: 0, vehicle_number: null },
    ],
    draftRows: [
      { id: 2, challan_number: 'DC-2', customer_name: 'Karina', reason: 'SALE', affects_stock: 1, from_warehouse_id: 2, from_name: 'Real WH', to_name: null, made_on: '2026-06-28', total_value: '5000.00', eway_bill_number: '1122' },
      { id: 12, challan_number: 'DC-12', customer_name: 'ignored', reason: 'STOCK_TRANSFER', affects_stock: '0', from_warehouse_id: null, from_name: null, to_name: 'Pune', made_on: '2026-11-18', total_value: 0, eway_bill_number: null },
    ],
    readyRows: [
      { id: 6, challan_number: 'DC-6', customer_name: 'Vaibhav', quotation_number: 'QT-49', status: 'DELIVERED', since: '2026-11-10', total_value: '500.00', invoice_number: null },
      { id: 8, challan_number: 'DC-8', customer_name: null, quotation_number: 'QT-319', status: 'DISPATCHED', since: '2026-11-10', total_value: '19577.50', invoice_number: 'INV-7' },
    ],
    monthRows: [
      { m: '2026-06', n: 1, v: '2000.00', c: 0 },
      { m: '2026-11', n: '11', v: '1308915.38', c: '9' },
    ],
    prev: { n: 0, v: 0 },
    reasonRows: [
      { reason: 'SUPPLY_ON_APPROVAL', n: 1, v: 0 },
      { reason: 'SALE', n: '10', v: '1291337.88' },
      { reason: 'PARTIAL_SUPPLY', n: 1, v: '19577.50' },
    ],
    speed: { avg_hours: '2.5', n: '6' },
    backlogRows: [
      { quotation_id: 317, quotation_number: 'QT-317', customer_id: 9, customer_name: 'Avenue', items: 16, pending_items: '15', pending_value: '980000.40', challans: 1, invoiced: 0 },
      { quotation_id: 335, quotation_number: 'QT-335', customer_id: null, customer_name: 'Ajay', items: 2, pending_items: 2, pending_value: '4000', challans: 0, invoiced: 0 },
      { quotation_id: 343, quotation_number: 'QT-343', customer_id: 3, customer_name: 'Vaibhav', items: 2, pending_items: 1, pending_value: '120', challans: 1, invoiced: '1' },
      { quotation_id: 1, quotation_number: 'QT-1', customer_id: 3, customer_name: '', items: 1, pending_items: 0, pending_value: 0, challans: 0, invoiced: 0 },
    ],
  };

  it('counts live challans and leaves cancelled ones out of the total', () => {
    const s = buildSummary(base);
    expect(s.statuses.draft).toEqual({ count: 4, value: 6460 });
    expect(s.statuses.cancelled.count).toBe(1);
    expect(s.total).toEqual({ count: 13, value: 1317375.38 });
    expect(s.drafts).toMatchObject({ count: 4, stale: 4 });
  });

  it('lists what is on the road, oldest first, with days since dispatch', () => {
    const s = buildSummary(base);
    expect(s.on_road.count).toBe(2);
    expect(s.on_road.oldest_days).toBe(143);
    expect(s.on_road.items[0]).toMatchObject({ id: 1, days: 143, customer_name: 'ABC', route: null, reason_label: 'Sale' });
    // A transfer has no customer; it shows where the goods go instead.
    expect(s.on_road.items[1]).toMatchObject({ customer_name: null, route: 'Main → Warehouse', days: 0, reason_label: 'Stock transfer' });
  });

  it('lists the oldest drafts with what the dispatch prompt needs', () => {
    const s = buildSummary(base);
    expect(s.drafts.items[0]).toMatchObject({
      id: 2,
      status: 'DRAFT',
      days: 143,
      affects_stock: true,
      from_warehouse_id: 2,
      from_warehouse_name: 'Real WH',
      eway_bill_number: '1122',
      reason_label: 'Sale',
    });
    expect(s.drafts.items[1]).toMatchObject({ customer_name: null, route: 'Warehouse → Pune', affects_stock: false, from_warehouse_id: null, days: 0 });
    expect(buildSummary({ ...base, draftRows: undefined }).drafts.items).toEqual([]);
  });

  it('says which ready-to-invoice challans will be linked to an existing invoice', () => {
    const s = buildSummary(base);
    expect(s.to_invoice).toMatchObject({ count: 4, value: 72895.38, link_count: 1 });
    expect(s.to_invoice.items[0]).toMatchObject({ days: 8, invoice_number: null });
    expect(s.to_invoice.items[1]).toMatchObject({ customer_name: '—', invoice_number: 'INV-7' });
  });

  it('ranks the goods still to send by value and drops quotations with nothing left', () => {
    const s = buildSummary(base);
    expect(s.backlog.quotations).toBe(3);
    expect(s.backlog.items).toBe(18);
    expect(s.backlog.value).toBe(984120.4);
    expect(s.backlog.list.map((q) => q.quotation_id)).toEqual([317, 335, 343]);
    expect(s.backlog.list[2]).toMatchObject({ invoiced: true, challans: 1 });
    const many = buildSummary({
      ...base,
      backlogRows: Array.from({ length: 9 }, (_, i) => ({ ...base.backlogRows[1], quotation_id: i + 1, pending_value: i })),
    });
    expect(many.backlog.list).toHaveLength(BACKLOG_ITEMS);
    expect(many.backlog.quotations).toBe(9);
  });

  it('fills the six months and compares this month with the same days of last month', () => {
    const s = buildSummary(base);
    expect(s.months.map((m) => m.count)).toEqual([1, 0, 0, 0, 0, 11]);
    expect(s.this_month).toMatchObject({ from: '2026-11-01', to: '2026-11-18', count: 11, confirmed: 9 });
    expect(s.last_month).toMatchObject({ from: '2026-10-01', to: '2026-10-18', count: 0 });
    // Nothing last month: no percentage to show.
    expect(s.sent_change).toBeNull();
  });

  it('orders the reasons by how often goods moved for them', () => {
    const s = buildSummary(base);
    expect(s.reasons.map((r) => r.reason)).toEqual(['SALE', 'PARTIAL_SUPPLY', 'SUPPLY_ON_APPROVAL']);
    expect(s.reasons[0]).toMatchObject({ label: 'Sale', count: 10, share: 83.3 });
  });

  it('turns hours to delivery into days, and has nothing to say without deliveries', () => {
    expect(buildSummary(base).avg_days_to_deliver).toBe(0.1);
    expect(buildSummary({ ...base, speed: { avg_hours: 60, n: 2 } }).avg_days_to_deliver).toBe(2.5);
    expect(buildSummary({ ...base, speed: { avg_hours: null, n: 0 } }).avg_days_to_deliver).toBeNull();
  });

  it('copes with an empty company', () => {
    const s = buildSummary({ today: '2026-11-18', statusRows: [], onRoadRows: [], readyRows: [], monthRows: [], reasonRows: [], backlogRows: [] });
    expect(s.total).toEqual({ count: 0, value: 0 });
    expect(s.on_road.oldest_days).toBeNull();
    expect(s.to_invoice.count).toBe(0);
    expect(s.backlog).toEqual({ quotations: 0, items: 0, value: 0, list: [] });
    expect(s.sent_change).toBe(0);
  });
});
