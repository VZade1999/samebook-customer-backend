import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import {
  type DirectoryRow,
  directoryStats,
  filterHit,
  lastActivity,
  parseFilter,
  parseSort,
  searchHit,
  sortRows,
} from './customer-directory.rules';

/** Same "live invoice" rule as the Dashboard. */
const LIVE_INVOICE = `status NOT IN ('CANCELLED', 'SUPERSEDED')`;
const num = (v: unknown) => Number(v) || 0;
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s || null;
};

export interface DirectoryQuery {
  search?: string;
  type?: string;
  filter?: string;
  state?: string;
  sort?: string;
  page?: number | string;
  limit?: number | string;
  /** One customer by id (a link to their profile, e.g. from the AI Assistant). */
  id?: number | string;
}

/** What the caller may see, from their permissions (the same gates as the Dashboard). */
const accessOf = (permissions: string[]) => ({
  invoices: permissions.includes('invoices.view'),
  money: permissions.includes('invoices.view') && permissions.includes('invoices.insides'),
  quotations: permissions.includes('quotations.view'),
  challans: permissions.includes('challans.view'),
});

/**
 * The Customers page: every customer with their main contact, place and
 * billing figures, the tile counts, and a customer's recent documents.
 * Billing data is read live (never cached).
 */
@Injectable()
export class CustomerDirectoryService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  private q(sql: string, replacements: Record<string, unknown>) {
    return this.db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<any[]>;
  }

  /** Every active customer of the company, with figures the caller may see. */
  private async rows(companyId: number, permissions: string[]): Promise<DirectoryRow[]> {
    const can = accessOf(permissions);
    const r = { c: companyId };
    const [customers, contacts, addresses, invoices, quotations, challans] = await Promise.all([
      this.q(
        `SELECT id, customer_type, display_name, company_name, gst_number, industry, po_required, email, phone,
                DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
         FROM customers WHERE company_id = :c AND is_active = 1`,
        r,
      ),
      this.q(
        `SELECT cc.customer_id, cc.first_name, cc.last_name, cc.email, cc.phone, cc.designation
         FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id
         WHERE c.company_id = :c AND c.is_active = 1 AND cc.is_active = 1
         ORDER BY cc.customer_id, cc.is_primary DESC, cc.id`,
        r,
      ),
      this.q(
        `SELECT ca.customer_id, ca.city, ca.state
         FROM customer_addresses ca JOIN customers c ON c.id = ca.customer_id
         WHERE c.company_id = :c AND c.is_active = 1 AND ca.is_active = 1
         ORDER BY ca.customer_id, ca.is_primary DESC, (ca.address_type = 'BILLING') DESC, ca.id`,
        r,
      ),
      can.invoices
        ? this.q(
            `SELECT customer_id, COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS billed,
                    COALESCE(SUM(CASE WHEN status <> 'PAID' AND balance_amount > 0 THEN balance_amount ELSE 0 END), 0) AS due,
                    DATE_FORMAT(MAX(invoice_date), '%Y-%m-%d') AS last
             FROM invoices WHERE company_id = :c AND ${LIVE_INVOICE} AND customer_id IS NOT NULL GROUP BY customer_id`,
            r,
          )
        : Promise.resolve([]),
      can.quotations
        ? this.q(
            `SELECT customer_id, COUNT(*) AS n, DATE_FORMAT(MAX(quotation_date), '%Y-%m-%d') AS last
             FROM quotations WHERE company_id = :c AND COALESCE(status, '') <> 'DELETED' AND customer_id IS NOT NULL GROUP BY customer_id`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT customer_id, COUNT(*) AS n, DATE_FORMAT(MAX(challan_date), '%Y-%m-%d') AS last
             FROM delivery_challans WHERE company_id = :c AND status <> 'CANCELLED' AND COALESCE(is_active, 1) = 1 AND customer_id IS NOT NULL
             GROUP BY customer_id`,
            r,
          )
        : Promise.resolve([]),
    ]);

    const first = <T extends { customer_id: unknown }>(list: T[]) => {
      const m = new Map<number, T>();
      list.forEach((x) => m.has(num(x.customer_id)) || m.set(num(x.customer_id), x));
      return m;
    };
    const byId = <T extends { customer_id: unknown }>(list: T[]) => new Map(list.map((x) => [num(x.customer_id), x]));
    const contactOf = first(contacts);
    const addressOf = first(addresses);
    const inv = byId(invoices);
    const quo = byId(quotations);
    const dc = byId(challans);

    return customers.map((c) => {
      const id = num(c.id);
      const ct: any = contactOf.get(id);
      const ad: any = addressOf.get(id);
      const i: any = inv.get(id);
      const q: any = quo.get(id);
      const d: any = dc.get(id);
      return {
        id,
        type: String(c.customer_type).toUpperCase() === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
        name: text(c.display_name) || text(c.company_name) || 'Unnamed customer',
        company_name: text(c.company_name),
        gst_number: text(c.gst_number),
        industry: text(c.industry),
        po_required: num(c.po_required) === 1,
        contact: ct
          ? {
              name: [ct.first_name, ct.last_name].filter((x: unknown) => text(x)).join(' ').trim() || text(ct.email) || 'Contact',
              phone: text(ct.phone),
              email: text(ct.email),
              designation: text(ct.designation),
            }
          : null,
        phone: text(c.phone),
        email: text(c.email),
        city: text(ad?.city),
        state: text(ad?.state),
        created_at: c.created_at ?? null,
        invoices: num(i?.n),
        billed: can.money ? money(i?.billed) : 0,
        due: can.money ? money(i?.due) : 0,
        last_invoice: i?.last ?? null,
        quotations: num(q?.n),
        last_quotation: q?.last ?? null,
        challans: num(d?.n),
        last_challan: d?.last ?? null,
      } as DirectoryRow;
    });
  }

  async directory(companyId: number, permissions: string[], query: DirectoryQuery) {
    const can = accessOf(permissions);
    const now = new Date();
    const all = await this.rows(companyId, permissions);
    const only = Number(query.id);
    if (Number.isInteger(only) && only > 0) {
      const hit = all.filter((r) => r.id === only).map((r) => ({ ...r, last_activity: lastActivity(r) }));
      const stats = directoryStats(all, now);
      if (!can.money) {
        stats.due_total = 0;
        stats.billed_total = 0;
      }
      return { customers: hit, pagination: { total: hit.length, page: 1, limit: 1, pages: 1 }, stats, access: can };
    }
    const filter = parseFilter(query.filter);
    const type = String(query.type || '').toUpperCase();
    const state = String(query.state || '').trim().toLowerCase();
    const matched = sortRows(
      all.filter(
        (r) =>
          (type !== 'BUSINESS' && type !== 'INDIVIDUAL' ? true : r.type === type) &&
          (!state || String(r.state || '').trim().toLowerCase() === state) &&
          filterHit(r, filter, now) &&
          searchHit(r, String(query.search || '').slice(0, 100)),
      ),
      parseSort(query.sort),
    );
    const limit = Math.max(1, Math.min(num(query.limit) || 20, 100));
    const pages = Math.max(1, Math.ceil(matched.length / limit));
    const page = Math.min(Math.max(1, num(query.page) || 1), pages);
    const stats = directoryStats(all, now);
    if (!can.money) {
      stats.due_total = 0;
      stats.billed_total = 0;
    }
    return {
      customers: matched.slice((page - 1) * limit, page * limit).map((r) => ({ ...r, last_activity: lastActivity(r) })),
      pagination: { total: matched.length, page, limit, pages },
      stats,
      access: can,
    };
  }

  /** A customer's billing summary and recent quotations, challans and invoices. */
  async activity(companyId: number, customerId: number, permissions: string[]) {
    const can = accessOf(permissions);
    const r = { c: companyId, id: customerId };
    const [customer] = await this.q(`SELECT id FROM customers WHERE id = :id AND company_id = :c AND is_active = 1`, r);
    if (!customer) throw new NotFoundException('Customer not found');

    const [invSum, invRecent, quoSum, quoRecent, dcSum, dcRecent] = await Promise.all([
      can.invoices
        ? this.q(
            `SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS billed, COALESCE(SUM(paid_amount), 0) AS paid,
                    COALESCE(SUM(CASE WHEN status <> 'PAID' AND balance_amount > 0 THEN balance_amount ELSE 0 END), 0) AS due,
                    DATE_FORMAT(MIN(invoice_date), '%Y-%m-%d') AS first, DATE_FORMAT(MAX(invoice_date), '%Y-%m-%d') AS last
             FROM invoices WHERE company_id = :c AND customer_id = :id AND ${LIVE_INVOICE}`,
            r,
          )
        : Promise.resolve([]),
      can.invoices
        ? this.q(
            `SELECT id, invoice_number AS number, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS date, grand_total AS total,
                    balance_amount AS balance, status
             FROM invoices WHERE company_id = :c AND customer_id = :id ORDER BY invoice_date DESC, id DESC LIMIT 6`,
            r,
          )
        : Promise.resolve([]),
      can.quotations
        ? this.q(
            `SELECT COUNT(*) AS n, COALESCE(SUM(status IN ('SENT', 'APPROVED')), 0) AS open,
                    COALESCE(SUM(status = 'APPROVED'), 0) AS approved
             FROM quotations WHERE company_id = :c AND customer_id = :id AND COALESCE(status, '') <> 'DELETED'`,
            r,
          )
        : Promise.resolve([]),
      can.quotations
        ? this.q(
            `SELECT id, quotation_number AS number, DATE_FORMAT(quotation_date, '%Y-%m-%d') AS date, grand_total AS total,
                    status, COALESCE(has_invoice, 0) AS has_invoice
             FROM quotations WHERE company_id = :c AND customer_id = :id AND COALESCE(status, '') <> 'DELETED'
             ORDER BY quotation_date DESC, id DESC LIMIT 6`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT COUNT(*) AS n FROM delivery_challans
             WHERE company_id = :c AND customer_id = :id AND status <> 'CANCELLED' AND COALESCE(is_active, 1) = 1`,
            r,
          )
        : Promise.resolve([]),
      can.challans
        ? this.q(
            `SELECT id, challan_number AS number, DATE_FORMAT(challan_date, '%Y-%m-%d') AS date, status, total_quantity AS qty
             FROM delivery_challans WHERE company_id = :c AND customer_id = :id AND COALESCE(is_active, 1) = 1
             ORDER BY challan_date DESC, id DESC LIMIT 6`,
            r,
          )
        : Promise.resolve([]),
    ]);

    const i = invSum[0] || {};
    return {
      access: can,
      invoices: can.invoices
        ? {
            count: num(i.n),
            billed: can.money ? money(i.billed) : null,
            paid: can.money ? money(i.paid) : null,
            due: can.money ? money(i.due) : null,
            first: i.first ?? null,
            last: i.last ?? null,
            recent: invRecent.map((x) => ({ id: num(x.id), number: x.number, date: x.date, total: money(x.total), balance: money(x.balance), status: x.status })),
          }
        : null,
      quotations: can.quotations
        ? {
            count: num(quoSum[0]?.n),
            open: num(quoSum[0]?.open),
            approved: num(quoSum[0]?.approved),
            recent: quoRecent.map((x) => ({ id: num(x.id), number: x.number, date: x.date, total: money(x.total), status: x.status || 'DRAFT', invoiced: num(x.has_invoice) === 1 })),
          }
        : null,
      challans: can.challans
        ? {
            count: num(dcSum[0]?.n),
            recent: dcRecent.map((x) => ({ id: num(x.id), number: x.number, date: x.date, status: x.status, qty: num(x.qty) })),
          }
        : null,
    };
  }
}
