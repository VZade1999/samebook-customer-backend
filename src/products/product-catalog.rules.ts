// Pure rules for the Products page: tile filters, search, sorting, counts and
// the bulk price formula. No database here, so it is easy to test.

export type CatalogFilter =
  | 'all'
  | 'quoted'
  | 'never'
  | 'no_price'
  | 'no_hsn'
  | 'duplicates'
  | 'low_stock'
  | 'new'
  | 'archived';
export type CatalogSort = 'recent' | 'name' | 'quoted' | 'last_quoted' | 'price_high' | 'price_low';
export type PriceMode = 'percent' | 'amount' | 'set';

/** "Quoted lately" = quoted within this many days. */
export const QUOTED_DAYS = 90;
/** "New" = added within this many days. */
export const NEW_DAYS = 30;
/** Most products one bulk action may touch. */
export const BULK_MAX = 500;

const FILTERS: CatalogFilter[] = ['all', 'quoted', 'never', 'no_price', 'no_hsn', 'duplicates', 'low_stock', 'new', 'archived'];
const SORTS: CatalogSort[] = ['recent', 'name', 'quoted', 'last_quoted', 'price_high', 'price_low'];

export interface CatalogRow {
  id: number;
  name: string;
  hsn: string | null;
  unit: string | null;
  price: number;
  gst: number;
  cost: number;
  sku: string | null;
  barcode: string | null;
  category_id: number | null;
  category: string | null;
  stock: number;
  min_stock: number;
  description: string | null;
  image_url: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** Quotations that include it, how many customers, how much, when last and at what rate (after discount). */
  quoted: number;
  quoted_qty: number;
  customers: number;
  last_quoted: string | null;
  last_rate: number | null;
  /** Live invoices that include it; `billed` only for people who may see invoice money. */
  invoiced: number;
  sold_qty: number;
  billed: number;
  last_invoiced: string | null;
  /** Delivery challans that include it. */
  challans: number;
  dispatched_qty: number;
  last_dispatched: string | null;
  /** Another active product has the same name. */
  duplicate: boolean;
  /** Where it's kept: its stock in each warehouse (with rack / shelf). */
  places: { warehouse_id: number; name: string; qty: number; bin: string | null }[];
}

/** How documents find a product: its name, trimmed, any case (quotation lines carry no product id). */
export const nameKey = (s: unknown) => String(s ?? '').trim().toLowerCase();

export const parseFilter = (v: unknown): CatalogFilter =>
  FILTERS.includes(String(v) as CatalogFilter) ? (String(v) as CatalogFilter) : 'all';
export const parseSort = (v: unknown): CatalogSort =>
  SORTS.includes(String(v) as CatalogSort) ? (String(v) as CatalogSort) : 'recent';

const daysAgo = (iso: string | null, now: Date) => {
  if (!iso) return Infinity;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : Infinity;
};

export const quotedLately = (r: CatalogRow, now: Date) => daysAgo(r.last_quoted, now) <= QUOTED_DAYS;
export const neverUsed = (r: CatalogRow) => r.quoted === 0 && r.invoiced === 0 && r.challans === 0;
/** Its stock is counted: it's kept in a warehouse, or has a low-stock alert. */
export const tracksStock = (r: CatalogRow) => r.min_stock > 0 || (r.places?.length ?? 0) > 0;
export const outOfStock = (r: CatalogRow) => tracksStock(r) && r.stock <= 0;
/** At or under its alert level, or out of stock. */
export const lowStock = (r: CatalogRow) => outOfStock(r) || (r.min_stock > 0 && r.stock <= r.min_stock);
export const isNew = (r: CatalogRow, now: Date) => daysAgo(r.created_at, now) <= NEW_DAYS;
export const hasPrice = (r: CatalogRow) => r.price > 0;
export const hasHsn = (r: CatalogRow) => !!(r.hsn && r.hsn.trim());

/** Marks active products whose name another active product also uses. */
export function markDuplicates(rows: CatalogRow[]): CatalogRow[] {
  const seen = new Map<string, number>();
  rows.forEach((r) => r.active && seen.set(nameKey(r.name), (seen.get(nameKey(r.name)) || 0) + 1));
  return rows.map((r) => ({ ...r, duplicate: r.active && (seen.get(nameKey(r.name)) || 0) > 1 }));
}

