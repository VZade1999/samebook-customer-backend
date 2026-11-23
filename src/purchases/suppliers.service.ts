import { Injectable } from '@nestjs/common';
import { OPEN_STATUSES, PURCHASE_PERMS, SupplierInput, pageOf, parseSupplier, round2, sameName, searchTerm } from './purchase.rules';
import { PurchaseDb, PurchaseUser, bad, can, notFound } from './purchase-db';

/** When a bill must be paid, in SQL: micro and small suppliers within 45 days, else the due date. */
export const PAY_BY_SQL = (b: string, s: string) =>
  `(CASE WHEN ${s}.msme_type IN ('MICRO', 'SMALL')
      THEN LEAST(COALESCE(${b}.due_date, DATE_ADD(${b}.bill_date, INTERVAL 45 DAY)), DATE_ADD(${b}.bill_date, INTERVAL 45 DAY))
      ELSE COALESCE(${b}.due_date, ${b}.bill_date) END)`;

const OPEN_IN = OPEN_STATUSES.map((s) => `'${s}'`).join(', ');

@Injectable()
export class SuppliersService {
  constructor(private readonly db: PurchaseDb) {}

  // ── Lists ────────────────────────────────────────────────────────────────

  /** Suppliers with what is on order and what you owe them. */
  async list(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchTerm(query?.q);
    const status = String(query?.status || 'active').toLowerCase();
    const where = [`s.company_id = :c`];
    if (status === 'active') where.push('s.is_active = 1');
    else if (status === 'archived') where.push('s.is_active = 0');
    if (q) where.push('(s.name LIKE :q OR s.legal_name LIKE :q OR s.gstin LIKE :q OR s.phone LIKE :q)');
    const sort = String(query?.sort || 'name');
    const order =
      sort === 'payable' ? 'payable DESC, s.name' : sort === 'recent' ? 'last_po_date IS NULL, last_po_date DESC, s.name' : 's.name';
    const today = this.db.today();
    const rep = { c, q: q ? `%${q}%` : null, today, limit, offset };
    const base = `FROM suppliers s WHERE ${where.join(' AND ')}`;
    const rows = await this.db.sel(
      `SELECT s.id, s.name, s.legal_name, s.gst_type, s.gstin, s.state, s.state_code, s.phone, s.email, s.msme_type, s.credit_days, s.is_active,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.company_id = :c AND po.status IN (${OPEN_IN})) AS open_pos,
              (SELECT COALESCE(SUM(po.grand_total), 0) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.company_id = :c AND po.status IN (${OPEN_IN})) AS open_value,
              (SELECT MAX(po.po_date) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.company_id = :c AND po.status <> 'CANCELLED') AS last_po_date,
              (SELECT COALESCE(SUM(b.balance_amount), 0) FROM purchase_bills b WHERE b.supplier_id = s.id AND b.company_id = :c AND b.status IN ('UNPAID', 'PARTLY_PAID')) AS payable,
              (SELECT COALESCE(SUM(b.balance_amount), 0) FROM purchase_bills b WHERE b.supplier_id = s.id AND b.company_id = :c AND b.status IN ('UNPAID', 'PARTLY_PAID') AND ${PAY_BY_SQL('b', 's')} < :today) AS overdue
         ${base} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
      rep,
    );
    const total = await this.db.one(`SELECT COUNT(*) AS n ${base}`, rep);
    const money = can(user, PURCHASE_PERMS.view) || can(user, PURCHASE_PERMS.bills);
    return {
      page,
      limit,
      total: Number(total?.n || 0),
      rows: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        legal_name: r.legal_name,
        gst_type: r.gst_type,
        gstin: r.gstin,
        state: r.state,
        state_code: r.state_code,
        phone: r.phone,
        email: r.email,
        msme_type: r.msme_type,
        credit_days: r.credit_days === null ? null : Number(r.credit_days),
        is_active: Number(r.is_active) === 1,
        open_pos: Number(r.open_pos || 0),
        last_po_date: r.last_po_date || null,
        open_value: money ? round2(r.open_value) : null,
        payable: money ? round2(r.payable) : null,
        overdue: money ? round2(r.overdue) : null,
      })),
    };
  }

  /** Totals for the Suppliers page hero. */
  async summary(user: PurchaseUser) {
    const c = user.company_id;
    const today = this.db.today();
    const row = await this.db.one(
      `SELECT
         (SELECT COUNT(*) FROM suppliers WHERE company_id = :c AND is_active = 1) AS suppliers,
         (SELECT COUNT(*) FROM suppliers WHERE company_id = :c AND is_active = 1 AND msme_type IN ('MICRO', 'SMALL')) AS msme,
         (SELECT COALESCE(SUM(b.balance_amount), 0) FROM purchase_bills b WHERE b.company_id = :c AND b.status IN ('UNPAID', 'PARTLY_PAID')) AS payable,
         (SELECT COALESCE(SUM(b.balance_amount), 0) FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
           WHERE b.company_id = :c AND b.status IN ('UNPAID', 'PARTLY_PAID') AND ${PAY_BY_SQL('b', 's')} < :today) AS overdue,
         (SELECT COALESCE(SUM(po.grand_total), 0) FROM purchase_orders po WHERE po.company_id = :c AND po.status IN (${OPEN_IN})) AS on_order`,
      { c, today },
    );
    const money = can(user, PURCHASE_PERMS.view) || can(user, PURCHASE_PERMS.bills);
    return {
      suppliers: Number(row?.suppliers || 0),
      msme: Number(row?.msme || 0),
      payable: money ? round2(row?.payable) : null,
      overdue: money ? round2(row?.overdue) : null,
      on_order: money ? round2(row?.on_order) : null,
    };
  }

  /** Active suppliers for pickers (PO and bill forms), with their addresses. */
  async options(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const q = searchTerm(query?.q);
    const id = Number(query?.id) || null;
    const rows = await this.db.sel(
      `SELECT id, name, legal_name, gst_type, gstin, state, state_code, msme_type, credit_days
         FROM suppliers WHERE company_id = :c AND ${id ? 'id = :id' : 'is_active = 1'}
         ${q && !id ? 'AND (name LIKE :q OR legal_name LIKE :q OR gstin LIKE :q)' : ''}
        ORDER BY name LIMIT 30`,
      { c, q: q ? `%${q}%` : null, id },
    );
    const ids = rows.map((r) => Number(r.id));
    const addresses = ids.length
      ? await this.db.sel(`SELECT id, supplier_id, label, address_line_1, city, state, state_code, gstin, is_primary FROM supplier_addresses WHERE supplier_id IN (:ids) ORDER BY is_primary DESC, id`, { ids })
      : [];
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      legal_name: r.legal_name,
      gst_type: r.gst_type,
      gstin: r.gstin,
      state: r.state,
      state_code: r.state_code,
      msme_type: r.msme_type,
      credit_days: r.credit_days === null ? null : Number(r.credit_days),
      addresses: addresses
        .filter((a) => Number(a.supplier_id) === Number(r.id))
        .map((a) => ({ id: Number(a.id), label: a.label, line: [a.address_line_1, a.city].filter(Boolean).join(', '), state: a.state, state_code: a.state_code, gstin: a.gstin, is_primary: Number(a.is_primary) === 1 })),
    }));
  }

  // ── One supplier ─────────────────────────────────────────────────────────

  private async row(companyId: number, id: number, t?: any) {
    const s = await this.db.one('SELECT * FROM suppliers WHERE id = :id AND company_id = :c', { id, c: companyId }, t);
    if (!s) throw notFound('Supplier');
    return s;
  }

  /** The supplier's profile: details, addresses, contacts, orders, bills and payments. */
  async get(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const s = await this.row(c, id);
    const today = this.db.today();
    const [addresses, contacts, pos, bills, payments, advance] = await Promise.all([
      this.db.sel('SELECT * FROM supplier_addresses WHERE supplier_id = :id ORDER BY is_primary DESC, id', { id }),
      this.db.sel('SELECT * FROM supplier_contacts WHERE supplier_id = :id ORDER BY is_primary DESC, id', { id }),
      this.db.sel(
        `SELECT id, po_number, po_date, expected_date, status, grand_total FROM purchase_orders
          WHERE company_id = :c AND supplier_id = :id ORDER BY po_date DESC, id DESC LIMIT 10`,
        { c, id },
      ),
      this.db.sel(
        `SELECT b.id, b.bill_number, b.bill_date, b.due_date, b.grand_total, b.balance_amount, b.status, ${PAY_BY_SQL('b', 's')} AS pay_by
           FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.company_id = :c AND b.supplier_id = :id AND b.status <> 'CANCELLED'
          ORDER BY (b.status IN ('UNPAID', 'PARTLY_PAID')) DESC, b.bill_date DESC, b.id DESC LIMIT 15`,
        { c, id },
      ),
      this.db.sel(
        `SELECT id, payment_date, amount, mode, reference, status FROM supplier_payments
          WHERE company_id = :c AND supplier_id = :id ORDER BY payment_date DESC, id DESC LIMIT 10`,
        { c, id },
      ),
      this.advance(c, id),
    ]);
    const money = can(user, PURCHASE_PERMS.view) || can(user, PURCHASE_PERMS.bills);
    const stats = await this.db.one(
      `SELECT
         (SELECT COALESCE(SUM(grand_total), 0) FROM purchase_orders WHERE company_id = :c AND supplier_id = :id AND status IN (${OPEN_IN})) AS on_order,
         (SELECT COALESCE(SUM(balance_amount), 0) FROM purchase_bills WHERE company_id = :c AND supplier_id = :id AND status IN ('UNPAID', 'PARTLY_PAID')) AS payable,
         (SELECT COALESCE(SUM(grand_total), 0) FROM purchase_bills WHERE company_id = :c AND supplier_id = :id AND status <> 'CANCELLED' AND bill_date >= :fy) AS billed_this_year`,
      { c, id, fy: `${today.slice(5, 7) >= '04' ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1)}-04-01` },
    );
    return {
      ...this.view(s),
      addresses: addresses.map((a) => ({
        id: Number(a.id),
        label: a.label,
        address_line_1: a.address_line_1,
        address_line_2: a.address_line_2,
        city: a.city,
        state: a.state,
        state_code: a.state_code,
        postal_code: a.postal_code,
        country: a.country,
        gstin: a.gstin,
        is_primary: Number(a.is_primary) === 1,
      })),
      contacts: contacts.map((x) => ({ id: Number(x.id), name: x.name, designation: x.designation, phone: x.phone, email: x.email, is_primary: Number(x.is_primary) === 1 })),
      stats: money
        ? { on_order: round2(stats?.on_order), payable: round2(stats?.payable), billed_this_year: round2(stats?.billed_this_year), advance }
        : null,
      purchase_orders: pos.map((p) => ({
        id: Number(p.id),
        po_number: p.po_number,
        po_date: p.po_date,
        expected_date: p.expected_date,
        status: p.status,
        grand_total: money ? round2(p.grand_total) : null,
      })),
      bills: money
        ? bills.map((b) => ({
            id: Number(b.id),
            bill_number: b.bill_number,
            bill_date: b.bill_date,
            pay_by: b.pay_by,
            grand_total: round2(b.grand_total),
            balance_amount: round2(b.balance_amount),
            status: b.status,
            overdue: ['UNPAID', 'PARTLY_PAID'].includes(b.status) && String(b.pay_by) < today,
          }))
        : [],
      payments: money ? payments.map((p) => ({ id: Number(p.id), payment_date: p.payment_date, amount: round2(p.amount), mode: p.mode, reference: p.reference, status: p.status })) : [],
    };
  }

  /** Money paid to the supplier that isn't against any bill yet (advances). */
  async advance(companyId: number, supplierId: number, t?: any): Promise<number> {
    const r = await this.db.one(
      `SELECT COALESCE(SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = p.id), 0)), 0) AS left_over
         FROM supplier_payments p WHERE p.company_id = :c AND p.supplier_id = :s AND p.status = 'ACTIVE'`,
      { c: companyId, s: supplierId },
      t,
    );
    return Math.max(0, round2(r?.left_over));
  }

  private view(s: any) {
    return {
      id: Number(s.id),
      name: s.name,
      legal_name: s.legal_name,
      gst_type: s.gst_type,
      gstin: s.gstin,
      pan: s.pan,
      state: s.state,
      state_code: s.state_code,
      phone: s.phone,
      email: s.email,
      msme_type: s.msme_type,
      udyam_number: s.udyam_number,
      credit_days: s.credit_days === null ? null : Number(s.credit_days),
      bank_account_name: s.bank_account_name,
      bank_account_number: s.bank_account_number,
      bank_ifsc: s.bank_ifsc,
      bank_name: s.bank_name,
      upi_id: s.upi_id,
      notes: s.notes,
      is_active: Number(s.is_active) === 1,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  // ── Changes ──────────────────────────────────────────────────────────────

  /** Another active supplier with the same GSTIN or name → why it's a duplicate. */
  private async duplicate(companyId: number, v: SupplierInput, exceptId: number | null, t: any): Promise<string | null> {
    if (v.gstin) {
      const g = await this.db.one(
        `SELECT name FROM suppliers WHERE company_id = :c AND is_active = 1 AND gstin = :g ${exceptId ? 'AND id <> :id' : ''} LIMIT 1`,
        { c: companyId, g: v.gstin, id: exceptId },
        t,
      );
      if (g) return `${g.name} already has GSTIN ${v.gstin}`;
    }
    const same = await this.db.sel(`SELECT id, name FROM suppliers WHERE company_id = :c AND is_active = 1 ${exceptId ? 'AND id <> :id' : ''}`, { c: companyId, id: exceptId }, t);
    const clash = same.find((r) => sameName(r.name, v.name));
    return clash ? `There is already a supplier called ${clash.name}` : null;
  }

  private async saveChildren(supplierId: number, v: SupplierInput, t: any) {
    await this.db.run('DELETE FROM supplier_addresses WHERE supplier_id = :id', { id: supplierId }, t);
    await this.db.run('DELETE FROM supplier_contacts WHERE supplier_id = :id', { id: supplierId }, t);
    for (const a of v.addresses) {
      await this.db.insert(
        `INSERT INTO supplier_addresses (supplier_id, label, address_line_1, address_line_2, city, state, state_code, postal_code, country, gstin, is_primary)
         VALUES (:s, :label, :l1, :l2, :city, :state, :code, :pin, :country, :gstin, :primary)`,
        { s: supplierId, label: a.label, l1: a.address_line_1, l2: a.address_line_2, city: a.city, state: a.state, code: a.state_code, pin: a.postal_code, country: a.country, gstin: a.gstin, primary: a.is_primary },
        t,
      );
    }
    for (const x of v.contacts) {
      await this.db.insert(
        `INSERT INTO supplier_contacts (supplier_id, name, designation, phone, email, is_primary) VALUES (:s, :name, :des, :phone, :email, :primary)`,
        { s: supplierId, name: x.name, des: x.designation, phone: x.phone, email: x.email, primary: x.is_primary },
        t,
      );
    }
  }

  private fields(v: SupplierInput) {
    return {
      name: v.name,
      legal_name: v.legal_name,
      gst_type: v.gst_type,
      gstin: v.gstin,
      pan: v.pan,
      state: v.state,
      state_code: v.state_code,
      phone: v.phone,
      email: v.email,
      msme_type: v.msme_type,
      udyam_number: v.udyam_number,
      credit_days: v.credit_days,
      bank_account_name: v.bank_account_name,
      bank_account_number: v.bank_account_number,
      bank_ifsc: v.bank_ifsc,
      bank_name: v.bank_name,
      upi_id: v.upi_id,
      notes: v.notes,
    };
  }

  async create(user: PurchaseUser, body: any) {
    const parsed = parseSupplier(body);
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const id = await this.db.tx(async (t) => {
      const dup = await this.duplicate(user.company_id, v, null, t);
      if (dup) throw bad(dup);
      const f = this.fields(v);
      const cols = Object.keys(f);
      const newId = await this.db.insert(
        `INSERT INTO suppliers (company_id, ${cols.join(', ')}, is_active, created_by, updated_by)
         VALUES (:company_id, ${cols.map((k) => `:${k}`).join(', ')}, 1, :u, :u)`,
        { company_id: user.company_id, ...f, u: user.user_id },
        t,
      );
      await this.saveChildren(newId, v, t);
      return newId;
    });
    return this.get(user, id);
  }

  async update(user: PurchaseUser, id: number, body: any) {
    const parsed = parseSupplier(body);
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    await this.db.tx(async (t) => {
      const s = await this.row(user.company_id, id, t);
      if (Number(s.is_active) !== 1) throw bad('This supplier is archived — restore it first');
      const dup = await this.duplicate(user.company_id, v, id, t);
      if (dup) throw bad(dup);
      const f = this.fields(v);
      await this.db.run(
        `UPDATE suppliers SET ${Object.keys(f).map((k) => `${k} = :${k}`).join(', ')}, updated_by = :u WHERE id = :id AND company_id = :c`,
        { ...f, u: user.user_id, id, c: user.company_id },
        t,
      );
      await this.saveChildren(id, v, t);
    });
    return this.get(user, id);
  }

  /** Archive: only when nothing is still on order or owed. */
  async archive(user: PurchaseUser, id: number) {
    await this.db.tx(async (t) => {
      const s = await this.row(user.company_id, id, t);
      if (Number(s.is_active) !== 1) return;
      const open = await this.db.one(
        `SELECT (SELECT COUNT(*) FROM purchase_orders WHERE company_id = :c AND supplier_id = :id AND status IN ('DRAFT', 'PENDING_APPROVAL', ${OPEN_IN})) AS pos,
                (SELECT COUNT(*) FROM purchase_bills WHERE company_id = :c AND supplier_id = :id AND status IN ('UNPAID', 'PARTLY_PAID')) AS bills`,
        { c: user.company_id, id },
        t,
      );
      if (Number(open?.pos)) throw bad(`${s.name} still has ${open.pos} open purchase order${Number(open.pos) > 1 ? 's' : ''} — close or cancel them first`);
      if (Number(open?.bills)) throw bad(`${s.name} still has unpaid bills — settle them first`);
      await this.db.run('UPDATE suppliers SET is_active = 0, updated_by = :u WHERE id = :id AND company_id = :c', { u: user.user_id, id, c: user.company_id }, t);
    });
    return { id, archived: true };
  }

  async restore(user: PurchaseUser, id: number) {
    await this.db.tx(async (t) => {
      const s = await this.row(user.company_id, id, t);
      if (Number(s.is_active) === 1) return;
      const dup = await this.duplicate(user.company_id, { ...(s as any), gstin: s.gstin, name: s.name } as SupplierInput, id, t);
      if (dup) throw bad(`Can't restore: ${dup}`);
      await this.db.run('UPDATE suppliers SET is_active = 1, updated_by = :u WHERE id = :id AND company_id = :c', { u: user.user_id, id, c: user.company_id }, t);
    });
    return { id, archived: false };
  }
}
