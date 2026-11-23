import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { addDays } from '../dashboard/dashboard.rules';
import { EXPIRING_DAYS, LIVE_SQL as LIVE_QUOTE, QUOTE_DATE_SQL, STAGE_SQL } from '../quotations/quotation-insights.rules';
import { LIVE_SQL as LIVE_INVOICE, STATE_SQL } from '../invoice/invoice-insights.rules';
import { TO_INVOICE_SQL } from '../delivery-challan/challan-insights.rules';

const num = (v: unknown) => Number(v) || 0;
const money = (v: unknown) => Math.round(num(v) * 100) / 100;
const text = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s || null;
};
/** Every word typed must match (like the other searches); at most 5 words. */
const words = (s: unknown) =>
  String(s ?? '')
    .trim()
    .slice(0, 80)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
const like = (w: string) => `%${w.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
const fullName = (first: unknown, last: unknown) => [text(first), text(last)].filter(Boolean).join(' ') || null;

export type QuotationStage = 'draft' | 'sent' | 'approved' | 'invoiced' | 'rejected' | 'expired' | 'open' | 'expiring' | 'lapsed';
export type InvoiceState = 'unpaid' | 'partial' | 'paid' | 'cancelled' | 'open' | 'overdue' | 'due_soon';
export type ChallanState = 'draft' | 'dispatched' | 'delivered' | 'invoiced' | 'cancelled' | 'to_invoice';

export interface ListFilter {
  search?: string | null;
  customer_id?: number | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  today: string;
  tz: number;
}

/**
 * Small, read-only look-ups for the AI Assistant: just the fields an answer
 * needs, always scoped to the caller's company, using the same rules as the
 * Quotation, Invoice and Challan pages (live documents, stages, states).
 * Billing data is read live (never cached).
 */
@Injectable()
export class AiLookupService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  private q(sql: string, replacements: Record<string, unknown>) {
    return this.db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<any[]>;
  }

  // ── Quotations ─────────────────────────────────────────────────────────────

  async quotations(companyId: number, f: ListFilter & { stage?: QuotationStage | null }) {
    const r: Record<string, unknown> = { c: companyId, today: f.today, soon: addDays(f.today, EXPIRING_DAYS), tz: f.tz };
    const where = ['q.company_id = :c', LIVE_QUOTE];
    const open = `${STAGE_SQL} IN ('draft', 'sent', 'approved')`;
    if (f.customer_id) {
      where.push('q.customer_id = :cid');
      r.cid = f.customer_id;
    }
    if (f.stage === 'open') where.push(open);
    else if (f.stage === 'expiring') where.push(`${open} AND q.validity_date BETWEEN :today AND :soon`);
    else if (f.stage === 'lapsed') where.push(`${open} AND q.validity_date < :today`);
    else if (f.stage) {
      where.push(`${STAGE_SQL} = :stage`);
      r.stage = f.stage;
    }
    if (f.from) {
      where.push(`${QUOTE_DATE_SQL} >= :from`);
      r.from = f.from;
    }
    if (f.to) {
      where.push(`${QUOTE_DATE_SQL} <= :to`);
      r.to = f.to;
    }
    words(f.search).forEach((w, i) => {
      where.push(
        `(q.quotation_number LIKE :s${i} OR q.customer_name LIKE :s${i} OR cu.display_name LIKE :s${i}
          OR q.contact_person_name LIKE :s${i} OR q.customer_po_number LIKE :s${i})`,
      );
      r[`s${i}`] = like(w);
    });
    const sqlWhere = where.join(' AND ');
    const order = f.stage === 'expiring' ? 'q.validity_date ASC, q.grand_total DESC' : 'q.created_at DESC, q.id DESC';
    const from = 'FROM quotations q LEFT JOIN customers cu ON cu.id = q.customer_id AND cu.company_id = q.company_id';
    const [[count], rows] = await Promise.all([
      this.q(`SELECT COUNT(*) AS n, COALESCE(SUM(q.grand_total), 0) AS v ${from} WHERE ${sqlWhere}`, r),
      this.q(
        `SELECT q.id, q.quotation_number AS number, DATE_FORMAT(${QUOTE_DATE_SQL}, '%Y-%m-%d') AS date,
                DATE_FORMAT(q.validity_date, '%Y-%m-%d') AS valid_till, ${STAGE_SQL} AS stage, q.customer_id,
                COALESCE(cu.display_name, q.customer_name) AS customer, q.grand_total AS total, q.customer_po_number AS po
         ${from} WHERE ${sqlWhere} ORDER BY ${order} LIMIT ${Math.max(1, Math.min(50, f.limit))}`,
        r,
      ),
    ]);
    return {
      total: num(count?.n),
      total_value: money(count?.v),
      quotations: rows.map((x) => ({
        id: num(x.id),
        number: x.number,
        date: x.date,
        valid_till: x.valid_till,
        stage: x.stage,
        customer_id: x.customer_id ? num(x.customer_id) : null,
        customer: text(x.customer),
        total: money(x.total),
        po: text(x.po),
      })),
    };
  }

  async quotation(companyId: number, id: number, tz: number) {
    const r = { c: companyId, id, tz };
    const [head] = await this.q(
      `SELECT q.id, q.quotation_number AS number, DATE_FORMAT(${QUOTE_DATE_SQL}, '%Y-%m-%d') AS date,
              DATE_FORMAT(q.validity_date, '%Y-%m-%d') AS valid_till, ${STAGE_SQL} AS stage, q.status, q.customer_id,
              COALESCE(cu.display_name, q.customer_name) AS customer, cu.po_required,
              q.contact_person_name, q.contact_person_phone, q.contact_person_email,
              q.sub_total, q.discount_amount, q.cgst_amount, q.sgst_amount, q.igst_amount, q.transport_charges, q.grand_total,
              q.notes, q.customer_po_number, DATE_FORMAT(q.customer_po_date, '%Y-%m-%d') AS customer_po_date,
              q.close_reason, q.close_remark, q.version_number, COALESCE(q.has_invoice, 0) AS has_invoice,
              u.first_name, u.last_name
       FROM quotations q
       LEFT JOIN customers cu ON cu.id = q.customer_id AND cu.company_id = q.company_id
       LEFT JOIN users u ON u.id = q.created_by
       WHERE q.id = :id AND q.company_id = :c AND ${LIVE_QUOTE}`,
      r,
    );
    if (!head) return null;
    const [items, challans, invoices] = await Promise.all([
      this.q(
        `SELECT product_name, hsn_code, qty, unit, rate, discount_percent, discounted_rate, total, qty_dispatched, qty_remaining
         FROM quotation_items WHERE quotation_id = :id ORDER BY id LIMIT 100`,
        r,
      ),
      this.q(
        `SELECT id, challan_number, status, DATE_FORMAT(challan_date, '%Y-%m-%d') AS date FROM delivery_challans
         WHERE company_id = :c AND quotation_id = :id AND COALESCE(is_active, 1) = 1 ORDER BY id`,
        r,
      ),
      this.q(
        `SELECT i.id, i.invoice_number, ${STATE_SQL} AS state, i.grand_total, i.balance_amount FROM invoices i
         WHERE i.company_id = :c AND i.quotation_id = :id ORDER BY i.id`,
        r,
      ),
    ]);
    const tax = money(num(head.cgst_amount) + num(head.sgst_amount) + num(head.igst_amount));
    return {
      id: num(head.id),
      number: head.number,
      date: head.date,
      valid_till: head.valid_till,
      stage: head.stage,
      status: head.status,
      customer_id: head.customer_id ? num(head.customer_id) : null,
      customer: text(head.customer),
      customer_needs_po: num(head.po_required) === 1,
      contact: { name: text(head.contact_person_name), phone: text(head.contact_person_phone), email: text(head.contact_person_email) },
      items: items.map((x) => ({
        name: x.product_name,
        hsn: text(x.hsn_code),
        qty: num(x.qty),
        unit: text(x.unit),
        rate: money(x.rate),
        discount_percent: num(x.discount_percent) || undefined,
        net_rate: num(x.discount_percent) ? money(x.discounted_rate) : undefined,
        amount: money(x.total),
        dispatched: num(x.qty_dispatched) || undefined,
      })),
      totals: {
        before_tax: money(head.sub_total),
        discount: money(head.discount_amount) || undefined,
        gst: tax,
        transport: money(head.transport_charges) || undefined,
        grand_total: money(head.grand_total),
      },
      notes: text(head.notes),
      customer_po: head.customer_po_number ? { number: head.customer_po_number, date: head.customer_po_date } : null,
      closed: head.close_reason ? { reason: head.close_reason, remark: text(head.close_remark) } : null,
      version: num(head.version_number) || 1,
      made_by: fullName(head.first_name, head.last_name),
      challans: challans.map((x) => ({ id: num(x.id), number: x.challan_number, status: x.status, date: x.date })),
      invoices: invoices.map((x) => ({ id: num(x.id), number: x.invoice_number, state: x.state, total: money(x.grand_total), balance: money(x.balance_amount) })),
    };
  }

  /** Enough of a quotation to describe an action on it. */
  async quotationBrief(companyId: number, id: number) {
    const [x] = await this.q(
      `SELECT q.id, q.quotation_number AS number, q.status, ${STAGE_SQL} AS stage, COALESCE(q.has_invoice, 0) AS has_invoice,
              COALESCE(cu.display_name, q.customer_name) AS customer, q.grand_total, cu.po_required
       FROM quotations q LEFT JOIN customers cu ON cu.id = q.customer_id AND cu.company_id = q.company_id
       WHERE q.id = :id AND q.company_id = :c AND ${LIVE_QUOTE}`,
      { c: companyId, id },
    );
    return x
      ? {
          id: num(x.id),
          number: String(x.number || `#${x.id}`),
          status: String(x.status || 'DRAFT'),
          stage: String(x.stage),
          invoiced: num(x.has_invoice) === 1,
          customer: text(x.customer) || 'no customer',
          total: money(x.grand_total),
          po_required: num(x.po_required) === 1,
        }
      : null;
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  async invoices(companyId: number, f: ListFilter & { state?: InvoiceState | null }) {
    const r: Record<string, unknown> = { c: companyId, today: f.today, soon: addDays(f.today, 7) };
    const where = ['i.company_id = :c'];
    const open = `${STATE_SQL} IN ('unpaid', 'partial')`;
    switch (f.state) {
      case 'cancelled':
        where.push(`${STATE_SQL} = 'cancelled'`);
        break;
      case 'open':
        where.push(open);
        break;
      case 'overdue':
        where.push(`${open} AND i.due_date < :today`);
        break;
      case 'due_soon':
        where.push(`${open} AND i.due_date BETWEEN :today AND :soon`);
        break;
      case 'unpaid':
      case 'partial':
      case 'paid':
        where.push(`${STATE_SQL} = :state`);
        r.state = f.state;
        break;
      default:
        where.push(LIVE_INVOICE);
    }
    if (f.customer_id) {
      where.push('i.customer_id = :cid');
      r.cid = f.customer_id;
    }
    if (f.from) {
      where.push('i.invoice_date >= :from');
      r.from = f.from;
    }
    if (f.to) {
      where.push('i.invoice_date <= :to');
      r.to = f.to;
    }
    words(f.search).forEach((w, i) => {
      where.push(`(i.invoice_number LIKE :s${i} OR i.customer_name LIKE :s${i} OR i.quotation_number LIKE :s${i} OR i.contact_person_name LIKE :s${i})`);
      r[`s${i}`] = like(w);
    });
    const sqlWhere = where.join(' AND ');
    const order = f.state === 'overdue' || f.state === 'due_soon' ? 'i.due_date ASC, i.balance_amount DESC' : 'i.invoice_date DESC, i.id DESC';
    const [[count], rows] = await Promise.all([
      this.q(
        `SELECT COUNT(*) AS n, COALESCE(SUM(i.grand_total), 0) AS v, COALESCE(SUM(CASE WHEN ${open} THEN i.balance_amount ELSE 0 END), 0) AS b
         FROM invoices i WHERE ${sqlWhere}`,
        r,
      ),
      this.q(
        `SELECT i.id, i.invoice_number AS number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due,
                ${STATE_SQL} AS state, i.customer_id, i.customer_name AS customer, i.grand_total AS total, i.paid_amount AS paid,
                i.balance_amount AS balance, CASE WHEN i.due_date < :today AND ${open} THEN DATEDIFF(:today, i.due_date) END AS days_late
         FROM invoices i WHERE ${sqlWhere} ORDER BY ${order} LIMIT ${Math.max(1, Math.min(50, f.limit))}`,
        r,
      ),
    ]);
    return {
      total: num(count?.n),
      billed: money(count?.v),
      balance_due: money(count?.b),
      invoices: rows.map((x) => ({
        id: num(x.id),
        number: x.number,
        date: x.date,
        due: x.due,
        state: x.state,
        customer_id: x.customer_id ? num(x.customer_id) : null,
        customer: text(x.customer),
        total: money(x.total),
        paid: money(x.paid),
        balance: money(x.balance),
        days_late: x.days_late === null || x.days_late === undefined ? undefined : num(x.days_late),
      })),
    };
  }

  async invoice(companyId: number, id: number) {
    const r = { c: companyId, id };
    const [head] = await this.q(
      `SELECT i.id, i.invoice_number AS number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due,
              ${STATE_SQL} AS state, i.status, i.customer_id, i.customer_name, i.customer_gst_number, i.contact_person_name, i.contact_person_phone,
              i.quotation_id, i.quotation_number, i.sub_total, i.discount_amount, i.cgst_amount, i.sgst_amount, i.igst_amount,
              i.transport_charges, i.grand_total, i.paid_amount, i.balance_amount, i.payment_terms, i.notes,
              i.vehicle_number, i.eway_bill_number
       FROM invoices i WHERE i.id = :id AND i.company_id = :c`,
      r,
    );
    if (!head) return null;
    const [items, payments] = await Promise.all([
      this.q(`SELECT product_name, hsn_code, qty, unit, rate, discount_percent, total FROM invoice_items WHERE invoice_id = :id ORDER BY id LIMIT 100`, r),
      this.q(
        `SELECT DATE_FORMAT(payment_date, '%Y-%m-%d') AS date, payment_amount, payment_mode, transaction_reference
         FROM invoice_payments WHERE invoice_id = :id ORDER BY payment_date, id`,
        r,
      ),
    ]);
    return {
      id: num(head.id),
      number: head.number,
      date: head.date,
      due: head.due,
      state: head.state,
      customer_id: head.customer_id ? num(head.customer_id) : null,
      customer: text(head.customer_name),
      customer_gst: text(head.customer_gst_number),
      contact: { name: text(head.contact_person_name), phone: text(head.contact_person_phone) },
      quotation: head.quotation_id ? { id: num(head.quotation_id), number: text(head.quotation_number) } : null,
      items: items.map((x) => ({
        name: x.product_name,
        hsn: text(x.hsn_code),
        qty: num(x.qty),
        unit: text(x.unit),
        rate: money(x.rate),
        discount_percent: num(x.discount_percent) || undefined,
        amount: money(x.total),
      })),
      totals: {
        before_tax: money(head.sub_total),
        discount: money(head.discount_amount) || undefined,
        gst: money(num(head.cgst_amount) + num(head.sgst_amount) + num(head.igst_amount)),
        transport: money(head.transport_charges) || undefined,
        grand_total: money(head.grand_total),
        paid: money(head.paid_amount),
        balance: money(head.balance_amount),
      },
      payments: payments.map((p) => ({ date: p.date, amount: money(p.payment_amount), mode: p.payment_mode, reference: text(p.transaction_reference) })),
      payment_terms: text(head.payment_terms),
      vehicle: text(head.vehicle_number),
      eway_bill: text(head.eway_bill_number),
      notes: text(head.notes),
    };
  }

  async invoiceBrief(companyId: number, id: number) {
    const [x] = await this.q(
      `SELECT i.id, i.invoice_number AS number, ${STATE_SQL} AS state, i.customer_name, i.grand_total, i.paid_amount, i.balance_amount
       FROM invoices i WHERE i.id = :id AND i.company_id = :c`,
      { c: companyId, id },
    );
    return x
      ? {
          id: num(x.id),
          number: String(x.number || `#${x.id}`),
          state: String(x.state),
          customer: text(x.customer_name) || 'no customer',
          total: money(x.grand_total),
          paid: money(x.paid_amount),
          balance: money(x.balance_amount),
        }
      : null;
  }

  // ── Delivery challans ──────────────────────────────────────────────────────

  async challans(companyId: number, f: ListFilter & { state?: ChallanState | null }) {
    const r: Record<string, unknown> = { c: companyId };
    const where = ['dc.company_id = :c', 'COALESCE(dc.is_active, 1) = 1'];
    if (f.state === 'to_invoice') where.push(TO_INVOICE_SQL);
    else if (f.state) {
      where.push('dc.status = :st');
      r.st = f.state.toUpperCase();
    }
    if (f.customer_id) {
      where.push('dc.customer_id = :cid');
      r.cid = f.customer_id;
    }
    if (f.from) {
      where.push('dc.challan_date >= :from');
      r.from = f.from;
    }
    if (f.to) {
      where.push('dc.challan_date <= :to');
      r.to = f.to;
    }
    words(f.search).forEach((w, i) => {
      where.push(`(dc.challan_number LIKE :s${i} OR dc.customer_name LIKE :s${i} OR dc.vehicle_number LIKE :s${i} OR q.quotation_number LIKE :s${i})`);
      r[`s${i}`] = like(w);
    });
    const sqlWhere = where.join(' AND ');
    const from = `FROM delivery_challans dc
      LEFT JOIN quotations q ON q.id = dc.quotation_id AND q.company_id = dc.company_id
      LEFT JOIN invoices i ON i.id = dc.invoice_id AND i.company_id = dc.company_id`;
    const [[count], rows] = await Promise.all([
      this.q(`SELECT COUNT(*) AS n ${from} WHERE ${sqlWhere}`, r),
      this.q(
        `SELECT dc.id, dc.challan_number AS number, DATE_FORMAT(dc.challan_date, '%Y-%m-%d') AS date, dc.status, dc.reason,
                dc.customer_id, dc.customer_name AS customer, dc.total_quantity AS qty, dc.total_value AS value,
                dc.quotation_id, q.quotation_number, dc.invoice_id, i.invoice_number
         ${from} WHERE ${sqlWhere} ORDER BY dc.challan_date DESC, dc.id DESC LIMIT ${Math.max(1, Math.min(50, f.limit))}`,
        r,
      ),
    ]);
    return {
      total: num(count?.n),
      challans: rows.map((x) => ({
        id: num(x.id),
        number: x.number,
        date: x.date,
        status: x.status,
        reason: x.reason,
        customer_id: x.customer_id ? num(x.customer_id) : null,
        customer: text(x.customer),
        qty: num(x.qty),
        value: money(x.value),
        quotation: x.quotation_id ? { id: num(x.quotation_id), number: text(x.quotation_number) } : null,
        invoice: x.invoice_id ? { id: num(x.invoice_id), number: text(x.invoice_number) } : null,
      })),
    };
  }

  async challan(companyId: number, id: number) {
    const r = { c: companyId, id };
    const [head] = await this.q(
      `SELECT dc.id, dc.challan_number AS number, DATE_FORMAT(dc.challan_date, '%Y-%m-%d') AS date, dc.status, dc.reason,
              dc.customer_id, dc.customer_name, dc.place_of_supply, dc.transporter_name, dc.vehicle_number, dc.eway_bill_number,
              dc.notes, dc.total_quantity, dc.total_value, dc.affects_stock, dc.quotation_id, q.quotation_number,
              dc.invoice_id, i.invoice_number, wf.name AS from_warehouse, wt.name AS to_warehouse,
              DATE_FORMAT(dc.dispatched_at, '%Y-%m-%d') AS dispatched_on, DATE_FORMAT(dc.delivered_at, '%Y-%m-%d') AS delivered_on
       FROM delivery_challans dc
       LEFT JOIN quotations q ON q.id = dc.quotation_id AND q.company_id = dc.company_id
       LEFT JOIN invoices i ON i.id = dc.invoice_id AND i.company_id = dc.company_id
       LEFT JOIN warehouses wf ON wf.id = dc.from_warehouse_id
       LEFT JOIN warehouses wt ON wt.id = dc.to_warehouse_id
       WHERE dc.id = :id AND dc.company_id = :c AND COALESCE(dc.is_active, 1) = 1`,
      r,
    );
    if (!head) return null;
    const items = await this.q(
      `SELECT item_name, hsn_code, quantity, unit, rate, value FROM delivery_challan_items WHERE delivery_challan_id = :id ORDER BY id LIMIT 100`,
      r,
    );
    return {
      id: num(head.id),
      number: head.number,
      date: head.date,
      status: head.status,
      reason: head.reason,
      customer_id: head.customer_id ? num(head.customer_id) : null,
      customer: text(head.customer_name),
      from_warehouse: text(head.from_warehouse),
      to_warehouse: text(head.to_warehouse),
      moves_stock: num(head.affects_stock) === 1,
      transport: { transporter: text(head.transporter_name), vehicle: text(head.vehicle_number), eway_bill: text(head.eway_bill_number) },
      dispatched_on: head.dispatched_on,
      delivered_on: head.delivered_on,
      quotation: head.quotation_id ? { id: num(head.quotation_id), number: text(head.quotation_number) } : null,
      invoice: head.invoice_id ? { id: num(head.invoice_id), number: text(head.invoice_number) } : null,
      items: items.map((x) => ({ name: x.item_name, hsn: text(x.hsn_code), qty: num(x.quantity), unit: text(x.unit), rate: money(x.rate), value: money(x.value) })),
      total_qty: num(head.total_quantity),
      total_value: money(head.total_value),
      notes: text(head.notes),
    };
  }

  async challanBrief(companyId: number, id: number) {
    const [x] = await this.q(
      `SELECT dc.id, dc.challan_number AS number, dc.status, dc.customer_name, dc.total_quantity, dc.affects_stock, w.name AS from_warehouse
       FROM delivery_challans dc LEFT JOIN warehouses w ON w.id = dc.from_warehouse_id
       WHERE dc.id = :id AND dc.company_id = :c AND COALESCE(dc.is_active, 1) = 1`,
      { c: companyId, id },
    );
    return x
      ? {
          id: num(x.id),
          number: String(x.number || `#${x.id}`),
          status: String(x.status),
          customer: text(x.customer_name) || 'no customer',
          qty: num(x.total_quantity),
          moves_stock: num(x.affects_stock) === 1,
          from_warehouse: text(x.from_warehouse),
        }
      : null;
  }

  // ── Customers, products, warehouses (names for cards) ─────────────────────

  async customerBrief(companyId: number, id: number) {
    const [x] = await this.q(
      `SELECT c.id, c.display_name, c.customer_type,
              (SELECT COUNT(*) FROM quotations q WHERE q.company_id = c.company_id AND q.customer_id = c.id AND COALESCE(q.status, '') <> 'DELETED') AS quotations,
              (SELECT COUNT(*) FROM invoices i WHERE i.company_id = c.company_id AND i.customer_id = c.id AND ${LIVE_INVOICE}) AS invoices
       FROM customers c WHERE c.id = :id AND c.company_id = :c AND c.is_active = 1`,
      { c: companyId, id },
    );
    return x ? { id: num(x.id), name: String(x.display_name || `Customer #${x.id}`), quotations: num(x.quotations), invoices: num(x.invoices) } : null;
  }

  async productNames(companyId: number, ids: number[]) {
    if (!ids.length) return new Map<number, { name: string; unit: string | null }>();
    const rows = await this.q(`SELECT id, name, unit FROM products WHERE company_id = :c AND is_active = 1 AND id IN (:ids)`, { c: companyId, ids });
    return new Map(rows.map((r) => [num(r.id), { name: String(r.name), unit: text(r.unit) }]));
  }

  /** GST rates of the active products with these names (any case). */
  async productGstRates(companyId: number, names: string[]): Promise<number[]> {
    const keys = [...new Set(names.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
    if (!keys.length) return [];
    const rows = await this.q(
      `SELECT DISTINCT tax_percentage AS r FROM products
       WHERE company_id = :c AND is_active = 1 AND LOWER(TRIM(name)) IN (:keys) AND tax_percentage IS NOT NULL`,
      { c: companyId, keys },
    );
    return [...new Set(rows.map((x) => Number(x.r)).filter((n) => Number.isFinite(n) && n > 0))];
  }

  /** The company's warehouses among these ids (archived ones too). */
  async warehouseNames(companyId: number, ids: number[]) {
    if (!ids.length) return new Map<number, { name: string; active: boolean }>();
    const rows = await this.q(`SELECT id, name, is_active FROM warehouses WHERE company_id = :c AND id IN (:ids)`, { c: companyId, ids });
    return new Map(rows.map((r) => [num(r.id), { name: String(r.name), active: num(r.is_active) === 1 }]));
  }

  /** Stock of these products in one warehouse. */
  async stockIn(warehouseId: number, productIds: number[]) {
    if (!productIds.length) return new Map<number, number>();
    const rows = await this.q(
      `SELECT product_id, COALESCE(SUM(stock_level), 0) AS qty FROM product_inventory
       WHERE warehouse_id = :w AND is_active = 1 AND product_id IN (:ids) GROUP BY product_id`,
      { w: warehouseId, ids: productIds },
    );
    return new Map(rows.map((r) => [num(r.product_id), num(r.qty)]));
  }
}