/**
 * Every word typed must appear in the name, HSN, SKU, barcode or category.
 * A short number ("6" in "6 M plate") must stand on its own in the name, SKU
 * or category — so "6" finds "6 M" and "6M" but not "6795", "16AMP" or an
 * HSN like 85389000.
 */
export function searchHit(r: CatalogRow, q: string): boolean {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const named = [r.name, r.sku, r.category].filter(Boolean).join(' ').toLowerCase();
  const all = [named, r.hsn, r.barcode].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => (/^\d{1,3}$/.test(w) ? new RegExp(`(^|\\D)${w}(\\D|$)`).test(named) : all.includes(w)));
}

/** Archived products only show under "Archived"; every other tile lists active ones. */
export function filterHit(r: CatalogRow, f: CatalogFilter, now: Date): boolean {
  if (f === 'archived') return !r.active;
  if (!r.active) return false;
  switch (f) {
    case 'quoted':
      return quotedLately(r, now);
    case 'never':
      return neverUsed(r);
    case 'no_price':
      return !hasPrice(r);
    case 'no_hsn':
      return !hasHsn(r);
    case 'duplicates':
      return r.duplicate;
    case 'low_stock':
      return lowStock(r);
    case 'new':
      return isNew(r, now);
    default:
      return true;
  }
}

const byText = (a: string | null, b: string | null) => String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base', numeric: true });
const byDate = (a: string | null, b: string | null) => String(b || '').localeCompare(String(a || ''));

export function sortRows(rows: CatalogRow[], s: CatalogSort): CatalogRow[] {
  const out = [...rows];
  const tie = (a: CatalogRow, b: CatalogRow) => byText(a.name, b.name) || a.id - b.id;
  switch (s) {
    case 'name':
      return out.sort(tie);
    case 'quoted':
      return out.sort((a, b) => b.quoted - a.quoted || byDate(a.last_quoted, b.last_quoted) || tie(a, b));
    case 'last_quoted':
      return out.sort((a, b) => byDate(a.last_quoted, b.last_quoted) || tie(a, b));
    case 'price_high':
      return out.sort((a, b) => b.price - a.price || tie(a, b));
    case 'price_low':
      return out.sort((a, b) => a.price - b.price || tie(a, b));
    default:
      return out.sort((a, b) => byDate(a.created_at, b.created_at) || b.id - a.id);
  }
}

export interface CatalogStats {
  total: number;
  new_30d: number;
  priced: number;
  with_hsn: number;
  ready: number;
  quoted_90d: number;
  never_used: number;
  no_price: number;
  no_hsn: number;
  duplicates: number;
  tracks_stock: number;
  low_stock: number;
  out_of_stock: number;
  archived: number;
  units: { unit: string; n: number }[];
  categories: { id: number; name: string; n: number }[];
  /** Warehouses that keep products, with how many. */
  warehouses: { id: number; name: string; n: number }[];
  /** Products kept in no warehouse. */
  unplaced: number;
}

