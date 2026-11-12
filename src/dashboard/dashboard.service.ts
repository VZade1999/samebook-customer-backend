import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { CompanyModulesService } from '../company-modules/company-modules.service';
import {
  DashboardAccess,
  DashboardRange,
  accessFor,
  money,
  num,
  pctChange,
  resolveRange,
} from './dashboard.rules';

export interface DashboardRequester {
  userId: number;
  companyId: number;
  permissions: string[];
}

type Row = Record<string, any>;
type SeriesRow = [date: string, count: number, amount: number];

// Invoices that no longer count anywhere (replaced or voided).
const LIVE_INVOICE = `status NOT IN ('CANCELLED', 'SUPERSEDED')`;
// A quotation's business date: the date on the document, else the day it was created (local time).
const QUOTE_DATE = `COALESCE(q.quotation_date, DATE(DATE_ADD(q.created_at, INTERVAL :tz MINUTE)))`;
const LIVE_QUOTE = `COALESCE(q.status, '') <> 'DELETED' AND COALESCE(q.document_type, 'QT') = 'QT'`;

const AGING = [
  { key: 'current', label: 'Not due yet' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'd90p', label: '90+ days' },
];

/**
 * Read-only business overview for one company and one period. Every number
 * is computed in SQL (a handful of aggregate queries, run concurrently on the
 * pool), and each section is included only when the user may see it.
 * Not cached on purpose: billing data must always be live.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly modules: CompanyModulesService,
  ) {}

  private get seq() {
    return this.dbProvider.sequelize;
  }

  private rows(sql: string, replacements: Row): Promise<Row[]> {
    return this.seq.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  async overview(r: DashboardRequester, q: Row) {
    const resolved = resolveRange(q);
    if (!resolved.ok) return { success: false, status: 400, message: resolved.message };
    const range = resolved.range;
    const enabled = await this.modules.getEnabledModuleKeys(r.companyId);
    const access = accessFor(r.permissions || [], enabled);

    const p = {
      c: r.companyId,
      u: r.userId,
      f: range.from,
      t: range.to,
      pf: range.prevFrom,
      pt: range.prevTo,
      today: range.today,
      tz: range.tz,
      fUtc: range.fromUtc,
      tUtcEnd: range.toUtcEnd,
      pfUtc: range.prevFromUtc,
      ptUtcEnd: range.prevToUtcEnd,
    };

    // Each section fails on its own: a broken add-on table must not blank the
    // whole dashboard. Failed sections are listed in `errors`.
    const errors: string[] = [];
    const safe = async <T>(name: string, on: unknown, fn: () => Promise<T>): Promise<T | undefined> => {
      if (!on) return undefined;
      try {
        return await fn();
      } catch (err) {
        errors.push(name);
        this.appLogger.forContext('DashboardService', name, { companyId: r.companyId }).error(`${name} failed`, err);
        return undefined;
      }
    };

    const [series, snapshot, invoiceSummary, receivables, paymentModes, topCustomers, topProducts, funnel, challans, lowStock, heatmap, recent, tasks, attendance, drive] =
      await Promise.all([
        safe('series', true, () => this.series(access, p)),
        safe('snapshot', true, () => this.snapshot(access, p)),
        safe('invoice_summary', access.insights, () => this.invoiceSummary(p)),
        safe('receivables', access.insights, () => this.receivables(p)),
        safe('payment_modes', access.insights, () => this.paymentModes(p)),
        safe('top_customers', access.insights, () => this.topCustomers(p)),
        safe('top_products', access.insights, () => this.topProducts(p)),
        safe('funnel', access.quotations, () => this.funnel(access, p)),
        safe('challans', access.challans, () => this.challans(p)),
        safe('low_stock', access.products, () => this.lowStock(p)),
        safe('heatmap', access.invoices || access.quotations || access.challans, () => this.heatmap(access, p)),
        safe('recent', access.invoices || access.quotations || access.challans, () => this.recent(access, p)),
        safe('tasks', access.tasks, () => this.tasks(access, p)),
        safe('attendance', access.attendance, () => this.attendance(access, p)),
        safe('drive', access.drive, () => this.drive(p)),
      ]);

    return {
      success: true,
      message: 'Dashboard',
      data: {
        range: {
          from: range.from,
          to: range.to,
          days: range.days,
          prev_from: range.prevFrom,
          prev_to: range.prevTo,
          today: range.today,
          tz: range.tz,
        },
        access,
        generated_at: new Date().toISOString(),
        totals: series ? this.totals(series, range) : {},
        // Only days of the two periods (a custom comparison period can leave a gap).
        series: Object.fromEntries(
          Object.entries(series || {}).map(([k, list]) => [
            k,
            list.filter(([d]) => d >= range.from || (d >= range.prevFrom && d <= range.prevTo)),
          ]),
        ),
        snapshot: snapshot || {},
        invoice_summary: invoiceSummary,
        receivables,
        payment_modes: paymentModes,
        top_customers: topCustomers,
        top_products: topProducts,
        funnel,
        challans,
        low_stock: lowStock,
        heatmap,
        recent,
        tasks,
        attendance,
        drive,
        errors,
      },
    };
  }

  // ── Daily series (current + previous period in one round trip) ────────────
  private async series(a: DashboardAccess, p: Row): Promise<Record<string, SeriesRow[]>> {
    const parts: string[] = [];
    if (a.invoices) {
      parts.push(`SELECT 'invoiced' AS k, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS d, COUNT(*) AS n,
          ${a.insights ? 'COALESCE(SUM(grand_total), 0)' : '0'} AS v
        FROM invoices WHERE company_id = :c AND ${LIVE_INVOICE} AND invoice_date BETWEEN :pf AND :t
        GROUP BY invoice_date`);
    }
    // Every branch aliases its columns: a UNION takes its names from whichever
    // branch comes first, and that depends on the user's permissions.
    if (a.insights) {
      parts.push(`SELECT 'collected' AS k, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS d, COUNT(*) AS n,
          COALESCE(SUM(p.payment_amount), 0) AS v
        FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.company_id = :c AND i.${LIVE_INVOICE} AND p.payment_date BETWEEN :pf AND :t
        GROUP BY p.payment_date`);
    }
    if (a.quotations) {
      parts.push(`SELECT 'quotations' AS k, DATE_FORMAT(x.d, '%Y-%m-%d') AS d, COUNT(*) AS n, COALESCE(SUM(x.v), 0) AS v
        FROM (SELECT ${QUOTE_DATE} AS d, q.grand_total AS v FROM quotations q WHERE q.company_id = :c AND ${LIVE_QUOTE}) x
        WHERE x.d BETWEEN :pf AND :t GROUP BY x.d`);
    }
    if (a.challans) {
      parts.push(`SELECT 'challans' AS k, DATE_FORMAT(challan_date, '%Y-%m-%d') AS d, COUNT(*) AS n,
          COALESCE(SUM(total_value), 0) AS v
        FROM delivery_challans
        WHERE company_id = :c AND status <> 'CANCELLED' AND COALESCE(is_active, 1) = 1 AND challan_date BETWEEN :pf AND :t
        GROUP BY challan_date`);
    }
    if (a.customers) {
      parts.push(`SELECT 'customers' AS k, DATE_FORMAT(x.d, '%Y-%m-%d') AS d, COUNT(*) AS n, 0 AS v
        FROM (SELECT DATE(DATE_ADD(created_at, INTERVAL :tz MINUTE)) AS d FROM customers
              WHERE company_id = :c AND created_at >= :pfUtc AND created_at < :tUtcEnd) x
        GROUP BY x.d`);
    }
    const out: Record<string, SeriesRow[]> = {};
    if (!parts.length) return out;
    const rows = await this.rows(parts.join('\nUNION ALL\n'), p);
    for (const row of rows) {
      (out[row.k] ||= []).push([String(row.d), num(row.n), money(row.v)]);
    }
    Object.values(out).forEach((list) => list.sort((x, y) => (x[0] < y[0] ? -1 : 1)));
    return out;
  }

  private totals(series: Record<string, SeriesRow[]>, range: DashboardRange) {
    const out: Record<string, { count: number; amount: number; prev_count: number; prev_amount: number; count_change: number | null; amount_change: number | null }> = {};
    for (const [key, list] of Object.entries(series)) {
      let count = 0, amount = 0, prevCount = 0, prevAmount = 0;
      for (const [d, n, v] of list) {
        if (d >= range.from) {
          count += n;
          amount += v;
        } else if (d >= range.prevFrom && d <= range.prevTo) {
          prevCount += n;
          prevAmount += v;
        }
      }
      out[key] = {
        count,
        amount: money(amount),
        prev_count: prevCount,
        prev_amount: money(prevAmount),
        count_change: pctChange(count, prevCount),
        amount_change: pctChange(amount, prevAmount),
      };
    }
    return out;
  }

  // ── Point-in-time counts (as of now), one round trip ──────────────────────
  private async snapshot(a: DashboardAccess, p: Row) {
    const cols: string[] = [];
    if (a.customers) {
      cols.push(`(SELECT COUNT(*) FROM customers WHERE company_id = :c) AS customers_total`);
      cols.push(`(SELECT COUNT(*) FROM customers WHERE company_id = :c AND COALESCE(is_active, 1) = 1) AS customers_active`);
    }
    if (a.products) {
      cols.push(`(SELECT COUNT(*) FROM products WHERE company_id = :c AND COALESCE(is_active, 1) = 1) AS products_active`);
    }
    if (a.challans) {
      cols.push(`(SELECT COUNT(*) FROM delivery_challans WHERE company_id = :c AND COALESCE(is_active, 1) = 1
          AND status IN ('DISPATCHED', 'DELIVERED') AND quotation_id IS NOT NULL AND invoice_id IS NULL) AS challans_awaiting`);
      cols.push(`(SELECT COALESCE(SUM(total_value), 0) FROM delivery_challans WHERE company_id = :c AND COALESCE(is_active, 1) = 1
          AND status IN ('DISPATCHED', 'DELIVERED') AND quotation_id IS NOT NULL AND invoice_id IS NULL) AS challans_awaiting_value`);
    }
    if (a.quotations) {
      // Open pipeline: shared or approved, not yet invoiced, still valid.
      const open = `FROM quotations q WHERE q.company_id = :c AND ${LIVE_QUOTE} AND q.status IN ('SENT', 'APPROVED')
          AND COALESCE(q.has_invoice, 0) = 0 AND (q.validity_date IS NULL OR q.validity_date >= :today)`;
      cols.push(`(SELECT COUNT(*) ${open}) AS pipeline_count`);
      cols.push(`(SELECT COALESCE(SUM(q.grand_total), 0) ${open}) AS pipeline_value`);
    }
    if (!cols.length) return {};
    const [row] = await this.rows(`SELECT ${cols.join(',\n')}`, p);
    const out: Record<string, number> = {};
    Object.entries(row || {}).forEach(([k, v]) => (out[k] = k.endsWith('_value') ? money(v) : num(v)));
    return out;
  }

  // ── Invoices dated in the period: payment state, GST, speed of payment ────
  private async invoiceSummary(p: Row) {
    const [byState, speedRows] = await Promise.all([
      // Current-period invoices by payment state, plus one 'prev' row for the
      // previous period's GST, in a single pass.
      this.rows(
        `SELECT cat, COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS amount,
                COALESCE(SUM(paid_amount), 0) AS paid, COALESCE(SUM(balance_amount), 0) AS balance,
                COALESCE(SUM(cgst_amount), 0) AS cgst, COALESCE(SUM(sgst_amount), 0) AS sgst,
                COALESCE(SUM(igst_amount), 0) AS igst
         FROM (SELECT CASE
                 WHEN invoice_date <= :pt THEN 'prev'
                 WHEN status = 'PAID' OR balance_amount <= 0 THEN 'paid'
                 WHEN due_date IS NOT NULL AND due_date < :today THEN 'overdue'
                 WHEN paid_amount > 0 THEN 'partial'
                 ELSE 'unpaid' END AS cat, grand_total, paid_amount, balance_amount, cgst_amount, sgst_amount, igst_amount
               FROM invoices WHERE company_id = :c AND ${LIVE_INVOICE} AND invoice_date BETWEEN :pf AND :t
                 AND (invoice_date >= :f OR invoice_date <= :pt)) x
         GROUP BY cat`,
        p,
      ),
      // Days from invoice date to the payment that settled it, for invoices settled in the period.
      this.rows(
        `SELECT AVG(DATEDIFF(lp.last_paid, i.invoice_date)) AS avg_days, COUNT(*) AS n
         FROM invoices i
         JOIN (SELECT ip.invoice_id, MAX(ip.payment_date) AS last_paid
               FROM invoice_payments ip JOIN invoices i2 ON i2.id = ip.invoice_id
               WHERE i2.company_id = :c GROUP BY ip.invoice_id) lp ON lp.invoice_id = i.id
         WHERE i.company_id = :c AND i.${LIVE_INVOICE} AND (i.status = 'PAID' OR i.balance_amount <= 0)
           AND lp.last_paid BETWEEN :f AND :t`,
        p,
      ),
    ]);

    const state: Record<string, { count: number; amount: number; paid: number; balance: number }> = {};
    for (const k of ['paid', 'partial', 'unpaid', 'overdue']) state[k] = { count: 0, amount: 0, paid: 0, balance: 0 };
    let count = 0, amount = 0, paid = 0, balance = 0, cgst = 0, sgst = 0, igst = 0, prevGst = 0;
    for (const row of byState) {
      if (row.cat === 'prev') {
        prevGst = num(row.cgst) + num(row.sgst) + num(row.igst);
        continue;
      }
      state[row.cat] = { count: num(row.n), amount: money(row.amount), paid: money(row.paid), balance: money(row.balance) };
      count += num(row.n);
      amount += num(row.amount);
      paid += num(row.paid);
      balance += num(row.balance);
      cgst += num(row.cgst);
      sgst += num(row.sgst);
      igst += num(row.igst);
    }
    const gst = money(cgst + sgst + igst);
    const speed = speedRows[0] || {};
    return {
      state,
      total: { count, amount: money(amount), paid: money(paid), balance: money(balance) },
      collection_rate: amount > 0 ? Math.round((paid / amount) * 1000) / 10 : null,
      gst: {
        before_tax: money(amount - gst),
        cgst: money(cgst),
        sgst: money(sgst),
        igst: money(igst),
        total: gst,
        prev_total: money(prevGst),
        change: pctChange(gst, prevGst),
      },
      avg_days_to_pay: speed.avg_days === null || speed.avg_days === undefined ? null : Math.round(num(speed.avg_days) * 10) / 10,
      settled_count: num(speed.n),
    };
  }

  // ── Money still owed to the company, by how late it is (as of today) ──────
  private async receivables(p: Row) {
    const rows = await this.rows(
      `SELECT bucket, COUNT(*) AS n, COALESCE(SUM(balance_amount), 0) AS v
       FROM (SELECT balance_amount, CASE
               WHEN due_date IS NULL OR due_date >= :today THEN 'current'
               WHEN DATEDIFF(:today, due_date) <= 30 THEN 'd30'
               WHEN DATEDIFF(:today, due_date) <= 60 THEN 'd60'
               WHEN DATEDIFF(:today, due_date) <= 90 THEN 'd90'
               ELSE 'd90p' END AS bucket
             FROM invoices WHERE company_id = :c AND ${LIVE_INVOICE} AND status <> 'PAID' AND balance_amount > 0) x
       GROUP BY bucket`,
      p,
    );
    const byKey = new Map(rows.map((row) => [row.bucket, row]));
    const buckets = AGING.map((b) => ({ ...b, count: num(byKey.get(b.key)?.n), amount: money(byKey.get(b.key)?.v) }));
    const total = buckets.reduce((s, b) => s + b.amount, 0);
    const overdue = buckets.filter((b) => b.key !== 'current');
    return {
      total: money(total),
      count: buckets.reduce((s, b) => s + b.count, 0),
      overdue: money(overdue.reduce((s, b) => s + b.amount, 0)),
      overdue_count: overdue.reduce((s, b) => s + b.count, 0),
      buckets,
    };
  }

  private async paymentModes(p: Row) {
    const rows = await this.rows(
      `SELECT p.payment_mode AS mode, COUNT(*) AS n, COALESCE(SUM(p.payment_amount), 0) AS v
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.company_id = :c AND i.${LIVE_INVOICE} AND p.payment_date BETWEEN :f AND :t
       GROUP BY p.payment_mode ORDER BY v DESC`,
      p,
    );
    return rows.map((row) => ({ mode: String(row.mode || 'OTHER'), count: num(row.n), amount: money(row.v) }));
  }

  private async topCustomers(p: Row) {
    const rows = await this.rows(
      // COUNT(*) OVER () runs after GROUP BY and before LIMIT: all customers billed.
      `SELECT customer_id AS id, MAX(customer_name) AS name, COUNT(*) AS n,
              COALESCE(SUM(grand_total), 0) AS v, COALESCE(SUM(balance_amount), 0) AS due,
              COUNT(*) OVER () AS billed
       FROM invoices WHERE company_id = :c AND ${LIVE_INVOICE} AND invoice_date BETWEEN :f AND :t
       GROUP BY customer_id ORDER BY v DESC LIMIT 7`,
      p,
    );
    return {
      customers_billed: num(rows[0]?.billed),
      items: rows.map((row) => ({
        id: row.id === null ? null : num(row.id),
        name: row.name || 'Unnamed customer',
        invoices: num(row.n),
        amount: money(row.v),
        balance: money(row.due),
      })),
    };
  }

  private async topProducts(p: Row) {
    const rows = await this.rows(
      `SELECT ii.product_name AS name, MAX(ii.unit) AS unit, COALESCE(SUM(ii.qty), 0) AS qty,
              COALESCE(SUM(ii.total), 0) AS v, COUNT(DISTINCT ii.invoice_id) AS n
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.company_id = :c AND i.${LIVE_INVOICE} AND i.invoice_date BETWEEN :f AND :t
       GROUP BY ii.product_name ORDER BY v DESC LIMIT 7`,
      p,
    );
    return rows.map((row) => ({
      name: row.name || 'Unnamed item',
      unit: row.unit || null,
      qty: Math.round(num(row.qty) * 100) / 100,
      amount: money(row.v),
      invoices: num(row.n),
    }));
  }

  // ── Quotation funnel for quotations dated in the period ───────────────────
  private async funnel(a: DashboardAccess, p: Row) {
    const [row] = await this.rows(
      `SELECT
         COUNT(*) AS created, COALESCE(SUM(v), 0) AS created_v,
         COALESCE(SUM(sent), 0) AS sent, COALESCE(SUM(CASE WHEN sent THEN v END), 0) AS sent_v,
         COALESCE(SUM(approved), 0) AS approved, COALESCE(SUM(CASE WHEN approved THEN v END), 0) AS approved_v,
         COALESCE(SUM(inv), 0) AS invoiced, COALESCE(SUM(CASE WHEN inv THEN v END), 0) AS invoiced_v,
         COALESCE(SUM(paid), 0) AS paid, COALESCE(SUM(CASE WHEN paid THEN v END), 0) AS paid_v,
         COALESCE(SUM(st IN ('DRAFT', '')), 0) AS draft,
         COALESCE(SUM(st = 'REJECTED'), 0) AS rejected,
         COALESCE(SUM(st = 'EXPIRED'), 0) AS expired
       FROM (
         SELECT st, v, inv, paid,
                (st NOT IN ('DRAFT', '') OR inv) AS sent,
                (st IN ('APPROVED', 'INVOICED', 'PARTIALLY_DISPATCHED') OR inv) AS approved
         FROM (
           SELECT COALESCE(q.status, '') AS st, COALESCE(q.grand_total, 0) AS v,
                  (COALESCE(q.has_invoice, 0) = 1 OR q.status = 'INVOICED') AS inv,
                  EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.company_id = q.company_id
                          AND i.status = 'PAID') AS paid
           FROM quotations q
           WHERE q.company_id = :c AND ${LIVE_QUOTE} AND ${QUOTE_DATE} BETWEEN :f AND :t
         ) base
       ) x`,
      p,
    );
    const s = row || {};
    const stages = [
      { key: 'created', label: 'Created', count: num(s.created), amount: money(s.created_v) },
      { key: 'sent', label: 'Shared', count: num(s.sent), amount: money(s.sent_v) },
      { key: 'approved', label: 'Approved', count: num(s.approved), amount: money(s.approved_v) },
      { key: 'invoiced', label: 'Invoiced', count: num(s.invoiced), amount: money(s.invoiced_v) },
    ];
    // Payment state is invoice data: only for people who can see invoices.
    if (a.invoices) stages.push({ key: 'paid', label: 'Paid', count: num(s.paid), amount: money(s.paid_v) });
    const created = num(s.created);
    return {
      stages,
      win_rate: created ? Math.round((num(s.invoiced) / created) * 1000) / 10 : null,
      draft: num(s.draft),
      rejected: num(s.rejected),
      expired: num(s.expired),
    };
  }

  private async challans(p: Row) {
    const rows = await this.rows(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(total_value), 0) AS v
       FROM delivery_challans
       WHERE company_id = :c AND COALESCE(is_active, 1) = 1 AND challan_date BETWEEN :f AND :t
       GROUP BY status`,
      p,
    );
    const order = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'INVOICED', 'CANCELLED'];
    const by = new Map(rows.map((row) => [String(row.status), row]));
    const extra = rows.map((row) => String(row.status)).filter((s) => !order.includes(s));
    return {
      statuses: [...order, ...extra].map((status) => ({
        status,
        count: num(by.get(status)?.n),
        value: money(by.get(status)?.v),
      })),
    };
  }

  private async lowStock(p: Row) {
    const where = `company_id = :c AND COALESCE(is_active, 1) = 1 AND minimum_stock > 0 AND COALESCE(stock_quantity, 0) <= minimum_stock`;
    const items = await this.rows(
      `SELECT id, name, unit, COALESCE(stock_quantity, 0) AS stock, minimum_stock AS minimum, COUNT(*) OVER () AS total
       FROM products WHERE ${where}
       ORDER BY COALESCE(stock_quantity, 0) / minimum_stock ASC, name ASC LIMIT 6`,
      p,
    );
    return {
      count: num(items[0]?.total),
      items: items.map((row) => ({
        id: num(row.id),
        name: row.name,
        unit: row.unit || null,
        stock: num(row.stock),
        minimum: num(row.minimum),
      })),
    };
  }

  // ── When documents get created: weekday × hour, in the viewer's time zone ─
  private async heatmap(a: DashboardAccess, p: Row) {
    const t = `DATE_ADD(created_at, INTERVAL :tz MINUTE) AS t`;
    const inRange = `created_at >= :fUtc AND created_at < :tUtcEnd`;
    const parts: string[] = [];
    if (a.invoices) {
      parts.push(`SELECT ${t} FROM invoices WHERE company_id = :c AND ${inRange}`);
      parts.push(`SELECT DATE_ADD(p.created_at, INTERVAL :tz MINUTE) AS t FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.company_id = :c AND p.created_at >= :fUtc AND p.created_at < :tUtcEnd`);
    }
    if (a.quotations) parts.push(`SELECT ${t} FROM quotations q WHERE q.company_id = :c AND ${LIVE_QUOTE} AND ${inRange}`);
    if (a.challans) parts.push(`SELECT ${t} FROM delivery_challans WHERE company_id = :c AND ${inRange}`);
    const rows = await this.rows(
      `SELECT DAYOFWEEK(x.t) AS dow, HOUR(x.t) AS h, COUNT(*) AS n FROM (${parts.join(' UNION ALL ')}) x
       WHERE x.t IS NOT NULL GROUP BY dow, h`,
      p,
    );
    // Monday first: MySQL DAYOFWEEK is 1 = Sunday … 7 = Saturday.
    const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let total = 0;
    for (const row of rows) {
      const d = (num(row.dow) + 5) % 7;
      const h = num(row.h);
      if (d >= 0 && d < 7 && h >= 0 && h < 24) {
        cells[d][h] += num(row.n);
        total += num(row.n);
      }
    }
    return { cells, total };
  }

  // ── Latest documents in the period ─────────────────────────────────────────
  private async recent(a: DashboardAccess, p: Row) {
    const inRange = (col: string) => `${col} >= :fUtc AND ${col} < :tUtcEnd`;
    // delivery_challans uses a different collation from the older tables; a
    // UNION of text columns needs one collation, so normalise them.
    const txt = (col: string) => `CONVERT(${col} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
    const cols = (type: string, id: string, ref: string, no: string, name: string, amount: string, status: string, at: string) =>
      `'${type}' AS type, ${id} AS id, ${ref} AS ref_id, ${txt(no)} AS number, ${txt(name)} AS name, ${amount} AS amount, ` +
      `${txt(status)} AS status, ${at} AS at`;
    const parts: string[] = [];
    if (a.invoices) {
      parts.push(`(SELECT ${cols('invoice', 'id', 'id', 'invoice_number', 'customer_name', 'grand_total', 'status', 'created_at')}
        FROM invoices WHERE company_id = :c AND ${inRange('created_at')} ORDER BY created_at DESC LIMIT 10)`);
      parts.push(`(SELECT ${cols('payment', 'p.id', 'i.id', 'i.invoice_number', 'i.customer_name', 'p.payment_amount', 'p.payment_mode', 'p.created_at')}
        FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.company_id = :c AND ${inRange('p.created_at')} ORDER BY p.created_at DESC LIMIT 10)`);
    }
    if (a.quotations) {
      parts.push(`(SELECT ${cols('quotation', 'q.id', 'q.id', 'q.quotation_number', 'q.customer_name', 'q.grand_total', 'q.status', 'q.created_at')}
        FROM quotations q WHERE q.company_id = :c AND ${LIVE_QUOTE} AND ${inRange('q.created_at')} ORDER BY q.created_at DESC LIMIT 10)`);
    }
    if (a.challans) {
      parts.push(`(SELECT ${cols('challan', 'id', 'id', 'challan_number', 'customer_name', 'total_value', 'status', 'created_at')}
        FROM delivery_challans WHERE company_id = :c AND ${inRange('created_at')} ORDER BY created_at DESC LIMIT 10)`);
    }
    const rows = await this.rows(`${parts.join(' UNION ALL ')} ORDER BY at DESC LIMIT 10`, p);
    return rows.map((row) => ({
      type: row.type,
      id: num(row.id),
      ref_id: num(row.ref_id),
      number: row.number || '',
      name: row.name || '',
      amount: money(row.amount),
      status: row.status || '',
      at: row.at instanceof Date ? row.at.toISOString() : row.at,
    }));
  }

  // ── Add-ons ────────────────────────────────────────────────────────────────
  private async tasks(a: DashboardAccess, p: Row) {
    const mine = a.tasks === 'mine' ? `AND (assignee_id = :u OR (created_by = :u AND assignee_id IS NULL))` : '';
    const [row] = await this.rows(
      `SELECT
         COALESCE(SUM(status <> 'DONE'), 0) AS open,
         COALESCE(SUM(status <> 'DONE' AND due_date < :today), 0) AS overdue,
         COALESCE(SUM(status <> 'DONE' AND due_date = :today), 0) AS due_today,
         COALESCE(SUM(status = 'TODO'), 0) AS todo,
         COALESCE(SUM(status = 'IN_PROGRESS'), 0) AS in_progress,
         COALESCE(SUM(status = 'IN_REVIEW'), 0) AS in_review,
         COALESCE(SUM(status = 'ON_HOLD'), 0) AS on_hold,
         COALESCE(SUM(status = 'DONE' AND completed_at >= :fUtc AND completed_at < :tUtcEnd), 0) AS done,
         COALESCE(SUM(status = 'DONE' AND completed_at >= :pfUtc AND completed_at < :ptUtcEnd), 0) AS done_prev,
         COALESCE(SUM(created_at >= :fUtc AND created_at < :tUtcEnd), 0) AS created
       FROM tasks WHERE company_id = :c AND is_deleted = 0 ${mine}`,
      p,
    );
    const s = row || {};
    return {
      scope: a.tasks,
      open: num(s.open),
      overdue: num(s.overdue),
      due_today: num(s.due_today),
      by_status: {
        TODO: num(s.todo),
        IN_PROGRESS: num(s.in_progress),
        IN_REVIEW: num(s.in_review),
        ON_HOLD: num(s.on_hold),
      },
      done: num(s.done),
      done_prev: num(s.done_prev),
      done_change: pctChange(num(s.done), num(s.done_prev)),
      created: num(s.created),
    };
  }

  private async attendance(a: DashboardAccess, p: Row) {
    if (a.attendance === 'team') {
      const [[now], days] = await Promise.all([
        this.rows(
          `SELECT
             (SELECT COUNT(*) FROM users WHERE company_id = :c AND is_active = 1) AS staff,
             (SELECT COUNT(DISTINCT user_id) FROM attendance WHERE company_id = :c AND work_date = :today) AS present,
             (SELECT COUNT(DISTINCT user_id) FROM attendance WHERE company_id = :c AND work_date = :today AND punch_out IS NULL) AS working,
             (SELECT COUNT(DISTINCT user_id) FROM leave_requests WHERE company_id = :c AND status = 'approved'
                AND from_date <= :today AND to_date >= :today) AS on_leave,
             (SELECT COUNT(*) FROM leave_requests WHERE company_id = :c AND status = 'pending') AS pending_leaves,
             (SELECT COALESCE(SUM(total_minutes), 0) / NULLIF(COUNT(DISTINCT user_id, work_date), 0)
                FROM attendance WHERE company_id = :c AND work_date BETWEEN :f AND :t AND punch_out IS NOT NULL) AS avg_minutes`,
          p,
        ),
        this.rows(
          `SELECT DATE_FORMAT(work_date, '%Y-%m-%d') AS d, COUNT(DISTINCT user_id) AS n
           FROM attendance WHERE company_id = :c AND work_date BETWEEN :f AND :t GROUP BY work_date ORDER BY work_date`,
          p,
        ),
      ]);
      return {
        scope: 'team' as const,
        staff: num(now?.staff),
        present: num(now?.present),
        working: num(now?.working),
        on_leave: num(now?.on_leave),
        pending_leaves: num(now?.pending_leaves),
        avg_minutes: now?.avg_minutes === null || now?.avg_minutes === undefined ? null : Math.round(num(now.avg_minutes)),
        daily: days.map((d) => [String(d.d), num(d.n)] as [string, number]),
      };
    }
    const [row] = await this.rows(
      `SELECT
         (SELECT COUNT(DISTINCT work_date) FROM attendance WHERE company_id = :c AND user_id = :u AND work_date BETWEEN :f AND :t) AS days,
         (SELECT COALESCE(SUM(total_minutes), 0) FROM attendance WHERE company_id = :c AND user_id = :u AND work_date BETWEEN :f AND :t) AS minutes,
         (SELECT COUNT(*) FROM attendance WHERE company_id = :c AND user_id = :u AND work_date = :today) AS today_sessions,
         (SELECT COUNT(*) FROM attendance WHERE company_id = :c AND user_id = :u AND work_date = :today AND punch_out IS NULL) AS working,
         (SELECT COUNT(*) FROM leave_requests WHERE company_id = :c AND user_id = :u AND status = 'pending') AS pending_leaves`,
      p,
    );
    return {
      scope: 'me' as const,
      days: num(row?.days),
      minutes: num(row?.minutes),
      punched_today: num(row?.today_sessions) > 0,
      working: num(row?.working) > 0,
      pending_leaves: num(row?.pending_leaves),
    };
  }

  private async drive(p: Row) {
    const [row] = await this.rows(
      `SELECT
         (SELECT COUNT(*) FROM drive_files WHERE company_id = :c) AS files,
         (SELECT COUNT(*) FROM drive_folders WHERE company_id = :c) AS folders,
         (SELECT COALESCE(SUM(sz), 0) FROM (SELECT MAX(size_bytes) AS sz FROM drive_file_versions
            WHERE company_id = :c GROUP BY storage_key) b) AS bytes,
         (SELECT COUNT(*) FROM drive_file_versions WHERE company_id = :c AND created_at >= :fUtc AND created_at < :tUtcEnd) AS uploads,
         (SELECT COUNT(DISTINCT uploaded_by) FROM drive_file_versions WHERE company_id = :c AND created_at >= :fUtc AND created_at < :tUtcEnd) AS contributors`,
      p,
    );
    return {
      files: num(row?.files),
      folders: num(row?.folders),
      bytes: num(row?.bytes),
      uploads: num(row?.uploads),
      contributors: num(row?.contributors),
    };
  }
}
