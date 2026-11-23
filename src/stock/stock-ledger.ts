import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import type { MovementType } from './stock.rules';

/**
 * The stock engine shared by the Stock routes and delivery challans. Every
 * change happens inside the caller's transaction:
 *   1. lock the stock rows it touches (one fixed order — no deadlocks),
 *   2. change product_inventory (stock per warehouse),
 *   3. write a stock_movements row with the balance after,
 *   4. set products.stock_quantity to the sum over its warehouses.
 * Stock is kept per product (variant_id NULL); rows held per variant (old
 * demo data) still count towards totals.
 */

export interface LedgerEntry {
  company_id: number;
  product_id: number;
  variant_id?: number | null;
  warehouse_id: number | null;
  type: MovementType;
  quantity: number;
  balance_after: number;
  unit_cost?: number | null;
  reason?: string | null;
  reference_type?: string | null;
  reference_id?: number | null;
  reference_no?: string | null;
  batch_id?: string | null;
  note?: string | null;
  created_by?: number | null;
}

const num = (v: unknown) => Number(v) || 0;
export const newBatch = () => randomUUID();

const select = (sequelize: any, t: any, sql: string, replacements: Record<string, unknown>) =>
  sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction: t }) as Promise<any[]>;
const run = (sequelize: any, t: any, sql: string, replacements: Record<string, unknown>) =>
  sequelize.query(sql, { replacements, transaction: t });

/** Locks the product-level stock rows of these (product, warehouse) pairs, warehouse first then product. */
export async function lockRows(sequelize: any, t: any, pairs: { product_id: number; warehouse_id: number }[]) {
  const keys = [...new Map(pairs.map((p) => [`${p.warehouse_id}:${p.product_id}`, p])).values()].sort(
    (a, b) => a.warehouse_id - b.warehouse_id || a.product_id - b.product_id,
  );
  for (const p of keys) {
    await select(
      sequelize,
      t,
      `SELECT id FROM product_inventory
       WHERE product_id = :p AND warehouse_id = :w AND is_active = 1
       ORDER BY (variant_id IS NULL) DESC, id FOR UPDATE`,
      { p: p.product_id, w: p.warehouse_id },
    );
  }
}

/** A product's stock in one warehouse (all its rows there, variants included). */
export async function levelOf(sequelize: any, t: any, productId: number, warehouseId: number): Promise<number> {
  const [r] = await select(
    sequelize,
    t,
    `SELECT COALESCE(SUM(stock_level), 0) AS s FROM product_inventory WHERE product_id = :p AND warehouse_id = :w AND is_active = 1`,
    { p: productId, w: warehouseId },
  );
  return num(r?.s);
}

/** Does this product keep its stock per variant in this warehouse (old demo data)? */
export async function heldPerVariant(sequelize: any, t: any, productId: number, warehouseId: number): Promise<boolean> {
  const [r] = await select(
    sequelize,
    t,
    `SELECT COUNT(*) AS n FROM product_inventory WHERE product_id = :p AND warehouse_id = :w AND is_active = 1 AND variant_id IS NOT NULL AND stock_level <> 0`,
    { p: productId, w: warehouseId },
  );
  return num(r?.n) > 0;
}

/**
 * Adds `delta` to the product-level row of (product, warehouse), creating it
 * when missing. Returns the product's new stock in that warehouse.
 */
export async function changeLevel(
  sequelize: any,
  t: any,
  productId: number,
  warehouseId: number,
  delta: number,
  binLocation?: string | null,
): Promise<number> {
  const [row] = await select(
    sequelize,
    t,
    `SELECT id FROM product_inventory WHERE product_id = :p AND warehouse_id = :w AND variant_id IS NULL AND is_active = 1 ORDER BY id LIMIT 1`,
    { p: productId, w: warehouseId },
  );
  if (row) {
    await run(
      sequelize,
      t,
      `UPDATE product_inventory SET stock_level = stock_level + :d${binLocation !== undefined ? ', bin_location = :b' : ''}, updated_at = NOW() WHERE id = :id`,
      { d: delta, id: row.id, b: binLocation ?? null },
    );
  } else {
    await run(
      sequelize,
      t,
      `INSERT INTO product_inventory (product_id, variant_id, warehouse_id, bin_location, stock_level, is_active, created_at, updated_at)
       VALUES (:p, NULL, :w, :b, :d, 1, NOW(), NOW())`,
      { p: productId, w: warehouseId, b: binLocation ?? null, d: delta },
    );
  }
  return levelOf(sequelize, t, productId, warehouseId);
}