/** Tile and header counts, over every product (not just the page on screen). */
export function catalogStats(rows: CatalogRow[], now: Date): CatalogStats {
  const live = rows.filter((r) => r.active);
  const units = new Map<string, { unit: string; n: number }>();
  const cats = new Map<number, { id: number; name: string; n: number }>();
  const whs = new Map<number, { id: number; name: string; n: number }>();
  live.forEach((r) => {
    (r.places || []).forEach((p) => {
      const e = whs.get(p.warehouse_id) || { id: p.warehouse_id, name: p.name, n: 0 };
      e.n += 1;
      whs.set(p.warehouse_id, e);
    });
    const u = (r.unit || '').trim();
    if (u) {
      const k = u.toUpperCase();
      const e = units.get(k) || { unit: u, n: 0 };
      e.n += 1;
      units.set(k, e);
    }
    if (r.category_id && r.category) {
      const e = cats.get(r.category_id) || { id: r.category_id, name: r.category, n: 0 };
      e.n += 1;
      cats.set(r.category_id, e);
    }
  });
  const count = (fn: (r: CatalogRow) => boolean) => live.filter(fn).length;
  return {
    total: live.length,
    new_30d: count((r) => isNew(r, now)),
    priced: count(hasPrice),
    with_hsn: count(hasHsn),
    ready: count((r) => hasPrice(r) && hasHsn(r)),
    quoted_90d: count((r) => quotedLately(r, now)),
    never_used: count(neverUsed),
    no_price: count((r) => !hasPrice(r)),
    no_hsn: count((r) => !hasHsn(r)),
    duplicates: count((r) => r.duplicate),
    tracks_stock: count(tracksStock),
    low_stock: count(lowStock),
    out_of_stock: count(outOfStock),
    archived: rows.length - live.length,
    units: [...units.values()].sort((a, b) => b.n - a.n || byText(a.unit, b.unit)),
    categories: [...cats.values()].sort((a, b) => b.n - a.n || byText(a.name, b.name)),
    warehouses: [...whs.values()].sort((a, b) => b.n - a.n || byText(a.name, b.name)),
    unplaced: count((r) => !(r.places?.length ?? 0)),
  };
}

// ── Bulk price change ─────────────────────────────────────────────────────────

export interface PriceChange {
  mode: PriceMode;
  value: number;
  /** 0 = keep paise, otherwise round to the nearest 1, 5 or 10 rupees. */
  round: 0 | 1 | 5 | 10;
}

/** Checks a bulk price request; returns an error message or the cleaned change. */
/** Whole, positive, distinct product ids from a request body. */
const idList = (body: any): number[] => {
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  return [...new Set(raw.map((x) => Number(x)))].filter((x) => Number.isInteger(x) && x > 0);
};

export function parsePriceChange(body: any): { error: string } | { change: PriceChange; ids: number[] } {
  const ids = idList(body);
  if (!ids.length) return { error: 'Pick at least one product' };
  if (ids.length > BULK_MAX) return { error: `You can change up to ${BULK_MAX} products at a time` };
  const mode = String(body?.mode) as PriceMode;
  if (!['percent', 'amount', 'set'].includes(mode)) return { error: 'Choose how to change the price' };
  const value = Number(body?.value);
  if (!Number.isFinite(value)) return { error: 'Enter a number' };
  if (mode === 'percent' && (value < -90 || value > 500 || value === 0)) return { error: 'Use a change between -90% and +500%' };
  if (mode === 'amount' && (value === 0 || Math.abs(value) > 10_000_000)) return { error: 'Enter an amount to add or take off' };
  if (mode === 'set' && (value < 0 || value > 100_000_000)) return { error: 'Enter a price of ₹0 or more' };
  const r = Number(body?.round ?? 0);
  const round = ([0, 1, 5, 10].includes(r) ? r : 0) as PriceChange['round'];
  return { change: { mode, value, round }, ids };
}

/** The new price after a change. Never below zero. */
export function newPrice(old: number, c: PriceChange): number {
  const base = Number(old) || 0;
  let p = c.mode === 'percent' ? base * (1 + c.value / 100) : c.mode === 'amount' ? base + c.value : c.value;
  p = Math.max(0, p);
  if (c.round > 0) p = Math.round(p / c.round) * c.round;
  return Math.round(p * 100) / 100;
}

/** Checks a "Set category" request; category null = no category. */
export function parseBulkCategory(body: any): { error: string } | { ids: number[]; category_id: number | null } {
  const ids = idList(body);
  if (!ids.length) return { error: 'Pick at least one product' };
  if (ids.length > BULK_MAX) return { error: `You can change up to ${BULK_MAX} products at a time` };
  const raw = body?.category_id;
  if (raw === null || raw === undefined || raw === '' || raw === 0) return { ids, category_id: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Pick a category' };
  return { ids, category_id: id };
}

/** Checks a bulk archive request; returns an error message or the ids. */
export function parseIds(body: any): { error: string } | { ids: number[] } {
  const ids = idList(body);
  if (!ids.length) return { error: 'Pick at least one product' };
  if (ids.length > BULK_MAX) return { error: `You can archive up to ${BULK_MAX} products at a time` };
  return { ids };
}
