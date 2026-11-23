import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
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

/** Same "live invoice" rule as the Dashboard. */
const LIVE_INVOICE = `i.status NOT IN ('CANCELLED', 'SUPERSEDED')`;
const LIVE_QUOTATION = `COALESCE(qt.status, '') <> 'DELETED'`;
const LIVE_CHALLAN = `COALESCE(d.status, '') <> 'CANCELLED' AND COALESCE(d.is_active, 1) = 1`;
/** What the customer was actually quoted per unit, after the line's discount. */
const NET_RATE = `COALESCE(NULLIF(qi.discounted_rate, 0), qi.rate)`;
const num = (v: unknown) => Number(v) || 0;
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const qty = (v: unknown) => Math.round(num(v) * 1000) / 1000;
const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s || null;
};

export interface CatalogQuery {
  search?: string;
  filter?: string;
  unit?: string;
  category?: string;
  warehouse?: string;
  id?: string;
  sort?: string;
  page?: number | string;
  limit?: number | string;
  all?: string;
}

/** What the caller may see, from their permissions (the same gates as the Dashboard). */
const accessOf = (permissions: string[]) => ({
  invoices: permissions.includes('invoices.view'),
  money: permissions.includes('invoices.view') && permissions.includes('invoices.insides'),
  quotations: permissions.includes('quotations.view'),
  challans: permissions.includes('challans.view'),
});

/**
 * The Products page: every product with how it sells (quotations, invoices,
 * challans), the tile counts, a product's activity, and bulk price / archive.
 * Documents link to a product by its name (quotation and invoice lines carry
 * no product id), and by product id where a challan line has one.
 * Billing data is read live (never cached).
 */