/** Writes history rows. */
export async function record(sequelize: any, t: any, entries: LedgerEntry[]) {
  if (!entries.length) return;
  const cols = [
    'company_id', 'product_id', 'variant_id', 'warehouse_id', 'type', 'quantity', 'balance_after', 'unit_cost', 'reason',
    'reference_type', 'reference_id', 'reference_no', 'batch_id', 'note', 'created_by',
  ] as const;
  const reps: Record<string, unknown> = {};
  const values = entries
    .map((e, i) => {
      cols.forEach((c) => (reps[`${c}${i}`] = (e as any)[c] ?? null));
      return `(${cols.map((c) => `:${c}${i}`).join(', ')}, NOW())`;
    })
    .join(', ');
  await run(sequelize, t, `INSERT INTO stock_movements (${cols.join(', ')}, created_at) VALUES ${values}`, reps);
}

/** products.stock_quantity = the product's stock over all its warehouses. */
export async function syncTotals(sequelize: any, t: any, productIds: number[]) {
  const ids = [...new Set(productIds.filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return;
  await run(
    sequelize,
    t,
    `UPDATE products p
     SET p.stock_quantity = (SELECT COALESCE(SUM(pi.stock_level), 0) FROM product_inventory pi WHERE pi.product_id = p.id AND pi.is_active = 1)
     WHERE p.id IN (:ids)`,
    { ids },
  );
}

/** The warehouse new stock goes to: the default, else the oldest active one; null when there is none. */
export async function defaultWarehouse(sequelize: any, t: any, companyId: number): Promise<{ id: number; name: string } | null> {
  const [w] = await select(
    sequelize,
    t,
    `SELECT id, name FROM warehouses WHERE company_id = :c AND is_active = 1 ORDER BY is_default DESC, id LIMIT 1`,
    { c: companyId },
  );
  return w ? { id: num(w.id), name: String(w.name) } : null;
}

/** The default warehouse, creating "Main warehouse" when the company has none yet. */
export async function ensureWarehouse(sequelize: any, t: any, companyId: number): Promise<{ id: number; name: string }> {
  const found = await defaultWarehouse(sequelize, t, companyId);
  if (found) return found;
  await run(
    sequelize,
    t,
    `INSERT INTO warehouses (company_id, name, is_default, is_active, created_at, updated_at) VALUES (:c, 'Main warehouse', 1, 1, NOW(), NOW())`,
    { c: companyId },
  );
  return (await defaultWarehouse(sequelize, t, companyId))!;
}

/**
 * History for a delivery challan that moved stock — call right after the
 * challan engine changed product_inventory, in the same transaction.
 * Dispatch: out of the source (and, for a transfer, into the destination).
 * Cancel: the reverse.
 */
export async function recordChallanStock(
  sequelize: any,
  t: any,
  args: {
    companyId: number;
    challanId: number;
    challanNo: string | null;
    userId: number | null;
    lines: { product_id: number; variant_id: number | null; quantity: number }[];
    fromId: number;
    toId: number | null;
    cancelled: boolean;
  },
) {
  const batch = newBatch();
  const type: MovementType = args.cancelled ? 'DISPATCH_CANCELLED' : 'DISPATCHED';
  const sign = args.cancelled ? 1 : -1;
  const entries: LedgerEntry[] = [];
  const base = {
    company_id: args.companyId,
    type,
    reference_type: 'challan',
    reference_id: args.challanId,
    reference_no: args.challanNo,
    batch_id: batch,
    created_by: args.userId,
  };
  for (const l of args.lines) {
    const qty = Math.round(Number(l.quantity));
    if (!qty) continue;
    entries.push({
      ...base,
      product_id: l.product_id,
      variant_id: l.variant_id,
      warehouse_id: args.fromId,
      quantity: sign * qty,
      balance_after: await levelOf(sequelize, t, l.product_id, args.fromId),
    });
    if (args.toId) {
      entries.push({
        ...base,
        product_id: l.product_id,
        variant_id: l.variant_id,
        warehouse_id: args.toId,
        quantity: -sign * qty,
        balance_after: await levelOf(sequelize, t, l.product_id, args.toId),
      });
    }
  }
  await record(sequelize, t, entries);
  await syncTotals(
    sequelize,
    t,
    args.lines.map((l) => l.product_id),
  );
}
