import {
  countDifference,
  LINES_MAX,
  parseCount,
  parseLocation,
  parseMove,
  parseReceive,
  parseStockFilter,
  parseStockSort,
  shortages,
  stockStatus,
} from './stock.rules';

describe('stock rules', () => {
  it('works out a product’s stock status', () => {
    expect(stockStatus(0, 0, false)).toBe('untracked');
    expect(stockStatus(0, 0, true)).toBe('out');
    expect(stockStatus(3, 5, true)).toBe('low');
    expect(stockStatus(5, 5, true)).toBe('low');
    expect(stockStatus(6, 5, true)).toBe('ok');
    // An alert level alone makes it tracked.
    expect(stockStatus(0, 2, false)).toBe('out');
  });

  it('checks a receipt, adding up repeated products and keeping the last cost', () => {
    expect(parseReceive({ lines: [{ product_id: 1, qty: 1 }] })).toEqual({ error: 'Choose the warehouse the goods arrived at' });
    expect(parseReceive({ warehouse_id: 2, lines: [] })).toEqual({ error: 'Add at least one product' });
    expect(parseReceive({ warehouse_id: 2, lines: [{ product_id: 1, qty: 1.5 }] })).toEqual({ error: 'Quantities must be whole numbers above 0' });
    expect(parseReceive({ warehouse_id: 2, lines: [{ product_id: 1, qty: 0 }] })).toHaveProperty('error');
    expect(parseReceive({ warehouse_id: 2, lines: [{ product_id: 1, qty: 2, unit_cost: -1 }] })).toEqual({ error: 'Cost must be ₹0 or more' });
    expect(
      parseReceive({
        warehouse_id: '2',
        reference_no: '  BILL-77  ',
        lines: [
          { product_id: 5, qty: 10, unit_cost: 12.345 },
          { product_id: 5, qty: 5 },
          { product_id: 6, qty: 1, unit_cost: '' },
        ],
      }),
    ).toEqual({
      value: {
        warehouse_id: 2,
        reference_no: 'BILL-77',
        note: null,
        lines: [
          { product_id: 5, qty: 15, unit_cost: 12.35 },
          { product_id: 6, qty: 1, unit_cost: null },
        ],
      },
    });
    const many = Array.from({ length: LINES_MAX + 1 }, (_, i) => ({ product_id: i + 1, qty: 1 }));
    expect(parseReceive({ warehouse_id: 2, lines: many })).toHaveProperty('error');
  });

  it('checks a move between two different warehouses', () => {
    expect(parseMove({ to_warehouse_id: 3, lines: [{ product_id: 1, qty: 1 }] })).toEqual({ error: 'Choose where the goods are now' });
    expect(parseMove({ from_warehouse_id: 3, lines: [{ product_id: 1, qty: 1 }] })).toEqual({ error: 'Choose where the goods are going' });
    expect(parseMove({ from_warehouse_id: 3, to_warehouse_id: 3, lines: [{ product_id: 1, qty: 1 }] })).toEqual({ error: 'Pick two different warehouses' });
    expect(parseMove({ from_warehouse_id: 2, to_warehouse_id: 3, note: 'x'.repeat(300), lines: [{ product_id: 1, qty: 4, unit_cost: 9 }] })).toEqual({
      value: { from_warehouse_id: 2, to_warehouse_id: 3, note: 'x'.repeat(255), lines: [{ product_id: 1, qty: 4 }] },
    });
  });

  it('checks a count: 0 is allowed, a product only once, unknown reasons become "counted"', () => {
    expect(parseCount({ warehouse_id: 2, lines: [{ product_id: 1, counted: -1 }] })).toEqual({ error: 'Counts must be whole numbers, 0 or more' });
    expect(parseCount({ warehouse_id: 2, lines: [{ product_id: 1, counted: 1 }, { product_id: 1, counted: 2 }] })).toEqual({ error: 'Each product only once in a count' });
    expect(parseCount({ warehouse_id: 2, reason: 'STOLEN', lines: [{ product_id: 1, counted: 0 }] })).toEqual({
      value: { warehouse_id: 2, reason: 'COUNTED', note: null, lines: [{ product_id: 1, counted: 0 }] },
    });
    expect(parseCount({ warehouse_id: 2, reason: 'DAMAGED', lines: [{ product_id: 1, counted: 3 }] })).toHaveProperty('value.reason', 'DAMAGED');
    expect(countDifference(10, 7)).toBe(-3);
    expect(countDifference(0, 4)).toBe(4);
  });

  it('checks a rack / shelf change', () => {
    expect(parseLocation({ warehouse_id: 2 })).toEqual({ error: 'Pick a product' });
    expect(parseLocation({ product_id: 9, warehouse_id: 2, bin_location: ' Rack A-3 ' })).toEqual({
      value: { product_id: 9, warehouse_id: 2, bin_location: 'Rack A-3', remove: false },
    });
    expect(parseLocation({ product_id: 9, warehouse_id: 2, remove: true })).toHaveProperty('value.remove', true);
  });

  it('lists what a warehouse is short of', () => {
    expect(shortages([{ name: 'Wire', qty: 5, have: 3 }, { name: 'Tape', qty: 1, have: 9 }])).toEqual(['Wire (has 3, needs 5)']);
  });

  it('reads stock filters and sorts safely', () => {
    expect(parseStockFilter('low')).toBe('low');
    expect(parseStockFilter('nope')).toBe('all');
    expect(parseStockSort('value')).toBe('value');
    expect(parseStockSort(undefined)).toBe('name');
  });
});
