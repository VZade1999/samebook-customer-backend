import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import {
  changeLevel,
  heldPerVariant,
  type LedgerEntry,
  levelOf,
  lockRows,
  newBatch,
  record,
  syncTotals,
} from './stock-ledger';
import {
  COUNT_REASONS,
  MOVEMENT_TYPES,
  parseCount,
  parseLocation,
  parseMove,
  parseReceive,
  parseStockFilter,
  parseStockSort,
  shortages,
  stockStatus,
} from './stock.rules';

const num = (v: unknown) => Number(v) || 0;
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s || null;
};

export interface StockQuery {
  search?: string;
  warehouse?: string;
  category?: string;
  status?: string;
  sort?: string;
  page?: number | string;
  limit?: number | string;
}
export interface HistoryQuery {
  product?: string;
  warehouse?: string;
  type?: string;
  search?: string;
  days?: string;
  page?: number | string;
  limit?: number | string;
}

/**
 * Stock & warehouses: stock per product per warehouse, the history of every
 * change, and the three everyday actions — receive, move and count.
 */
@Injectable()
export class StockService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  private get sequelize() {
    return this.db.sequelize;
  }

  private q(sql: string, replacements: Record<string, unknown>, transaction?: any) {
    return this.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction }) as Promise<any[]>;
  }

  /** The company's active products among these ids, by id (throws if any is missing or archived). */
  private async productsOf(companyId: number, ids: number[], t: any) {
    const rows = await this.q(
      `SELECT id, name, unit, cost_price FROM products WHERE company_id = :c AND is_active = 1 AND id IN (:ids)`,
      { c: companyId, ids },
      t,
    );
    if (rows.length !== new Set(ids).size) throw new BadRequestException('Some of these products were not found (or are archived)');
    return new Map(rows.map((r) => [num(r.id), { name: String(r.name), unit: text(r.unit), cost: money(r.cost_price) }]));
  }

  /** An active warehouse of the company — where stock can go. */
  private async activeWarehouse(companyId: number, id: number, t: any) {
    const [w] = await this.q(`SELECT id, name FROM warehouses WHERE id = :id AND company_id = :c AND is_active = 1`, { id, c: companyId }, t);
    if (!w) throw new BadRequestException('That warehouse was not found (or is archived)');
    return { id: num(w.id), name: String(w.name) };
  }

  /**
   * A warehouse stock can come out of: one of the company's (even archived),
   * or an id with no warehouse left at all ("Unknown warehouse" — old stock
   * whose warehouse was deleted). Never another company's warehouse.
   */
  private async sourceWarehouse(companyId: number, id: number, t: any) {
    const [w] = await this.q(`SELECT id, name, company_id FROM warehouses WHERE id = :id`, { id }, t);
    if (w && num(w.company_id) !== companyId) throw new BadRequestException('That warehouse was not found');
    return { id, name: w ? String(w.name) : `Unknown warehouse #${id}` };
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Goods arrived: add stock to one warehouse. A cost on a line becomes that product's cost price. */
  async receive(companyId: number, userId: number | null, body: any) {
    const parsed = parseReceive(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const v = parsed.value;
    const t = await this.sequelize.transaction();
    try {
      const wh = await this.activeWarehouse(companyId, v.warehouse_id, t);
      await this.productsOf(companyId, v.lines.map((l) => l.product_id), t);
      await lockRows(this.sequelize, t, v.lines.map((l) => ({ product_id: l.product_id, warehouse_id: wh.id })));
      const batch = newBatch();
      const entries: LedgerEntry[] = [];
      for (const l of v.lines) {
        const after = await changeLevel(this.sequelize, t, l.product_id, wh.id, l.qty);
        entries.push({
          company_id: companyId,
          product_id: l.product_id,
          warehouse_id: wh.id,
          type: 'RECEIVED',
          quantity: l.qty,
          balance_after: after,
          unit_cost: l.unit_cost,
          reference_type: v.reference_no ? 'bill' : null,
          reference_no: v.reference_no,
          batch_id: batch,
          note: v.note,
          created_by: userId,
        });
        if (l.unit_cost !== null) {
          await this.sequelize.query(`UPDATE products SET cost_price = :cost, updated_at = NOW() WHERE id = :id AND company_id = :c`, {
            replacements: { cost: l.unit_cost, id: l.product_id, c: companyId },
            transaction: t,
          });
        }
      }
      await record(this.sequelize, t, entries);
      await syncTotals(this.sequelize, t, v.lines.map((l) => l.product_id));
      await t.commit();
      return { batch_id: batch, warehouse: wh.name, products: v.lines.length, units: v.lines.reduce((s, l) => s + l.qty, 0) };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /** Move stock between two of your warehouses. Refused if the source holds less. */
  async move(companyId: number, userId: number | null, body: any) {
    const parsed = parseMove(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const v = parsed.value;
    const t = await this.sequelize.transaction();
    try {
      const from = await this.sourceWarehouse(companyId, v.from_warehouse_id, t);
      const to = await this.activeWarehouse(companyId, v.to_warehouse_id, t);
      const names = await this.productsOf(companyId, v.lines.map((l) => l.product_id), t);
      await lockRows(
        this.sequelize,
        t,
        v.lines.flatMap((l) => [
          { product_id: l.product_id, warehouse_id: from.id },
          { product_id: l.product_id, warehouse_id: to.id },
        ]),
      );
      const check: { name: string; qty: number; have: number }[] = [];
      const perVariant: string[] = [];
      for (const l of v.lines) {
        if (await heldPerVariant(this.sequelize, t, l.product_id, from.id)) perVariant.push(names.get(l.product_id)!.name);
        check.push({ name: names.get(l.product_id)!.name, qty: l.qty, have: await levelOf(this.sequelize, t, l.product_id, from.id) });
      }
      if (perVariant.length) throw new BadRequestException(`Stock of ${perVariant.join(', ')} is kept per variant there — move it from its challan instead`);
      const short = shortages(check);
      if (short.length) throw new BadRequestException(`${from.name} doesn't have enough: ${short.join(', ')}`);
      const batch = newBatch();
      const entries: LedgerEntry[] = [];
      const base = { company_id: companyId, type: 'MOVED' as const, batch_id: batch, note: v.note, created_by: userId, reference_type: 'warehouse' };
      for (const l of v.lines) {
        const outAfter = await changeLevel(this.sequelize, t, l.product_id, from.id, -l.qty);
        const inAfter = await changeLevel(this.sequelize, t, l.product_id, to.id, l.qty);
        entries.push({ ...base, product_id: l.product_id, warehouse_id: from.id, quantity: -l.qty, balance_after: outAfter, reference_id: to.id });
        entries.push({ ...base, product_id: l.product_id, warehouse_id: to.id, quantity: l.qty, balance_after: inAfter, reference_id: from.id });
      }
      await record(this.sequelize, t, entries);
      await syncTotals(this.sequelize, t, v.lines.map((l) => l.product_id));
      await t.commit();
      return { batch_id: batch, from: from.name, to: to.name, products: v.lines.length, units: v.lines.reduce((s, l) => s + l.qty, 0) };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /** Set stock to what was counted on the shelf; the difference goes in the history with a reason. */
  async count(companyId: number, userId: number | null, body: any) {
    const parsed = parseCount(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const v = parsed.value;
    const t = await this.sequelize.transaction();
    try {
      const wh = await this.sourceWarehouse(companyId, v.warehouse_id, t);
      const names = await this.productsOf(companyId, v.lines.map((l) => l.product_id), t);
      await lockRows(this.sequelize, t, v.lines.map((l) => ({ product_id: l.product_id, warehouse_id: wh.id })));
      const batch = newBatch();
      const entries: LedgerEntry[] = [];
      let changed = 0;
      for (const l of v.lines) {
        if (await heldPerVariant(this.sequelize, t, l.product_id, wh.id)) {
          throw new BadRequestException(`Stock of ${names.get(l.product_id)!.name} is kept per variant there — it can't be counted as one figure`);
        }
        const before = await levelOf(this.sequelize, t, l.product_id, wh.id);
        const diff = l.counted - before;
        if (!diff) continue;
        const after = await changeLevel(this.sequelize, t, l.product_id, wh.id, diff);
        changed += 1;
        entries.push({
          company_id: companyId,
          product_id: l.product_id,
          warehouse_id: wh.id,
          type: 'COUNTED',
          quantity: diff,
          balance_after: after,
          reason: v.reason,
          batch_id: batch,
          note: v.note,
          created_by: userId,
        });
      }
      await record(this.sequelize, t, entries);
      await syncTotals(this.sequelize, t, v.lines.map((l) => l.product_id));
      await t.commit();
      return { batch_id: batch, warehouse: wh.name, counted: v.lines.length, changed };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /**
   * Keep a product in a warehouse (with its rack / shelf), or stop keeping it
   * there — only once its stock there is 0.
   */
  async setLocation(companyId: number, body: any) {
    const parsed = parseLocation(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const v = parsed.value;
    const t = await this.sequelize.transaction();
    try {
      await this.productsOf(companyId, [v.product_id], t);
      await lockRows(this.sequelize, t, [{ product_id: v.product_id, warehouse_id: v.warehouse_id }]);
      if (v.remove) {
        await this.sourceWarehouse(companyId, v.warehouse_id, t);
        const level = await levelOf(this.sequelize, t, v.product_id, v.warehouse_id);
        if (level !== 0) throw new BadRequestException(`It still has ${level} there — move or count it to 0 first`);
        await this.sequelize.query(
          `UPDATE product_inventory SET is_active = 0, updated_at = NOW() WHERE product_id = :p AND warehouse_id = :w AND is_active = 1`,
          { replacements: { p: v.product_id, w: v.warehouse_id }, transaction: t },
        );
      } else {
        await this.activeWarehouse(companyId, v.warehouse_id, t);
        await changeLevel(this.sequelize, t, v.product_id, v.warehouse_id, 0, v.bin_location);
      }
      await syncTotals(this.sequelize, t, [v.product_id]);
      await t.commit();
      return { ok: true };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** Warehouse names by id (archived ones too), for labels. */
  private async warehouseNames(companyId: number) {
    const rows = await this.q(
      `SELECT id, name, is_active, is_default, address, city, state, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
       FROM warehouses WHERE company_id = :c ORDER BY is_default DESC, name`,
      { c: companyId },
    );
    return rows.map((w) => ({
      id: num(w.id),
      name: String(w.name),
      active: num(w.is_active) === 1,
      is_default: num(w.is_default) === 1,
      address: text(w.address),
      city: text(w.city),
      state: text(w.state),
      created_at: w.created_at,
    }));
  }

  /** Stock rows of the company's active products, summed per (product, warehouse). */
  private stockRows(companyId: number) {
    return this.q(
      `SELECT pi.product_id, pi.warehouse_id, COALESCE(SUM(pi.stock_level), 0) AS qty, MAX(pi.bin_location) AS bin
       FROM product_inventory pi JOIN products p ON p.id = pi.product_id
       WHERE p.company_id = :c AND p.is_active = 1 AND pi.is_active = 1 AND pi.warehouse_id IS NOT NULL
       GROUP BY pi.product_id, pi.warehouse_id`,
      { c: companyId },
    );
  }

  /** The stock table: every tracked product, its stock in each warehouse, value and status. */
  async levels(companyId: number, query: StockQuery) {
    const [products, rows, whs] = await Promise.all([
      this.q(
        `SELECT p.id, p.name, p.unit, p.product_code, p.cost_price, p.minimum_stock, p.category_id, c.name AS category
         FROM products p LEFT JOIN product_categories c ON c.id = p.category_id AND c.company_id = p.company_id
         WHERE p.company_id = :c AND p.is_active = 1`,
        { c: companyId },
      ),
      this.stockRows(companyId),
      this.warehouseNames(companyId),
    ]);
    const places = new Map<number, { warehouse_id: number; qty: number; bin: string | null }[]>();
    rows.forEach((r) => {
      const list = places.get(num(r.product_id)) || [];
      list.push({ warehouse_id: num(r.warehouse_id), qty: num(r.qty), bin: text(r.bin) });
      places.set(num(r.product_id), list);
    });
    const all = products
      .map((p) => {
        const id = num(p.id);
        const at = places.get(id) || [];
        const total = at.reduce((s, x) => s + x.qty, 0);
        const min = num(p.minimum_stock);
        const tracked = at.length > 0 || min > 0;
        const cost = money(p.cost_price);
        return {
          id,
          name: String(p.name),
          unit: text(p.unit),
          hsn: text(p.product_code),
          category_id: p.category_id ? num(p.category_id) : null,
          category: text(p.category),
          min,
          cost,
          total,
          value: cost > 0 && total > 0 ? money(total * cost) : 0,
          status: stockStatus(total, min, tracked),
          places: at,
        };
      })
      .filter((r) => r.status !== 'untracked');

    const filter = parseStockFilter(query.status);
    const wh = String(query.warehouse || '').trim();
    const cat = String(query.category || '').trim();
    const words = String(query.search || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const matched = all.filter(
      (r) =>
        (filter === 'all' ||
          (filter === 'in' && r.total > 0) ||
          (filter === 'low' && r.status === 'low') ||
          (filter === 'out' && r.status === 'out')) &&
        (!wh || r.places.some((p) => String(p.warehouse_id) === wh)) &&
        (!cat || (cat === 'none' ? !r.category_id : String(r.category_id) === cat)) &&
        (!words.length || words.every((w) => [r.name, r.hsn, r.category, ...r.places.map((p) => p.bin)].filter(Boolean).join(' ').toLowerCase().includes(w))),
    );
    const sort = parseStockSort(query.sort);
    const byName = (a: any, b: any) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
    matched.sort((a, b) =>
      sort === 'stock_high' ? b.total - a.total || byName(a, b) : sort === 'stock_low' ? a.total - b.total || byName(a, b) : sort === 'value' ? b.value - a.value || byName(a, b) : byName(a, b),
    );
    const limit = Math.max(1, Math.min(num(query.limit) || 25, 100));
    const pages = Math.max(1, Math.ceil(matched.length / limit));
    const page = Math.min(Math.max(1, num(query.page) || 1), pages);

    // Warehouses that appear: real ones (active) plus any id holding stock with no warehouse left.
    const known = new Set(whs.map((w) => w.id));
    const orphans = [...new Set(rows.map((r) => num(r.warehouse_id)).filter((id) => !known.has(id)))];
    const columns = [
      ...whs.filter((w) => w.active || rows.some((r) => num(r.warehouse_id) === w.id && num(r.qty) !== 0)).map((w) => ({ id: w.id, name: w.name, is_default: w.is_default, active: w.active })),
      ...orphans.map((id) => ({ id, name: `Unknown warehouse #${id}`, is_default: false, active: false })),
    ];
    const [counts] = await this.q(`SELECT COUNT(*) AS n FROM products WHERE company_id = :c AND is_active = 1`, { c: companyId });
    return {
      warehouses: columns,
      products: matched.slice((page - 1) * limit, page * limit),
      pagination: { total: matched.length, page, limit, pages },
      stats: {
        tracked: all.length,
        untracked: num(counts?.n) - all.length,
        units: all.reduce((s, r) => s + Math.max(0, r.total), 0),
        value: money(all.reduce((s, r) => s + r.value, 0)),
        priced: all.filter((r) => r.cost > 0).length,
        in_stock: all.filter((r) => r.total > 0).length,
        low: all.filter((r) => r.status === 'low').length,
        out: all.filter((r) => r.status === 'out').length,
      },
    };
  }

  /** Warehouse cards: address, default, products, units, value, alerts and last change. */
  async warehouses(companyId: number) {
    const [whs, rows, products, last] = await Promise.all([
      this.warehouseNames(companyId),
      this.stockRows(companyId),
      this.q(`SELECT id, cost_price, minimum_stock, stock_quantity FROM products WHERE company_id = :c AND is_active = 1`, { c: companyId }),
      this.q(
        `SELECT warehouse_id, DATE_FORMAT(MAX(created_at), '%Y-%m-%dT%H:%i:%s') AS last, SUM(created_at >= NOW() - INTERVAL 30 DAY) AS recent
         FROM stock_movements WHERE company_id = :c GROUP BY warehouse_id`,
        { c: companyId },
      ),
    ]);
    const prod = new Map(products.map((p) => [num(p.id), { cost: money(p.cost_price), min: num(p.minimum_stock), total: num(p.stock_quantity) }]));
    const lastOf = new Map(last.map((l) => [num(l.warehouse_id), { last: l.last, recent: num(l.recent) }]));
    const known = new Set(whs.map((w) => w.id));
    const ids = [...whs.filter((w) => w.active).map((w) => w.id), ...[...new Set(rows.map((r) => num(r.warehouse_id)))].filter((id) => !known.has(id) || !whs.find((w) => w.id === id)?.active)];
    const cards = [...new Set(ids)].map((id) => {
      const w = whs.find((x) => x.id === id);
      const here = rows.filter((r) => num(r.warehouse_id) === id);
      const units = here.reduce((s, r) => s + Math.max(0, num(r.qty)), 0);
      const value = here.reduce((s, r) => s + Math.max(0, num(r.qty)) * (prod.get(num(r.product_id))?.cost || 0), 0);
      const alerts = here.filter((r) => {
        const p = prod.get(num(r.product_id));
        return p && p.min > 0 && p.total <= p.min;
      }).length;
      return {
        id,
        name: w ? w.name : `Unknown warehouse #${id}`,
        known: !!w,
        active: w ? w.active : false,
        is_default: w ? w.is_default : false,
        address: w?.address ?? null,
        city: w?.city ?? null,
        state: w?.state ?? null,
        created_at: w?.created_at ?? null,
        products: here.length,
        stocked: here.filter((r) => num(r.qty) > 0).length,
        units,
        value: money(value),
        alerts,
        last_change: lastOf.get(id)?.last ?? null,
        changes_30d: lastOf.get(id)?.recent ?? 0,
      };
    });
    return {
      warehouses: cards.filter((c) => c.active),
      elsewhere: cards.filter((c) => !c.active && c.units !== 0),
      archived: whs.filter((w) => !w.active).map((w) => ({ id: w.id, name: w.name })),
    };
  }

  /** The stock history, newest first, with filters. */
  async history(companyId: number, query: HistoryQuery) {
    const where: string[] = ['m.company_id = :c'];
    const r: Record<string, unknown> = { c: companyId };
    const product = Number(query.product);
    if (Number.isInteger(product) && product > 0) {
      where.push('m.product_id = :p');
      r.p = product;
    }
    const warehouse = Number(query.warehouse);
    if (Number.isInteger(warehouse) && warehouse > 0) {
      where.push('m.warehouse_id = :w');
      r.w = warehouse;
    }
    if ((MOVEMENT_TYPES as readonly string[]).includes(String(query.type))) {
      where.push('m.type = :t');
      r.t = String(query.type);
    }
    const days = Number(query.days);
    if (Number.isInteger(days) && days > 0 && days <= 3650) {
      where.push('m.created_at >= NOW() - INTERVAL :d DAY');
      r.d = days;
    }
    // Every word typed must appear in the product name, bill no. or note (like the other searches).
    String(query.search || '')
      .trim()
      .slice(0, 80)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .forEach((word, i) => {
        where.push(`(p.name LIKE :s${i} OR m.reference_no LIKE :s${i} OR m.note LIKE :s${i})`);
        r[`s${i}`] = `%${word.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      });
    const limit = Math.max(1, Math.min(num(query.limit) || 30, 100));
    const page = Math.max(1, num(query.page) || 1);
    const sqlWhere = where.join(' AND ');
    const [[count], rows] = await Promise.all([
      this.q(`SELECT COUNT(*) AS n FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE ${sqlWhere}`, r),
      this.q(
        `SELECT m.id, m.type, m.quantity, m.balance_after, m.unit_cost, m.reason, m.reference_type, m.reference_id, m.reference_no,
                m.batch_id, m.note, DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s') AS at,
                m.product_id, p.name AS product, p.unit, m.warehouse_id, w.name AS warehouse,
                w2.name AS other_warehouse, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS by_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN warehouses w2 ON m.reference_type = 'warehouse' AND w2.id = m.reference_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE ${sqlWhere}
         ORDER BY m.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        r,
      ),
    ]);
    const total = num(count?.n);
    return {
      movements: rows.map((m) => ({
        id: num(m.id),
        type: m.type,
        quantity: num(m.quantity),
        balance_after: num(m.balance_after),
        unit_cost: m.unit_cost !== null ? money(m.unit_cost) : null,
        reason: m.reason,
        reference: m.reference_type ? { type: m.reference_type, id: m.reference_id ? num(m.reference_id) : null, no: text(m.reference_no) } : null,
        batch_id: m.batch_id,
        note: text(m.note),
        at: m.at,
        product: { id: num(m.product_id), name: String(m.product), unit: text(m.unit) },
        warehouse: m.warehouse_id ? { id: num(m.warehouse_id), name: text(m.warehouse) || `Unknown warehouse #${num(m.warehouse_id)}` } : null,
        other_warehouse: text(m.other_warehouse),
        by: text(m.by_name),
      })),
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
      types: MOVEMENT_TYPES,
      reasons: COUNT_REASONS,
    };
  }
}
