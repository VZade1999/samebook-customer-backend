import { type DirectoryRow, directoryStats, filterHit, incomplete, lastActivity, parseFilter, parseSort, searchHit, sortRows } from './customer-directory.rules';

const NOW = new Date('2026-11-23T10:00:00Z');
const row = (over: Partial<DirectoryRow>): DirectoryRow => ({
  id: 1,
  type: 'INDIVIDUAL',
  name: 'Asha',
  company_name: null,
  gst_number: null,
  industry: null,
  po_required: false,
  contact: null,
  phone: null,
  email: null,
  city: null,
  state: null,
  created_at: '2026-01-01T00:00:00Z',
  invoices: 0,
  billed: 0,
  due: 0,
  last_invoice: null,
  quotations: 0,
  last_quotation: null,
  challans: 0,
  last_challan: null,
  ...over,
});

const shree = row({
  id: 2,
  type: 'BUSINESS',
  name: 'Shree Traders',
  gst_number: '27ABCDE1234F1Z5',
  contact: { name: 'Ravi Kumar', phone: '98765 43210', email: 'ravi@shree.in', designation: 'Owner' },
  city: 'Pune',
  state: 'Maharashtra',
  invoices: 3,
  billed: 118000,
  due: 18000,
  last_invoice: '2026-11-20',
  last_quotation: '2026-11-22',
  created_at: '2026-11-10T00:00:00Z',
});
const kiran = row({ id: 3, name: 'kiran', phone: '9000000000', state: 'Maharashtra', invoices: 1, billed: 5000, last_invoice: '2026-10-01' });
const nobody = row({ id: 4, name: 'Old Lead', created_at: '2025-05-01T00:00:00Z' });

describe('customer directory', () => {
  it('searches name, GSTIN, contact, city and phone digits', () => {
    expect(searchHit(shree, 'shree')).toBe(true);
    expect(searchHit(shree, '27abcde')).toBe(true);
    expect(searchHit(shree, 'ravi')).toBe(true);
    expect(searchHit(shree, 'pune')).toBe(true);
    expect(searchHit(shree, '98765-43210')).toBe(true);
    expect(searchHit(shree, '4321')).toBe(true);
    expect(searchHit(shree, 'mumbai')).toBe(false);
    expect(searchHit(shree, '')).toBe(true);
  });

  it('filters: owes money, billed, never billed, new, missing contact', () => {
    expect([shree, kiran, nobody].filter((r) => filterHit(r, 'due', NOW)).map((r) => r.id)).toEqual([2]);
    expect([shree, kiran, nobody].filter((r) => filterHit(r, 'billed', NOW)).map((r) => r.id)).toEqual([2, 3]);
    expect([shree, kiran, nobody].filter((r) => filterHit(r, 'never', NOW)).map((r) => r.id)).toEqual([4]);
    expect([shree, kiran, nobody].filter((r) => filterHit(r, 'new', NOW)).map((r) => r.id)).toEqual([2]);
    expect([shree, kiran, nobody].filter((r) => filterHit(r, 'incomplete', NOW)).map((r) => r.id)).toEqual([4]);
    expect(incomplete(kiran)).toBe(false);
  });

  it('sorts by name, billing, money due and last activity', () => {
    expect(sortRows([shree, kiran, nobody], 'name').map((r) => r.id)).toEqual([3, 4, 2]);
    expect(sortRows([kiran, nobody, shree], 'billed').map((r) => r.id)).toEqual([2, 3, 4]);
    expect(sortRows([kiran, nobody, shree], 'due').map((r) => r.id)).toEqual([2, 3, 4]);
    expect(sortRows([nobody, kiran, shree], 'activity').map((r) => r.id)).toEqual([2, 3, 4]);
    expect(sortRows([nobody, kiran, shree], 'recent').map((r) => r.id)).toEqual([2, 3, 4]);
    expect(lastActivity(shree)).toBe('2026-11-22');
  });

  it('counts the tiles over every customer', () => {
    const s = directoryStats([shree, kiran, nobody], NOW);
    expect(s).toMatchObject({ total: 3, business: 1, individual: 2, with_gst: 1, new_30d: 1, billed: 2, never_billed: 1, due_customers: 1, due_total: 18000, billed_total: 123000, incomplete: 1 });
    expect(s.states).toEqual([{ name: 'Maharashtra', count: 2 }]);
  });

  it('reads unknown filters and sorts as the defaults', () => {
    expect(parseFilter('hack')).toBe('all');
    expect(parseFilter('due')).toBe('due');
    expect(parseSort(undefined)).toBe('recent');
    expect(parseSort('billed')).toBe('billed');
  });
});
