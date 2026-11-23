// Pure rules for stock: checking receive / move / count requests, stock
// status, and history types. No database here, so it is easy to test.

/** Every kind of change in the stock history. */
export const MOVEMENT_TYPES = [
  'OPENING', // stock held before the history started, or entered with a new product
  'RECEIVED', // goods in (from a supplier)
  'COUNTED', // set to what is on the shelf — the difference, with a reason
  'MOVED', // between two of your warehouses (one line out, one line in)
  'DISPATCHED', // a delivery challan left (or, for a transfer, arrived)
  'DISPATCH_CANCELLED', // a dispatched challan was cancelled — stock back
  'RECEIVE_CANCELLED', // goods received against a PO (GRN) were cancelled — stock taken back out
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Why a count changed the stock. */
export const COUNT_REASONS = ['COUNTED', 'DAMAGED', 'LOST', 'FOUND', 'RETURNED', 'OTHER'] as const;
export type CountReason = (typeof COUNT_REASONS)[number];

/** Most lines one action may carry, and the largest quantity on a line. */
export const LINES_MAX = 200;
export const QTY_MAX = 10_000_000;

export type StockStatus = 'out' | 'low' | 'ok' | 'untracked';

/**
 * A product's stock state. "Tracked" = it is kept in a warehouse or has a
 * low-stock alert; untracked products are simply not counted.
 */
export function stockStatus(total: number, minimum: number, tracked: boolean): StockStatus {
  if (!tracked && !(minimum > 0)) return 'untracked';
  if (total <= 0) return 'out';
  if (minimum > 0 && total <= minimum) return 'low';
  return 'ok';
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const positiveId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export interface ReceiveLine {
  product_id: number;
  qty: number;
  unit_cost: number | null;
}
export interface MoveLine {
  product_id: number;
  qty: number;
}
export interface CountLine {
  product_id: number;
  counted: number;
}

type Err = { error: string };

/** Lines of one action: whole positive quantities; repeats of a product are added up. */
function quantityLines(raw: unknown, withCost: boolean): Err | { lines: ReceiveLine[] } {
  const list: any[] = Array.isArray(raw) ? raw : [];
  if (!list.length) return { error: 'Add at least one product' };
  if (list.length > LINES_MAX) return { error: `Up to ${LINES_MAX} products at a time` };
  const merged = new Map<number, ReceiveLine>();
  for (const l of list) {
    const id = positiveId(l?.product_id);
    if (!id) return { error: 'Pick a product on every line' };
    const qty = int(l?.qty);
    if (!Number.isInteger(qty) || qty <= 0) return { error: 'Quantities must be whole numbers above 0' };
    if (qty > QTY_MAX) return { error: 'That quantity is too large' };
    let cost: number | null = null;
    if (withCost && l?.unit_cost !== undefined && l?.unit_cost !== null && l?.unit_cost !== '') {
      cost = Number(l.unit_cost);
      if (!Number.isFinite(cost) || cost < 0 || cost > 100_000_000) return { error: 'Cost must be ₹0 or more' };
      cost = Math.round(cost * 100) / 100;
    }
    const prev = merged.get(id);
    merged.set(id, prev ? { product_id: id, qty: prev.qty + qty, unit_cost: cost ?? prev.unit_cost } : { product_id: id, qty, unit_cost: cost });
  }
  return { lines: [...merged.values()] };
}

export interface ReceiveInput {
  warehouse_id: number;
  reference_no: string | null;
  note: string | null;
  lines: ReceiveLine[];
}
export function parseReceive(body: any): Err | { value: ReceiveInput } {
  const warehouse_id = positiveId(body?.warehouse_id);
  if (!warehouse_id) return { error: 'Choose the warehouse the goods arrived at' };
  const r = quantityLines(body?.lines, true);
  if ('error' in r) return r;
  return { value: { warehouse_id, reference_no: text(body?.reference_no, 64), note: text(body?.note, 255), lines: r.lines } };
}

export interface MoveInput {
  from_warehouse_id: number;
  to_warehouse_id: number;
  note: string | null;
  lines: MoveLine[];
}
export function parseMove(body: any): Err | { value: MoveInput } {
  const from = positiveId(body?.from_warehouse_id);
  const to = positiveId(body?.to_warehouse_id);
  if (!from) return { error: 'Choose where the goods are now' };
  if (!to) return { error: 'Choose where the goods are going' };
  if (from === to) return { error: 'Pick two different warehouses' };
  const r = quantityLines(body?.lines, false);
  if ('error' in r) return r;
  return { value: { from_warehouse_id: from, to_warehouse_id: to, note: text(body?.note, 255), lines: r.lines.map(({ product_id, qty }) => ({ product_id, qty })) } };
}

export interface CountInput {
  warehouse_id: number;
  reason: CountReason;
  note: string | null;
  lines: CountLine[];
}
export function parseCount(body: any): Err | { value: CountInput } {
  const warehouse_id = positiveId(body?.warehouse_id);
  if (!warehouse_id) return { error: 'Choose the warehouse you counted' };
  const reason = (COUNT_REASONS as readonly string[]).includes(String(body?.reason)) ? (String(body.reason) as CountReason) : 'COUNTED';
  const list: any[] = Array.isArray(body?.lines) ? body.lines : [];
  if (!list.length) return { error: 'Add at least one product' };
  if (list.length > LINES_MAX) return { error: `Up to ${LINES_MAX} products at a time` };
  const seen = new Set<number>();
  const lines: CountLine[] = [];
  for (const l of list) {
    const id = positiveId(l?.product_id);
    if (!id) return { error: 'Pick a product on every line' };
    if (seen.has(id)) return { error: 'Each product only once in a count' };
    seen.add(id);
    const counted = int(l?.counted);
    if (!Number.isInteger(counted) || counted < 0) return { error: 'Counts must be whole numbers, 0 or more' };
    if (counted > QTY_MAX) return { error: 'That count is too large' };
    lines.push({ product_id: id, counted });
  }
  return { value: { warehouse_id, reason, note: text(body?.note, 255), lines } };
}

export interface LocationInput {
  product_id: number;
  warehouse_id: number;
  bin_location: string | null;
  remove: boolean;
}
export function parseLocation(body: any): Err | { value: LocationInput } {
  const product_id = positiveId(body?.product_id);
  const warehouse_id = positiveId(body?.warehouse_id);
  if (!product_id) return { error: 'Pick a product' };
  if (!warehouse_id) return { error: 'Pick a warehouse' };
  return { value: { product_id, warehouse_id, bin_location: text(body?.bin_location, 64), remove: body?.remove === true } };
}

/** What a count changes: counted minus what the books say. */
export const countDifference = (onBooks: number, counted: number) => counted - onBooks;

/** Lines that would take more than a warehouse holds: "Wire (has 3, needs 5)". */
export function shortages(lines: { name: string; qty: number; have: number }[]): string[] {
  return lines.filter((l) => l.have < l.qty).map((l) => `${l.name} (has ${l.have}, needs ${l.qty})`);
}

export type StockFilter = 'all' | 'in' | 'low' | 'out';
export const parseStockFilter = (v: unknown): StockFilter =>
  (['all', 'in', 'low', 'out'] as string[]).includes(String(v)) ? (String(v) as StockFilter) : 'all';
export type StockSort = 'name' | 'stock_high' | 'stock_low' | 'value';
export const parseStockSort = (v: unknown): StockSort =>
  (['name', 'stock_high', 'stock_low', 'value'] as string[]).includes(String(v)) ? (String(v) as StockSort) : 'name';
