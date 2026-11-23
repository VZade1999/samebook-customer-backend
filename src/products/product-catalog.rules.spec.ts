import {
  type CatalogRow,
  catalogStats,
  filterHit,
  markDuplicates,
  nameKey,
  newPrice,
  parseBulkCategory,
  parseFilter,
  parseIds,
  parsePriceChange,
  parseSort,
  searchHit,
  sortRows,
} from './product-catalog.rules';

const NOW = new Date('2026-11-23T12:00:00');

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  id: 1,
  name: 'Product',
  hsn: '85446090',
  unit: 'NOS',
  price: 100,
  gst: 18,
  cost: 0,
  sku: null,
  barcode: null,
  category_id: null,
  category: null,
  stock: 0,
  min_stock: 0,
  description: null,
  image_url: null,
  active: true,
  created_at: '2025-01-01T10:00:00',
  updated_at: null,
  quoted: 0,
  quoted_qty: 0,
  customers: 0,
  last_quoted: null,
  last_rate: null,
  invoiced: 0,
  sold_qty: 0,
  billed: 0,
  last_invoiced: null,
  challans: 0,
  dispatched_qty: 0,
  last_dispatched: null,
  duplicate: false,
  places: [],
  ...over,
});

describe('product catalogue rules', () => {
  it('reads filters and sorts, falling back safely', () => {
    expect(parseFilter('no_hsn')).toBe('no_hsn');
    expect(parseFilter('drop table')).toBe('all');
    expect(parseSort('price_low')).toBe('price_low');
    expect(parseSort(undefined)).toBe('recent');
    expect(nameKey('  Wire 1.5 SQMM  ')).toBe('wire 1.5 sqmm');
  });

  it('marks products whose name another active product uses', () => {
    const rows = markDuplicates([
      row({ id: 1, name: 'Switch 6A' }),
      row({ id: 2, name: ' switch 6a ' }),
      row({ id: 3, name: 'Switch 6A', active: false }),
      row({ id: 4, name: 'Socket' }),
    ]);
    expect(rows.map((r) => r.duplicate)).toEqual([true, true, false, false]);
  });

  it('matches every typed word against name, HSN, SKU, barcode and category', () => {
    const r = row({ name: '6 M PLATE MYRIUS WH', hsn: '85389000', sku: 'MY-6', category: 'Plates' });
    expect(searchHit(r, 'myrius 6 m')).toBe(true);
    expect(searchHit(r, '85389')).toBe(true);
    expect(searchHit(r, 'my-6 plates')).toBe(true);
    expect(searchHit(r, 'myrius 8 m')).toBe(false);
    expect(searchHit(r, '   ')).toBe(true);
    // A short number must stand on its own: not inside 6795, 16AMP or an HSN.
    const model = row({ name: '2 M PLATE MYRIUS WH 6795 02', hsn: '85389000' });
    expect(searchHit(model, 'myrius 6')).toBe(false);
    expect(searchHit(model, 'myrius 2')).toBe(true);
    expect(searchHit(row({ name: '16AMP SWITCH' }), '6')).toBe(false);
    expect(searchHit(row({ name: '6M PLATE' }), '6')).toBe(true);
    expect(searchHit(row({ name: '1.5 SQMM WIRE' }), '1.5 sqmm')).toBe(true);
  });

  it('puts archived products only under "Archived" and applies each tile', () => {
    const archived = row({ active: false });
    expect(filterHit(archived, 'all', NOW)).toBe(false);
    expect(filterHit(archived, 'archived', NOW)).toBe(true);
    expect(filterHit(row({}), 'archived', NOW)).toBe(false);

    expect(filterHit(row({ last_quoted: '2026-10-01' }), 'quoted', NOW)).toBe(true);
    expect(filterHit(row({ last_quoted: '2026-01-01' }), 'quoted', NOW)).toBe(false);
    expect(filterHit(row({}), 'never', NOW)).toBe(true);
    expect(filterHit(row({ challans: 1 }), 'never', NOW)).toBe(false);
    expect(filterHit(row({ price: 0 }), 'no_price', NOW)).toBe(true);
    expect(filterHit(row({ hsn: ' ' }), 'no_hsn', NOW)).toBe(true);
    expect(filterHit(row({ hsn: null }), 'no_hsn', NOW)).toBe(true);
    expect(filterHit(row({ min_stock: 5, stock: 5 }), 'low_stock', NOW)).toBe(true);
    expect(filterHit(row({ min_stock: 0, stock: 0 }), 'low_stock', NOW)).toBe(false);
    // Kept in a warehouse with nothing left: out of stock, even without an alert level.
    const kept = [{ warehouse_id: 2, name: 'Main', qty: 0, bin: null }];
    expect(filterHit(row({ min_stock: 0, stock: 0, places: kept }), 'low_stock', NOW)).toBe(true);
    expect(filterHit(row({ min_stock: 0, stock: 4, places: [{ ...kept[0], qty: 4 }] }), 'low_stock', NOW)).toBe(false);
    expect(filterHit(row({ created_at: '2026-11-20T09:00:00' }), 'new', NOW)).toBe(true);
  });

  it('sorts by most quoted, last quoted, price and name', () => {
    const rows = [
      row({ id: 1, name: 'B', quoted: 2, last_quoted: '2026-11-01', price: 50, created_at: '2026-01-01' }),
      row({ id: 2, name: 'a', quoted: 9, last_quoted: '2026-09-01', price: 500, created_at: '2026-03-01' }),
      row({ id: 3, name: 'C', quoted: 0, last_quoted: null, price: 5, created_at: '2026-02-01' }),
    ];
    expect(sortRows(rows, 'quoted').map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRows(rows, 'last_quoted').map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortRows(rows, 'price_high').map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRows(rows, 'price_low').map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(rows, 'name').map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRows(rows, 'recent').map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('counts tiles over every product', () => {
    const s = catalogStats(
      markDuplicates([
        row({ id: 1, name: 'A', unit: 'NOS', last_quoted: '2026-11-01', quoted: 1 }),
        row({ id: 2, name: 'a', unit: 'nos', price: 0, hsn: null }),
        row({ id: 3, name: 'C', unit: 'COIL', category_id: 4, category: 'Cables', min_stock: 3, stock: 1, places: [{ warehouse_id: 2, name: 'Main', qty: 1, bin: 'A1' }] }),
        row({ id: 4, name: 'D', active: false }),
      ]),
      NOW,
    );
    expect(s.warehouses).toEqual([{ id: 2, name: 'Main', n: 1 }]);
    expect(s.unplaced).toBe(2);
    expect(s.out_of_stock).toBe(0);
    expect(s).toMatchObject({
      total: 3,
      priced: 2,
      with_hsn: 2,
      ready: 2,
      quoted_90d: 1,
      never_used: 2,
      no_price: 1,
      no_hsn: 1,
      duplicates: 2,
      tracks_stock: 1,
      low_stock: 1,
      archived: 1,
    });
    expect(s.units).toEqual([
      { unit: 'NOS', n: 2 },
      { unit: 'COIL', n: 1 },
    ]);
    expect(s.categories).toEqual([{ id: 4, name: 'Cables', n: 1 }]);
  });

  it('works out new prices with rounding and never below zero', () => {
    expect(newPrice(276, { mode: 'percent', value: 10, round: 0 })).toBe(303.6);
    expect(newPrice(276, { mode: 'percent', value: 10, round: 1 })).toBe(304);
    expect(newPrice(276, { mode: 'percent', value: 10, round: 5 })).toBe(305);
    expect(newPrice(276, { mode: 'percent', value: 10, round: 10 })).toBe(300);
    expect(newPrice(276, { mode: 'amount', value: -300, round: 0 })).toBe(0);
    expect(newPrice(99.99, { mode: 'amount', value: 0.02, round: 0 })).toBe(100.01);
    expect(newPrice(5, { mode: 'set', value: 120.5, round: 0 })).toBe(120.5);
  });

  it('checks bulk requests', () => {
    expect(parsePriceChange({ ids: [], mode: 'percent', value: 5 })).toEqual({ error: 'Pick at least one product' });
    expect(parsePriceChange({ ids: [1], mode: 'x', value: 5 })).toEqual({ error: 'Choose how to change the price' });
    expect(parsePriceChange({ ids: [1], mode: 'percent', value: 900 })).toHaveProperty('error');
    expect(parsePriceChange({ ids: [1], mode: 'set', value: -1 })).toHaveProperty('error');
    expect(parsePriceChange({ ids: [1, '1', 2, 'x'], mode: 'percent', value: 8, round: 7 })).toEqual({
      ids: [1, 2],
      change: { mode: 'percent', value: 8, round: 0 },
    });
    expect(parseIds({ ids: Array.from({ length: 501 }, (_, i) => i + 1) })).toHaveProperty('error');
    expect(parseIds({ ids: [3, 3, 4] })).toEqual({ ids: [3, 4] });
    expect(parseBulkCategory({ ids: [1, 2], category_id: 7 })).toEqual({ ids: [1, 2], category_id: 7 });
    expect(parseBulkCategory({ ids: [1], category_id: null })).toEqual({ ids: [1], category_id: null });
    expect(parseBulkCategory({ ids: [1], category_id: 'x' })).toEqual({ error: 'Pick a category' });
  });
});
