// The Customers page's list as pure rules: who matches a search / filter, the
// order, and the counts on the tiles (always over every customer, never just
// the page on screen).

export type DirectoryFilter = 'all' | 'due' | 'billed' | 'never' | 'new' | 'incomplete';
export type DirectorySort = 'recent' | 'name' | 'billed' | 'due' | 'activity';
export const FILTERS: readonly DirectoryFilter[] = ['all', 'due', 'billed', 'never', 'new', 'incomplete'];
export const SORTS: readonly DirectorySort[] = ['recent', 'name', 'billed', 'due', 'activity'];

/** How many days count as "new". */
export const NEW_DAYS = 30;

export interface DirectoryRow {
  id: number;
  type: 'BUSINESS' | 'INDIVIDUAL';
  name: string;
  company_name: string | null;
  gst_number: string | null;
  industry: string | null;
  po_required: boolean;
  /** Main contact (the primary one, else the first). */
  contact: { name: string; phone: string | null; email: string | null; designation: string | null } | null;
  /** Customer-level phone / email when there's no contact. */
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  created_at: string | null;
  invoices: number;
  billed: number;
  due: number;
  last_invoice: string | null;
  quotations: number;
  last_quotation: string | null;
  challans: number;
  last_challan: string | null;
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();
const time = (v: string | null) => (v ? new Date(v).getTime() || 0 : 0);

export const parseFilter = (v: unknown): DirectoryFilter => (FILTERS.includes(v as DirectoryFilter) ? (v as DirectoryFilter) : 'all');
export const parseSort = (v: unknown): DirectorySort => (SORTS.includes(v as DirectorySort) ? (v as DirectorySort) : 'recent');

/** Last time you did anything with them (invoice, quotation or challan). */
export const lastActivity = (r: DirectoryRow): string | null =>
  [r.last_invoice, r.last_quotation, r.last_challan].filter(Boolean).sort((a, b) => time(b) - time(a))[0] || null;

/** No way to reach them: no phone and no email, on the customer or their contact. */
export const incomplete = (r: DirectoryRow) => !(r.phone || r.email || r.contact?.phone || r.contact?.email);

export const isNew = (r: DirectoryRow, now: Date) => !!r.created_at && now.getTime() - time(r.created_at) <= NEW_DAYS * 86_400_000;

/** Search across name, company, GSTIN, contact, phone, email, city and state. */
export const searchHit = (r: DirectoryRow, term: string) => {
  const t = lower(term).trim();
  if (!t) return true;
  const digits = t.replace(/\D/g, '');
  const phones = [r.phone, r.contact?.phone].map((p) => String(p ?? '').replace(/\D/g, ''));
  return (
    [r.name, r.company_name, r.gst_number, r.contact?.name, r.email, r.contact?.email, r.city, r.state, r.industry].some((v) => lower(v).includes(t)) ||
    (digits.length >= 4 && phones.some((p) => p.includes(digits)))
  );
};

export const filterHit = (r: DirectoryRow, f: DirectoryFilter, now: Date) => {
  switch (f) {
    case 'due':
      return r.due > 0.005;
    case 'billed':
      return r.invoices > 0;
    case 'never':
      return r.invoices === 0;
    case 'new':
      return isNew(r, now);
    case 'incomplete':
      return incomplete(r);
    default:
      return true;
  }
};

export function sortRows(rows: DirectoryRow[], sort: DirectorySort): DirectoryRow[] {
  const byName = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const list = rows.slice();
  switch (sort) {
    case 'name':
      return list.sort(byName);
    case 'billed':
      return list.sort((a, b) => b.billed - a.billed || b.invoices - a.invoices || byName(a, b));
    case 'due':
      return list.sort((a, b) => b.due - a.due || b.billed - a.billed || byName(a, b));
    case 'activity':
      return list.sort((a, b) => time(lastActivity(b)) - time(lastActivity(a)) || byName(a, b));
    default:
      return list.sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id);
  }
}

/** Counts for the tiles and the header, over every customer. */
export function directoryStats(rows: DirectoryRow[], now: Date) {
  const states = new Map<string, number>();
  rows.forEach((r) => {
    const s = (r.state || '').trim();
    if (s) states.set(s, (states.get(s) || 0) + 1);
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    total: rows.length,
    business: rows.filter((r) => r.type === 'BUSINESS').length,
    individual: rows.filter((r) => r.type !== 'BUSINESS').length,
    with_gst: rows.filter((r) => !!(r.gst_number || '').trim()).length,
    new_30d: rows.filter((r) => isNew(r, now)).length,
    billed: rows.filter((r) => r.invoices > 0).length,
    never_billed: rows.filter((r) => r.invoices === 0).length,
    due_customers: rows.filter((r) => r.due > 0.005).length,
    due_total: round(rows.reduce((s, r) => s + r.due, 0)),
    billed_total: round(rows.reduce((s, r) => s + r.billed, 0)),
    incomplete: rows.filter(incomplete).length,
    states: [...states.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
  };
}