@Injectable()
export class ProductCatalogService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  private q(sql: string, replacements: Record<string, unknown>, transaction?: any) {
    return this.db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction }) as Promise<any[]>;
  }

  private exec(sql: string, replacements: Record<string, unknown>, transaction?: any) {
    return this.db.sequelize.query(sql, { replacements, transaction });
  }

  /** Every product of the company (active and archived) with its usage. */
  private async rows(companyId: number, permissions: string[]): Promise<CatalogRow[]> {
    const can = accessOf(permissions);
    const r = { c: companyId };
    const [products, quoted, invoiced, dispatched, stocked] = await Promise.all([
      this.q(
        `SELECT p.id, p.name, p.product_code, p.unit, p.price, p.cost_price, p.tax_percentage, p.sku, p.barcode,
                p.category_id, c.name AS category, p.stock_quantity, p.minimum_stock, LEFT(p.description, 240) AS description,
                p.image_url, p.is_active,
                DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
                DATE_FORMAT(p.updated_at, '%Y-%m-%dT%H:%i:%s') AS updated_at
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id AND c.company_id = p.company_id
         WHERE p.company_id = :c`,
        r,
      ),
      can.quotations
        ? this.q(
            `SELECT k, COUNT(DISTINCT quotation_id) AS n, COUNT(DISTINCT customer_id) AS customers, COALESCE(SUM(qty), 0) AS qty,
                    DATE_FORMAT(MAX(d), '%Y-%m-%d') AS last, MAX(CASE WHEN rn = 1 THEN rate END) AS last_rate
             FROM (
               SELECT LOWER(TRIM(qi.product_name)) AS k, qi.quotation_id, qt.customer_id, qi.qty, ${NET_RATE} AS rate,
                      COALESCE(qt.quotation_date, qt.created_at) AS d,
                      ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(qi.product_name))
                                         ORDER BY COALESCE(qt.quotation_date, qt.created_at) DESC, qi.id DESC) AS rn
               FROM quotation_items qi JOIN quotations qt ON qt.id = qi.quotation_id
               WHERE qt.company_id = :c AND ${LIVE_QUOTATION} AND TRIM(COALESCE(qi.product_name, '')) <> ''
             ) x
             GROUP BY k`,
            r,
          )
        : Promise.resolve([]),
      can.invoices
        ? this.q(
            `SELECT LOWER(TRIM(ii.product_name)) AS k, COUNT(DISTINCT ii.invoice_id) AS n, COALESCE(SUM(ii.qty), 0) AS qty,
                    COALESCE(SUM(ii.total), 0) AS amount, DATE_FORMAT(MAX(i.invoice_date), '%Y-%m-%d') AS last
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
             WHERE i.company_id = :c AND ${LIVE_INVOICE} AND TRIM(COALESCE(ii.product_name, '')) <> ''
             GROUP BY k`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT CASE WHEN di.product_id IS NOT NULL THEN CONCAT('#', di.product_id)
                         ELSE CONCAT('n:', LOWER(TRIM(di.item_name))) END AS k,
                    COUNT(DISTINCT di.delivery_challan_id) AS n, COALESCE(SUM(di.quantity), 0) AS qty,
                    DATE_FORMAT(MAX(d.challan_date), '%Y-%m-%d') AS last
             FROM delivery_challan_items di JOIN delivery_challans d ON d.id = di.delivery_challan_id
             WHERE d.company_id = :c AND ${LIVE_CHALLAN}
             GROUP BY k`,
            r,
          )
        : Promise.resolve([]),
      // Where each product is kept: its stock per warehouse.
      this.q(
        `SELECT pi.product_id, pi.warehouse_id, COALESCE(SUM(pi.stock_level), 0) AS qty, MAX(pi.bin_location) AS bin, MAX(w.name) AS name
         FROM product_inventory pi
         JOIN products p ON p.id = pi.product_id
         LEFT JOIN warehouses w ON w.id = pi.warehouse_id
         WHERE p.company_id = :c AND pi.is_active = 1 AND pi.warehouse_id IS NOT NULL
         GROUP BY pi.product_id, pi.warehouse_id`,
        r,
      ),
    ]);

    const placesOf = new Map<number, CatalogRow['places']>();
    stocked.forEach((s) => {
      const list = placesOf.get(num(s.product_id)) || [];
      list.push({ warehouse_id: num(s.warehouse_id), name: text(s.name) || `Unknown warehouse #${num(s.warehouse_id)}`, qty: num(s.qty), bin: text(s.bin) });
      placesOf.set(num(s.product_id), list);
    });
    const byKey = <T extends { k: unknown }>(list: T[]) => new Map(list.map((x) => [nameKey(x.k), x]));
    const quo = byKey(quoted);
    const inv = byKey(invoiced);
    const dc = new Map<string, any>(dispatched.map((x) => [String(x.k ?? ''), x]));
    const later = (a: string | null, b: string | null) => (String(a || '') > String(b || '') ? a : b) || null;

    return markDuplicates(
      products.map((p) => {
        const id = num(p.id);
        const key = nameKey(p.name);
        const qv: any = quo.get(key);
        const iv: any = inv.get(key);
        const byId: any = dc.get(`#${id}`);
        const byName: any = dc.get(`n:${key}`);
        return {
          id,
          name: text(p.name) || 'Unnamed product',
          hsn: text(p.product_code),
          unit: text(p.unit),
          price: money(p.price),
          gst: num(p.tax_percentage),
          cost: money(p.cost_price),
          sku: text(p.sku),
          barcode: text(p.barcode),
          category_id: p.category_id ? num(p.category_id) : null,
          category: text(p.category),
          stock: num(p.stock_quantity),
          min_stock: num(p.minimum_stock),
          description: text(p.description),
          image_url: text(p.image_url),
          active: num(p.is_active) === 1,
          created_at: p.created_at ?? null,
          updated_at: p.updated_at ?? null,
          quoted: num(qv?.n),
          quoted_qty: qty(qv?.qty),
          customers: num(qv?.customers),
          last_quoted: qv?.last ?? null,
          last_rate: qv?.last_rate != null ? money(qv.last_rate) : null,
          invoiced: num(iv?.n),
          sold_qty: qty(iv?.qty),
          billed: can.money ? money(iv?.amount) : 0,
          last_invoiced: iv?.last ?? null,
          challans: num(byId?.n) + num(byName?.n),
          dispatched_qty: qty(num(byId?.qty) + num(byName?.qty)),
          last_dispatched: later(byId?.last ?? null, byName?.last ?? null),
          duplicate: false,
          places: placesOf.get(id) || [],
        } as CatalogRow;
      }),
    );
  }

  async catalog(companyId: number, permissions: string[], query: CatalogQuery) {
    const can = accessOf(permissions);
    const now = new Date();
    const all = await this.rows(companyId, permissions);
    const filter = parseFilter(query.filter);
    const unit = String(query.unit || '').trim().toUpperCase();
    const category = String(query.category || '').trim();
    const warehouse = String(query.warehouse || '').trim();
    // One product by id (a link to its profile), active or archived.
    const only = Number(query.id);
    if (Number.isInteger(only) && only > 0) {
      const hit = all.filter((r) => r.id === only);
      return { products: hit, pagination: { total: hit.length, page: 1, limit: 1, pages: 1 }, stats: catalogStats(all, now), access: can };
    }
    const matched = sortRows(
      all.filter(
        (r) =>
          filterHit(r, filter, now) &&
          (!unit || String(r.unit || '').trim().toUpperCase() === unit) &&
          (!category || (category === 'none' ? !r.category_id : String(r.category_id) === category)) &&
          (!warehouse || (warehouse === 'none' ? !r.places.length : r.places.some((p) => String(p.warehouse_id) === warehouse))) &&
          searchHit(r, String(query.search || '').slice(0, 100)),
      ),
      parseSort(query.sort),
    );
    const everything = String(query.all || '') === '1';
    const limit = everything ? Math.max(1, matched.length) : Math.max(1, Math.min(num(query.limit) || 20, 100));
    const pages = Math.max(1, Math.ceil(matched.length / limit));
    const page = everything ? 1 : Math.min(Math.max(1, num(query.page) || 1), pages);
    return {
      products: matched.slice((page - 1) * limit, page * limit),
      pagination: { total: matched.length, page, limit, pages },
      stats: catalogStats(all, now),
      access: can,
    };
  }

  /** A product's rates, buyers and recent quotations, challans and invoices. */
  async activity(companyId: number, productId: number, permissions: string[]) {
    const can = accessOf(permissions);
    const [p] = await this.q(`SELECT id, name FROM products WHERE id = :id AND company_id = :c`, { id: productId, c: companyId });
    if (!p) throw new NotFoundException('Product not found');
    const r = { c: companyId, id: productId, k: nameKey(p.name) };
    const QL = `LOWER(TRIM(qi.product_name)) = :k`;
    const DL = `(di.product_id = :id OR (di.product_id IS NULL AND LOWER(TRIM(di.item_name)) = :k))`;

    const [qSum, qRecent, qBuyers, iSum, iRecent, dSum, dRecent, variants, images, stock, moves] = await Promise.all([
      can.quotations
        ? this.q(
            `SELECT COUNT(DISTINCT qi.quotation_id) AS n, COUNT(DISTINCT qt.customer_id) AS customers, COALESCE(SUM(qi.qty), 0) AS qty,
                    MIN(NULLIF(${NET_RATE}, 0)) AS low, MAX(${NET_RATE}) AS high, AVG(NULLIF(${NET_RATE}, 0)) AS avg,
                    AVG(NULLIF(qi.discount_percent, 0)) AS discount, COALESCE(SUM(qi.discount_percent > 0), 0) AS discounted,
                    DATE_FORMAT(MIN(COALESCE(qt.quotation_date, qt.created_at)), '%Y-%m-%d') AS first,
                    DATE_FORMAT(MAX(COALESCE(qt.quotation_date, qt.created_at)), '%Y-%m-%d') AS last
             FROM quotation_items qi JOIN quotations qt ON qt.id = qi.quotation_id
             WHERE qt.company_id = :c AND ${LIVE_QUOTATION} AND ${QL}`,
            r,
          )
        : Promise.resolve([]),
      can.quotations
        ? this.q(
            `SELECT qt.id, qt.quotation_number AS number, DATE_FORMAT(COALESCE(qt.quotation_date, qt.created_at), '%Y-%m-%d') AS date,
                    qt.status, COALESCE(qt.has_invoice, 0) AS has_invoice, cu.display_name AS customer,
                    qi.qty, qi.unit, qi.rate, qi.discount_percent, qi.discounted_rate
             FROM quotation_items qi JOIN quotations qt ON qt.id = qi.quotation_id
             LEFT JOIN customers cu ON cu.id = qt.customer_id
             WHERE qt.company_id = :c AND ${LIVE_QUOTATION} AND ${QL}
             ORDER BY COALESCE(qt.quotation_date, qt.created_at) DESC, qi.id DESC LIMIT 8`,
            r,
          )
        : Promise.resolve([]),
      can.quotations
        ? this.q(
            `SELECT qt.customer_id AS id, MAX(cu.display_name) AS name, COUNT(DISTINCT qt.id) AS n, COALESCE(SUM(qi.qty), 0) AS qty,
                    DATE_FORMAT(MAX(COALESCE(qt.quotation_date, qt.created_at)), '%Y-%m-%d') AS last
             FROM quotation_items qi JOIN quotations qt ON qt.id = qi.quotation_id
             LEFT JOIN customers cu ON cu.id = qt.customer_id
             WHERE qt.company_id = :c AND ${LIVE_QUOTATION} AND ${QL} AND qt.customer_id IS NOT NULL
             GROUP BY qt.customer_id ORDER BY n DESC, last DESC LIMIT 5`,
            r,
          )
        : Promise.resolve([]),
      can.invoices
        ? this.q(
            `SELECT COUNT(DISTINCT ii.invoice_id) AS n, COALESCE(SUM(ii.qty), 0) AS qty, COALESCE(SUM(ii.total), 0) AS amount,
                    DATE_FORMAT(MAX(i.invoice_date), '%Y-%m-%d') AS last
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
             WHERE i.company_id = :c AND ${LIVE_INVOICE} AND LOWER(TRIM(ii.product_name)) = :k`,
            r,
          )
        : Promise.resolve([]),
      can.invoices
        ? this.q(
            `SELECT i.id, i.invoice_number AS number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date, i.status,
                    cu.display_name AS customer, ii.qty, ii.unit, ii.rate
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
             LEFT JOIN customers cu ON cu.id = i.customer_id
             WHERE i.company_id = :c AND LOWER(TRIM(ii.product_name)) = :k
             ORDER BY i.invoice_date DESC, ii.id DESC LIMIT 6`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT COUNT(DISTINCT di.delivery_challan_id) AS n, COALESCE(SUM(di.quantity), 0) AS qty
             FROM delivery_challan_items di JOIN delivery_challans d ON d.id = di.delivery_challan_id
             WHERE d.company_id = :c AND ${LIVE_CHALLAN} AND ${DL}`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT d.id, d.challan_number AS number, DATE_FORMAT(d.challan_date, '%Y-%m-%d') AS date, d.status,
                    cu.display_name AS customer, di.quantity AS qty, di.unit
             FROM delivery_challan_items di JOIN delivery_challans d ON d.id = di.delivery_challan_id
             LEFT JOIN customers cu ON cu.id = d.customer_id
             WHERE d.company_id = :c AND COALESCE(d.is_active, 1) = 1 AND ${DL}
             ORDER BY d.challan_date DESC, di.id DESC LIMIT 6`,
            r,
          )
        : Promise.resolve([]),
      this.q(
        `SELECT id, sku, attributes, price, compare_at_price, cost_price, is_default FROM product_variants
         WHERE product_id = :id AND is_active = 1 ORDER BY is_default DESC, id`,
        r,
      ),
      this.q(`SELECT id, url FROM product_images WHERE product_id = :id AND is_active = 1 ORDER BY sort_order, id LIMIT 12`, r),
      // Stock in each warehouse (rows held per variant are added in).
      this.q(
        `SELECT pi.warehouse_id, COALESCE(SUM(pi.stock_level), 0) AS qty, MAX(pi.bin_location) AS bin,
                MAX(w.name) AS name, MAX(w.is_default) AS is_default, MAX(w.is_active) AS w_active, MAX(w.id IS NOT NULL) AS known
         FROM product_inventory pi LEFT JOIN warehouses w ON w.id = pi.warehouse_id AND w.company_id = :c
         WHERE pi.product_id = :id AND pi.is_active = 1 AND pi.warehouse_id IS NOT NULL
         GROUP BY pi.warehouse_id ORDER BY qty DESC, name`,
        r,
      ),
      // Its latest stock changes.
      this.q(
        `SELECT m.id, m.type, m.quantity, m.balance_after, m.reason, m.reference_type, m.reference_id, m.reference_no, m.note,
                DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s') AS at, m.warehouse_id, w.name AS warehouse, w2.name AS other,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS by_name
         FROM stock_movements m
         LEFT JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN warehouses w2 ON m.reference_type = 'warehouse' AND w2.id = m.reference_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.company_id = :c AND m.product_id = :id
         ORDER BY m.id DESC LIMIT 8`,
        r,
      ),
    ]);

    const qs = qSum[0] || {};
    const is = iSum[0] || {};
    const ds = dSum[0] || {};
    const json = (v: unknown) => {
      if (v == null || typeof v === 'object') return v ?? null;
      try {
        return JSON.parse(String(v));
      } catch {
        return v;
      }
    };
    return {
      access: can,
      quotations: can.quotations
        ? {
            count: num(qs.n),
            customers: num(qs.customers),
            qty: qty(qs.qty),
            // Net of each line's discount: what customers were actually offered.
            rates: {
              low: qs.low != null ? money(qs.low) : null,
              high: qs.high != null ? money(qs.high) : null,
              avg: qs.avg != null ? money(qs.avg) : null,
              last: qRecent[0] ? (num(qRecent[0].discounted_rate) > 0 ? money(qRecent[0].discounted_rate) : money(qRecent[0].rate)) : null,
              discount: qs.discount != null ? Math.round(num(qs.discount) * 10) / 10 : null,
              discounted: num(qs.discounted),
            },
            first: qs.first ?? null,
            last: qs.last ?? null,
            buyers: qBuyers.map((b) => ({ id: num(b.id), name: text(b.name) || 'Customer', count: num(b.n), qty: qty(b.qty), last: b.last })),
            recent: qRecent.map((x) => ({
              id: num(x.id),
              number: x.number,
              date: x.date,
              status: x.status || 'DRAFT',
              invoiced: num(x.has_invoice) === 1,
              customer: text(x.customer),
              qty: qty(x.qty),
              unit: text(x.unit),
              rate: money(x.rate),
              discount: num(x.discount_percent),
              net_rate: num(x.discounted_rate) > 0 ? money(x.discounted_rate) : money(x.rate),
            })),
          }
        : null,
      invoices: can.invoices
        ? {
            count: num(is.n),
            qty: qty(is.qty),
            amount: can.money ? money(is.amount) : null,
            last: is.last ?? null,
            recent: iRecent.map((x) => ({
              id: num(x.id),
              number: x.number,
              date: x.date,
              status: x.status,
              customer: text(x.customer),
              qty: qty(x.qty),
              unit: text(x.unit),
              rate: money(x.rate),
            })),
          }
        : null,
      challans: can.challans
        ? {
            count: num(ds.n),
            qty: qty(ds.qty),
            recent: dRecent.map((x) => ({
              id: num(x.id),
              number: x.number,
              date: x.date,
              status: x.status,
              customer: text(x.customer),
              qty: qty(x.qty),
              unit: text(x.unit),
            })),
          }
        : null,
      variants: variants.map((v) => ({
        id: num(v.id),
        sku: text(v.sku),
        attributes: json(v.attributes),
        price: money(v.price),
        compare_at_price: money(v.compare_at_price),
        cost_price: money(v.cost_price),
        is_default: num(v.is_default) === 1,
      })),
      images: images.map((x) => ({ id: num(x.id), url: String(x.url || '') })).filter((x) => x.url),
      stock: stock.map((x) => ({
        warehouse_id: num(x.warehouse_id),
        name: text(x.name) || `Unknown warehouse #${num(x.warehouse_id)}`,
        known: num(x.known) === 1,
        active: num(x.w_active) === 1,
        is_default: num(x.is_default) === 1,
        qty: num(x.qty),
        bin: text(x.bin),
      })),
      history: moves.map((m) => ({
        id: num(m.id),
        type: String(m.type),
        quantity: num(m.quantity),
        balance_after: num(m.balance_after),
        reason: text(m.reason),
        reference: m.reference_type ? { type: String(m.reference_type), id: m.reference_id ? num(m.reference_id) : null, no: text(m.reference_no) } : null,
        note: text(m.note),
        at: m.at,
        warehouse: m.warehouse_id ? text(m.warehouse) || `Unknown warehouse #${num(m.warehouse_id)}` : null,
        other_warehouse: text(m.other),
        by: text(m.by_name),
      })),
    };
  }

  /** Put many products in one category (or none). */
  async bulkCategory(companyId: number, body: any) {
    const parsed = parseBulkCategory(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    let name: string | null = null;
    if (parsed.category_id) {
      const [c] = await this.q(`SELECT id, name FROM product_categories WHERE id = :id AND company_id = :c AND is_active = 1`, {
        id: parsed.category_id,
        c: companyId,
      });
      if (!c) throw new BadRequestException('That category was not found');
      name = String(c.name);
    }
    const [res]: any = await this.exec(
      `UPDATE products SET category_id = :cat, updated_at = NOW() WHERE company_id = :c AND is_active = 1 AND id IN (:ids)`,
      { cat: parsed.category_id, c: companyId, ids: parsed.ids },
    );
    const n = Number(res?.affectedRows ?? res) || 0;
    return { updated: n, category: name };
  }

  /** Raise, cut or set the price of many products in one step. */
  async bulkPrice(companyId: number, body: any) {
    const parsed = parsePriceChange(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const { change, ids } = parsed;
    const t = await this.db.sequelize.transaction();
    try {
      const found = await this.q(
        `SELECT id, name, price FROM products WHERE company_id = :c AND is_active = 1 AND id IN (:ids) FOR UPDATE`,
        { c: companyId, ids },
        t,
      );
      const changed = found
        .map((p) => ({ id: num(p.id), name: String(p.name), old: money(p.price), price: newPrice(money(p.price), change) }))
        .filter((p) => p.price !== p.old);
      if (changed.length) {
        const cases = changed.map((p, i) => `WHEN :id${i} THEN :p${i}`).join(' ');
        const reps: Record<string, unknown> = { c: companyId, ids: changed.map((p) => p.id) };
        changed.forEach((p, i) => {
          reps[`id${i}`] = p.id;
          reps[`p${i}`] = p.price;
        });
        await this.exec(
          `UPDATE products SET price = CASE id ${cases} END, updated_at = NOW() WHERE company_id = :c AND id IN (:ids)`,
          reps,
          t,
        );
      }
      await t.commit();
      return { updated: changed.length, unchanged: found.length - changed.length, missing: ids.length - found.length, products: changed };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /** Archive many products: they leave the pickers but can be restored. */
  async bulkArchive(companyId: number, body: any) {
    const parsed = parseIds(body);
    if ('error' in parsed) throw new BadRequestException(parsed.error);
    const t = await this.db.sequelize.transaction();
    try {
      const found = await this.q(
        `SELECT id FROM products WHERE company_id = :c AND is_active = 1 AND id IN (:ids) FOR UPDATE`,
        { c: companyId, ids: parsed.ids },
        t,
      );
      const ids = found.map((p) => num(p.id));
      if (ids.length) {
        await this.exec(`UPDATE products SET is_active = 0, updated_at = NOW() WHERE company_id = :c AND id IN (:ids)`, { c: companyId, ids }, t);
        for (const table of ['product_variants', 'product_images', 'product_inventory', 'product_metadata']) {
          await this.exec(`UPDATE ${table} SET is_active = 0, updated_at = NOW() WHERE is_active = 1 AND product_id IN (:ids)`, { ids }, t);
        }
      }
      await t.commit();
      return { archived: ids.length, ids };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /**
   * Bring an archived product back. Refused when an active product already
   * uses the name, because quotations find products by name.
   */
  async restore(companyId: number, productId: number) {
    const [p] = await this.q(
      `SELECT id, name, is_active, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS at FROM products WHERE id = :id AND company_id = :c`,
      { id: productId, c: companyId },
    );
    if (!p) throw new NotFoundException('Product not found');
    if (num(p.is_active) === 1) return { restored: false, id: productId };
    const [clash] = await this.q(
      `SELECT id FROM products WHERE company_id = :c AND is_active = 1 AND id <> :id AND LOWER(TRIM(name)) = :k LIMIT 1`,
      { c: companyId, id: productId, k: nameKey(p.name) },
    );
    if (clash) throw new BadRequestException(`"${String(p.name).trim()}" is already in your products — edit that one instead`);
    const t = await this.db.sequelize.transaction();
    try {
      await this.exec(`UPDATE products SET is_active = 1, updated_at = NOW() WHERE id = :id AND company_id = :c`, { id: productId, c: companyId }, t);
      // Bring back the variants, images and stock rows archived together with it.
      for (const table of ['product_variants', 'product_images', 'product_inventory', 'product_metadata']) {
        await this.exec(
          `UPDATE ${table} SET is_active = 1, updated_at = NOW()
           WHERE product_id = :id AND is_active = 0
             AND updated_at BETWEEN CAST(:at AS DATETIME) - INTERVAL 5 SECOND AND CAST(:at AS DATETIME) + INTERVAL 5 SECOND`,
          { id: productId, at: p.at },
          t,
        );
      }
      await t.commit();
      return { restored: true, id: productId };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /** Another active product with this name, if any (the Add / Edit form warns about it). */
  async nameTaken(companyId: number, name: string, exceptId?: number): Promise<{ id: number; name: string } | null> {
    const k = nameKey(name);
    if (!k) return null;
    const [hit] = await this.q(
      `SELECT id, name FROM products WHERE company_id = :c AND is_active = 1 AND LOWER(TRIM(name)) = :k AND id <> :x LIMIT 1`,
      { c: companyId, k, x: exceptId || 0 },
    );
    return hit ? { id: num(hit.id), name: String(hit.name) } : null;
  }
}
