import { Injectable } from '@nestjs/common';
import { companyTaxesTransport } from '../common/transport-gst';
import {
  DEFAULT_GST,
  PURCHASE_PERMS,
  ReceiptLedgerRow,
  SOON_DAYS,
  addDays,
  allocatePayment,
  billAlerts,
  billStatus,
  docTotals,
  fyOf,
  hsnSummary,
  overBilled,
  pageOf,
  parseBillFilter,
  parseBillHeader,
  parseLines,
  parsePayment,
  parseReason,
  placeCodeFrom,
  purchaseTaxType,
  rateDifferences,
  round2,
  round3,
  searchTerm,
} from './purchase.rules';
import { PurchaseDb, PurchaseUser, bad, can, isoTime, notFound, parseJson } from './purchase-db';
import { PAY_BY_SQL, SuppliersService } from './suppliers.service';

const LEDGER_SQL = `
  SELECT i.id AS po_item_id, i.item_name, i.product_id, i.unit, i.qty AS ordered, i.rate, i.discount_percent, i.gst_rate, i.hsn_code,
         COALESCE((SELECT SUM(g.accepted_qty) FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id
                    WHERE g.po_item_id = i.id AND r.status = 'RECEIVED'), 0) AS received,
         COALESCE((SELECT SUM(bi.qty) FROM purchase_bill_items bi JOIN purchase_bills b ON b.id = bi.bill_id
                    WHERE bi.po_item_id = i.id AND b.status <> 'CANCELLED'), 0) AS billed
    FROM purchase_order_items i WHERE i.po_id = :po ORDER BY i.line_no, i.id`;

const OPEN_BILL = `('UNPAID', 'PARTLY_PAID')`;
const fyRange = (iso: string) => {
  const fy = fyOf(iso);
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, fy };
};

@Injectable()
export class PurchaseBillsService {
  constructor(
    private readonly db: PurchaseDb,
    private readonly suppliers: SuppliersService,
  ) {}

  private money(user: PurchaseUser) {
    return can(user, PURCHASE_PERMS.view) || can(user, PURCHASE_PERMS.bills);
  }

  // ── Lists ────────────────────────────────────────────────────────────────

  async list(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const today = this.db.today();
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const filter = parseBillFilter(query?.status);
    const q = searchTerm(query?.q);
    const where = ['b.company_id = :c'];
    const payBy = PAY_BY_SQL('b', 's');
    if (filter === 'UNPAID') where.push(`b.status IN ${OPEN_BILL}`);
    else if (filter === 'OVERDUE') where.push(`b.status IN ${OPEN_BILL} AND ${payBy} < :today`);
    else if (filter === 'DUE_SOON') where.push(`b.status IN ${OPEN_BILL} AND ${payBy} BETWEEN :today AND :soon`);
    else if (filter === 'MSME') where.push(`b.status IN ${OPEN_BILL} AND s.msme_type IN ('MICRO', 'SMALL')`);
    else if (filter === 'PAID') where.push(`b.status = 'PAID'`);
    else if (filter === 'CANCELLED') where.push(`b.status = 'CANCELLED'`);
    else where.push(`b.status <> 'CANCELLED'`);
    if (Number(query?.supplier_id) > 0) where.push('b.supplier_id = :supplier');
    if (q) where.push('(b.bill_number LIKE :q OR s.name LIKE :q OR po.po_number LIKE :q)');
    const rep = { c, today, soon: addDays(today, SOON_DAYS), supplier: Number(query?.supplier_id) || null, q: q ? `%${q}%` : null, limit, offset };
    const from = `FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id LEFT JOIN purchase_orders po ON po.id = b.po_id WHERE ${where.join(' AND ')}`;
    const rows = await this.db.sel(
      `SELECT b.id, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bill_date, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due_date,
              DATE_FORMAT(${payBy}, '%Y-%m-%d') AS pay_by, b.supplier_id, s.name AS supplier_name, s.msme_type, b.po_id, po.po_number,
              b.grand_total, b.paid_amount, b.balance_amount, b.status
         ${from} ORDER BY (b.status IN ${OPEN_BILL}) DESC, ${payBy} ASC, b.id DESC LIMIT :limit OFFSET :offset`,
      rep,
    );
    const total = await this.db.one(`SELECT COUNT(*) AS n ${from}`, rep);
    return {
      page,
      limit,
      total: Number(total?.n || 0),
      rows: rows.map((r) => this.rowView(r, today)),
    };
  }

  private rowView(r: any, today: string) {
    const alerts = billAlerts({ bill_date: r.bill_date, due_date: r.due_date, balance_amount: r.balance_amount, status: r.status }, r.msme_type, today);
    return {
      id: Number(r.id),
      bill_number: r.bill_number,
      bill_date: r.bill_date,
      due_date: r.due_date,
      pay_by: r.pay_by,
      supplier_id: Number(r.supplier_id),
      supplier_name: r.supplier_name,
      msme: ['MICRO', 'SMALL'].includes(String(r.msme_type || '')),
      po_id: r.po_id ? Number(r.po_id) : null,
      po_number: r.po_number || null,
      grand_total: round2(r.grand_total),
      paid_amount: round2(r.paid_amount),
      balance_amount: round2(r.balance_amount),
      status: r.status,
      alerts,
    };
  }

  /** What you owe: the page's tiles. */
  async summary(user: PurchaseUser) {
    const c = user.company_id;
    const today = this.db.today();
    const payBy = PAY_BY_SQL('b', 's');
    const r = await this.db.one(
      `SELECT COALESCE(SUM(b.balance_amount), 0) AS to_pay, COUNT(*) AS unpaid,
              COALESCE(SUM(CASE WHEN ${payBy} < :today THEN b.balance_amount END), 0) AS overdue,
              SUM(${payBy} < :today) AS overdue_bills,
              COALESCE(SUM(CASE WHEN ${payBy} BETWEEN :today AND :soon THEN b.balance_amount END), 0) AS due_soon,
              COALESCE(SUM(CASE WHEN s.msme_type IN ('MICRO', 'SMALL') THEN b.balance_amount END), 0) AS msme,
              SUM(s.msme_type IN ('MICRO', 'SMALL') AND DATE_ADD(b.bill_date, INTERVAL 45 DAY) < :soon) AS msme_urgent,
              COALESCE(SUM(CASE WHEN DATE_ADD(b.bill_date, INTERVAL 150 DAY) <= :today THEN b.balance_amount END), 0) AS itc_risk
         FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.company_id = :c AND b.status IN ${OPEN_BILL}`,
      { c, today, soon: addDays(today, SOON_DAYS) },
    );
    const paid = await this.db.one(
      `SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE company_id = :c AND status = 'ACTIVE' AND payment_date >= :month`,
      { c, month: `${today.slice(0, 7)}-01` },
    );
    return {
      to_pay: round2(r?.to_pay),
      unpaid: Number(r?.unpaid || 0),
      overdue: round2(r?.overdue),
      overdue_bills: Number(r?.overdue_bills || 0),
      due_soon: round2(r?.due_soon),
      msme: round2(r?.msme),
      msme_urgent: Number(r?.msme_urgent || 0),
      itc_risk: round2(r?.itc_risk),
      paid_this_month: round2(paid?.paid),
      can: { bills: can(user, PURCHASE_PERMS.bills) },
    };
  }

  // ── One bill ─────────────────────────────────────────────────────────────

  async get(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const today = this.db.today();
    const b = await this.db.one(
      `SELECT b.*, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bill_day, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due_day,
              DATE_FORMAT(${PAY_BY_SQL('b', 's')}, '%Y-%m-%d') AS pay_by, s.name AS supplier_name, s.msme_type, po.po_number
         FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id LEFT JOIN purchase_orders po ON po.id = b.po_id
        WHERE b.id = :id AND b.company_id = :c`,
      { id, c },
    );
    if (!b) throw notFound('Bill');
    const [lines, allocations] = await Promise.all([
      this.db.sel('SELECT * FROM purchase_bill_items WHERE bill_id = :id ORDER BY id', { id }),
      this.db.sel(
        `SELECT a.id, a.amount, p.id AS payment_id, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date, p.mode, p.reference, p.status
           FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
          WHERE a.bill_id = :id AND p.company_id = :c ORDER BY p.payment_date, a.id`,
        { id, c },
      ),
    ]);
    const docLines = lines.map((l) => ({
      po_item_id: l.po_item_id ? Number(l.po_item_id) : null,
      product_id: l.product_id ? Number(l.product_id) : null,
      item_name: l.item_name,
      description: null,
      hsn_code: l.hsn_code,
      unit: l.unit,
      qty: round3(l.qty),
      rate: round2(l.rate),
      discount_percent: round2(l.discount_percent),
      gst_rate: round2(l.gst_rate),
    }));
    const totals = docTotals(docLines, b.freight_charges, b.tax_type, Number(b.freight_gst) === 1);
    let rateWarnings: string[] = [];
    if (b.po_id) {
      const po = await this.db.sel('SELECT id, rate, discount_percent, item_name FROM purchase_order_items WHERE po_id = :po', { po: b.po_id });
      rateWarnings = rateDifferences(docLines, new Map(po.map((p) => [Number(p.id), { rate: round2(p.rate), discount_percent: round2(p.discount_percent), item_name: p.item_name }])));
    }
    const live = allocations.filter((a) => a.status === 'ACTIVE');
    const open = ['UNPAID', 'PARTLY_PAID'].includes(b.status);
    const advance = open && can(user, PURCHASE_PERMS.bills) ? await this.suppliers.advance(c, Number(b.supplier_id)) : 0;
    return {
      /** The supplier's advance not used yet (only for an unpaid bill). */
      advance_available: advance,
      id: Number(b.id),
      bill_number: b.bill_number,
      bill_date: b.bill_day,
      due_date: b.due_day,
      pay_by: b.pay_by,
      supplier_id: Number(b.supplier_id),
      supplier_name: b.supplier_name,
      supplier: parseJson(b.supplier_snapshot),
      msme: ['MICRO', 'SMALL'].includes(String(b.msme_type || '')),
      po_id: b.po_id ? Number(b.po_id) : null,
      po_number: b.po_number || null,
      tax_type: b.tax_type,
      place_of_supply_code: b.place_of_supply_code,
      sub_total: round2(b.sub_total),
      discount_amount: round2(b.discount_amount),
      freight_charges: round2(b.freight_charges),
      freight_gst: Number(b.freight_gst) === 1,
      taxable_amount: round2(b.taxable_amount),
      cgst_amount: round2(b.cgst_amount),
      sgst_amount: round2(b.sgst_amount),
      igst_amount: round2(b.igst_amount),
      round_off: round2(b.round_off),
      grand_total: round2(b.grand_total),
      paid_amount: round2(b.paid_amount),
      balance_amount: round2(b.balance_amount),
      status: b.status,
      notes: b.notes,
      cancel_reason: b.cancel_reason,
      created_at: isoTime(b.created_at),
      alerts: billAlerts({ bill_date: b.bill_day, due_date: b.due_day, balance_amount: b.balance_amount, status: b.status }, b.msme_type, today),
      rate_warnings: rateWarnings,
      lines: lines.map((l, i) => ({
        id: Number(l.id),
        po_item_id: l.po_item_id ? Number(l.po_item_id) : null,
        product_id: l.product_id ? Number(l.product_id) : null,
        item_name: l.item_name,
        hsn_code: l.hsn_code,
        unit: l.unit,
        qty: round3(l.qty),
        rate: round2(l.rate),
        discount_percent: round2(l.discount_percent),
        gst_rate: round2(l.gst_rate),
        amount: round2(l.amount),
        tax: round2(totals.lines[i].cgst + totals.lines[i].sgst + totals.lines[i].igst),
      })),
      hsn_summary: hsnSummary(totals.lines),
      payments: allocations.map((a) => ({ id: Number(a.id), payment_id: Number(a.payment_id), payment_date: a.payment_date, mode: a.mode, reference: a.reference, amount: round2(a.amount), status: a.status })),
      can: {
        pay: can(user, PURCHASE_PERMS.bills) && ['UNPAID', 'PARTLY_PAID'].includes(b.status),
        cancel: can(user, PURCHASE_PERMS.bills) && b.status !== 'CANCELLED' && !live.length,
      },
    };
  }

  // ── Entering a bill ──────────────────────────────────────────────────────

  private async ledger(poId: number, t?: any) {
    const rows = await this.db.sel(LEDGER_SQL, { po: poId }, t);
    return rows.map((r) => ({
      po_item_id: Number(r.po_item_id),
      item_name: r.item_name,
      product_id: r.product_id ? Number(r.product_id) : null,
      unit: r.unit,
      hsn_code: r.hsn_code,
      ordered: round3(r.ordered),
      received: round3(r.received),
      billed: round3(r.billed),
      rate: round2(r.rate),
      discount_percent: round2(r.discount_percent),
      gst_rate: round2(r.gst_rate),
    }));
  }

  /** What can still be billed on a PO: what arrived and isn't billed yet, at the PO's prices. */
  async billable(user: PurchaseUser, poId: number) {
    const c = user.company_id;
    const po = await this.db.one(
      `SELECT po.id, po.po_number, po.supplier_id, po.status, po.freight_charges, s.name AS supplier_name, s.credit_days,
              (SELECT COUNT(*) FROM purchase_bills b WHERE b.po_id = po.id AND b.status <> 'CANCELLED') AS bills
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = :id AND po.company_id = :c`,
      { id: poId, c },
    );
    if (!po) throw notFound('Purchase order');
    const ledger = await this.ledger(poId);
    const today = this.db.today();
    return {
      po_id: Number(po.id),
      po_number: po.po_number,
      supplier_id: Number(po.supplier_id),
      supplier_name: po.supplier_name,
      // The PO's freight, suggested on its first bill only.
      freight_suggested: Number(po.bills) ? 0 : round2(po.freight_charges),
      due_date_suggested: po.credit_days === null || po.credit_days === undefined ? null : addDays(today, Number(po.credit_days)),
      lines: ledger
        .map((r) => ({
          po_item_id: r.po_item_id,
          product_id: r.product_id,
          item_name: r.item_name,
          hsn_code: r.hsn_code,
          unit: r.unit,
          ordered: r.ordered,
          received: r.received,
          billed: r.billed,
          qty: Math.max(0, round3(r.received - r.billed)),
          rate: r.rate,
          discount_percent: r.discount_percent,
          gst_rate: r.gst_rate,
        }))
        .filter((l) => l.qty > 0),
    };
  }

  /** Works a bill out (shared by preview and save). */
  private async build(user: PurchaseUser, body: any, t?: any, preview = false) {
    const c = user.company_id;
    const head = parseBillHeader(body, this.db.today());
    if (!head.ok) throw bad(head.message);
    const h = head.value;
    const supplier = await this.db.one('SELECT * FROM suppliers WHERE id = :id AND company_id = :c', { id: h.supplier_id, c }, t);
    if (!supplier) throw bad('Choose the supplier');
    if (Number(supplier.is_active) !== 1) throw bad(`${supplier.name} is archived — restore it first`);
    // The same supplier bill entered twice (in one financial year) is the likeliest mistake — say so first.
    const { from, to, fy } = fyRange(h.bill_date);
    const dup = await this.db.one(
      `SELECT id FROM purchase_bills WHERE company_id = :c AND supplier_id = :s AND bill_number = :n AND status <> 'CANCELLED' AND bill_date BETWEEN :from AND :to LIMIT 1`,
      { c, s: supplier.id, n: h.bill_number, from, to },
      t,
    );
    const dupText = dup ? `Bill ${h.bill_number} from ${supplier.name} is already entered for ${fy}` : null;
    if (dupText && !preview) throw bad(dupText);
    let po: any = null;
    let ledger: ReceiptLedgerRow[] = [];
    if (h.po_id) {
      po = await this.db.one(`SELECT * FROM purchase_orders WHERE id = :id AND company_id = :c${t ? ' FOR UPDATE' : ''}`, { id: h.po_id, c }, t);
      if (!po) throw bad("That purchase order isn't yours");
      if (Number(po.supplier_id) !== Number(supplier.id)) throw bad(`${po.po_number} is for another supplier`);
      if (['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(po.status)) throw bad(`${po.po_number} is ${po.status.toLowerCase().replace(/_/g, ' ')} — it can't be billed`);
      ledger = await this.ledger(Number(po.id), t);
    }
    const raw: any[] = Array.isArray(body?.items) ? body.items : [];
    const productIds = [...new Set(raw.map((r) => Number(r?.product_id)).filter((x) => x > 0))];
    const products = productIds.length ? await this.db.sel('SELECT id, tax_percentage FROM products WHERE company_id = :c AND id IN (:ids)', { c, ids: productIds }, t) : [];
    if (products.length !== productIds.length) throw bad("Some products aren't in your product list — pick them again");
    const rates = new Map(products.map((p) => [Number(p.id), Number(p.tax_percentage)]));
    const parsed = parseLines(raw, { gstFor: (r) => ((rates.get(Number(r?.product_id)) || 0) > 0 ? rates.get(Number(r?.product_id))! : DEFAULT_GST) });
    if (!parsed.ok) throw bad(parsed.message);
    const lines = parsed.lines;
    for (const l of lines) {
      if (l.po_item_id && !ledger.some((r) => r.po_item_id === Number(l.po_item_id))) throw bad(`${l.item_name}: that line isn't on ${po ? po.po_number : 'a purchase order'}`);
    }
    const over = overBilled(lines, ledger);
    if (over) throw bad(over);
    const buyer = await this.db.buyer(c, po?.issuing_location_id ? Number(po.issuing_location_id) : null, t);
    const placeCode = po?.place_of_supply_code || placeCodeFrom(buyer.state_code, buyer.gstin);
    const snapshot = parseJson(po?.supplier_snapshot);
    const taxType = purchaseTaxType({ gst_type: supplier.gst_type, gstin: snapshot?.gstin || supplier.gstin, state_code: snapshot?.state_code || supplier.state_code }, placeCode);
    const freightTaxed = await companyTaxesTransport(this.db.sequelize, c, t);
    const totals = docTotals(lines, h.freight_charges, taxType, freightTaxed);
    const warnings = rateDifferences(
      lines,
      new Map(ledger.map((r: any) => [r.po_item_id, { rate: r.rate, discount_percent: r.discount_percent, item_name: r.item_name }])),
    );
    const typed = body?.bill_total === undefined || body?.bill_total === null || body?.bill_total === '' ? null : round2(body.bill_total);
    if (typed !== null && Math.abs(typed - totals.grand_total) >= 1) {
      warnings.push(`The supplier's bill says ₹${typed}, these lines make ₹${totals.grand_total} — check the quantities, rates and GST`);
    }
    const credit = supplier.credit_days === null || supplier.credit_days === undefined ? null : Number(supplier.credit_days);
    const due = h.due_date || (credit !== null ? addDays(h.bill_date, credit) : null);
    return { h, supplier, po, lines, totals, taxType, placeCode, warnings, due, dup: dupText };
  }

  /** The bill as it would be saved, with any warnings — nothing saved. */
  async preview(user: PurchaseUser, body: any) {
    const b = await this.build(user, body, undefined, true);
    return {
      tax_type: b.taxType,
      due_date: b.due,
      duplicate: b.dup,
      warnings: b.warnings,
      totals: { ...b.totals, lines: undefined },
      lines: b.totals.lines.map((l) => ({ item_name: l.item_name, qty: l.qty, rate: l.rate, amount: l.amount, gst_rate: l.gst_rate, tax: round2(l.cgst + l.sgst + l.igst) })),
      hsn_summary: hsnSummary(b.totals.lines),
    };
  }

  async create(user: PurchaseUser, body: any) {
    const c = user.company_id;
    const id = await this.db.tx(async (t) => {
      const b = await this.build(user, body, t);
      if (b.dup) throw bad(b.dup);
      const tot = b.totals;
      const supplierSnap = parseJson(b.po?.supplier_snapshot) || {
        id: Number(b.supplier.id),
        name: b.supplier.name,
        legal_name: b.supplier.legal_name,
        gst_type: b.supplier.gst_type,
        gstin: b.supplier.gstin,
        state: b.supplier.state,
        state_code: b.supplier.state_code,
        msme_type: b.supplier.msme_type,
      };
      const billId = await this.db.insert(
        `INSERT INTO purchase_bills (company_id, supplier_id, po_id, bill_number, bill_date, due_date, supplier_snapshot, place_of_supply_code, tax_type,
                                     sub_total, discount_amount, freight_charges, freight_gst, taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off,
                                     grand_total, paid_amount, balance_amount, status, notes, created_by, updated_by)
         VALUES (:c, :s, :po, :n, :d, :due, :snap, :place, :tax, :sub, :disc, :fr, :frg, :taxable, :cgst, :sgst, :igst, :ro, :gt, 0, :gt, :status, :notes, :u, :u)`,
        {
          c,
          s: b.supplier.id,
          po: b.po ? b.po.id : null,
          n: b.h.bill_number,
          d: b.h.bill_date,
          due: b.due,
          snap: JSON.stringify(supplierSnap),
          place: b.placeCode,
          tax: b.taxType,
          sub: tot.sub_total,
          disc: tot.discount_amount,
          fr: tot.freight_charges,
          frg: tot.freight_gst,
          taxable: tot.taxable_amount,
          cgst: tot.cgst_amount,
          sgst: tot.sgst_amount,
          igst: tot.igst_amount,
          ro: tot.round_off,
          gt: tot.grand_total,
          status: billStatus(tot.grand_total, 0),
          notes: b.h.notes,
          u: user.user_id,
        },
        t,
      );
      for (const l of tot.lines) {
        await this.db.insert(
          `INSERT INTO purchase_bill_items (bill_id, po_item_id, product_id, item_name, hsn_code, unit, qty, rate, discount_percent, gst_rate, amount)
           VALUES (:b, :pi, :p, :name, :hsn, :unit, :qty, :rate, :disc, :gst, :amount)`,
          { b: billId, pi: l.po_item_id || null, p: l.product_id, name: l.item_name, hsn: l.hsn_code, unit: l.unit, qty: l.qty, rate: l.rate, disc: l.discount_percent, gst: l.gst_rate, amount: l.amount },
          t,
        );
      }
      if (b.po) {
        await this.db.insert(
          'INSERT INTO purchase_order_activity (company_id, po_id, action, note, user_id) VALUES (:c, :po, :a, :note, :u)',
          { c, po: b.po.id, a: 'BILLED', note: `Supplier bill ${b.h.bill_number} entered — ₹${tot.grand_total}`, u: user.user_id },
          t,
        );
      }
      if (body?.apply_advance === true) await this.useAdvance(c, Number(b.supplier.id), billId, user.user_id, t);
      return billId;
    });
    const bill = await this.get(user, id);
    return { ...bill, message: `Bill ${bill.bill_number} saved — ₹${bill.balance_amount} to pay by ${bill.pay_by}` };
  }

  async cancel(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const reason = parseReason(body?.reason);
    if (!reason.ok) throw bad(reason.message);
    await this.db.tx(async (t) => {
      const b = await this.db.one('SELECT * FROM purchase_bills WHERE id = :id AND company_id = :c FOR UPDATE', { id, c }, t);
      if (!b) throw notFound('Bill');
      if (b.status === 'CANCELLED') throw bad('This bill is already cancelled');
      const paid = await this.db.one(
        `SELECT COUNT(*) AS n FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id WHERE a.bill_id = :id AND p.status = 'ACTIVE'`,
        { id },
        t,
      );
      if (Number(paid?.n)) throw bad('Payments are recorded against this bill — cancel those payments first');
      await this.db.run(
        `UPDATE purchase_bills SET status = 'CANCELLED', balance_amount = 0, cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW(), updated_by = :u WHERE id = :id`,
        { r: reason.value, u: user.user_id, id },
        t,
      );
      if (b.po_id) {
        await this.db.insert(
          'INSERT INTO purchase_order_activity (company_id, po_id, action, note, user_id) VALUES (:c, :po, :a, :note, :u)',
          { c, po: b.po_id, a: 'BILL_CANCELLED', note: `Supplier bill ${b.bill_number} cancelled: ${reason.value}`, u: user.user_id },
          t,
        );
      }
    });
    return { ...(await this.get(user, id)), message: 'Bill cancelled' };
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  /** A supplier's unpaid bills (oldest due first) and the advance not yet used — for the Pay dialog. */
  async unpaid(user: PurchaseUser, supplierId: number) {
    const c = user.company_id;
    const s = await this.db.one('SELECT id, name, msme_type, bank_account_name, bank_account_number, bank_ifsc, bank_name, upi_id FROM suppliers WHERE id = :id AND company_id = :c', { id: supplierId, c });
    if (!s) throw notFound('Supplier');
    const today = this.db.today();
    const rows = await this.db.sel(
      `SELECT b.id, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bill_date, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due_date,
              DATE_FORMAT(${PAY_BY_SQL('b', 's')}, '%Y-%m-%d') AS pay_by, b.grand_total, b.paid_amount, b.balance_amount, b.status,
              b.supplier_id, s.name AS supplier_name, s.msme_type, b.po_id, NULL AS po_number
         FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.company_id = :c AND b.supplier_id = :s AND b.status IN ${OPEN_BILL} ORDER BY pay_by, b.id`,
      { c, s: supplierId },
    );
    return {
      supplier: {
        id: Number(s.id),
        name: s.name,
        msme: ['MICRO', 'SMALL'].includes(String(s.msme_type || '')),
        bank: s.bank_account_number ? { name: s.bank_account_name, account: s.bank_account_number, ifsc: s.bank_ifsc, bank: s.bank_name } : null,
        upi_id: s.upi_id,
      },
      advance: await this.suppliers.advance(c, supplierId),
      bills: rows.map((r) => this.rowView(r, today)),
    };
  }

  async payments(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchTerm(query?.q);
    const where = ['p.company_id = :c'];
    if (Number(query?.supplier_id) > 0) where.push('p.supplier_id = :s');
    if (q) where.push('(s.name LIKE :q OR p.reference LIKE :q)');
    const rows = await this.db.sel(
      `SELECT p.id, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS payment_date, p.amount, p.mode, p.reference, p.status, p.notes, p.supplier_id, s.name AS supplier_name,
              p.po_id, po.po_number, ba.bank_name AS paid_from,
              (SELECT COALESCE(SUM(a.amount), 0) FROM supplier_payment_allocations a WHERE a.payment_id = p.id) AS allocated,
              (SELECT GROUP_CONCAT(b.bill_number ORDER BY b.bill_date SEPARATOR ', ') FROM supplier_payment_allocations a JOIN purchase_bills b ON b.id = a.bill_id WHERE a.payment_id = p.id) AS bills
         FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN purchase_orders po ON po.id = p.po_id
         LEFT JOIN company_bank_accounts ba ON ba.id = p.bank_account_id
        WHERE ${where.join(' AND ')} ORDER BY p.payment_date DESC, p.id DESC LIMIT :limit OFFSET :offset`,
      { c, s: Number(query?.supplier_id) || null, q: q ? `%${q}%` : null, limit, offset },
    );
    return {
      page,
      limit,
      rows: rows.map((r) => ({
        id: Number(r.id),
        payment_date: r.payment_date,
        amount: round2(r.amount),
        mode: r.mode,
        reference: r.reference,
        status: r.status,
        notes: r.notes,
        supplier_id: Number(r.supplier_id),
        supplier_name: r.supplier_name,
        po_id: r.po_id ? Number(r.po_id) : null,
        po_number: r.po_number,
        paid_from: r.paid_from,
        bills: r.bills,
        advance: r.status === 'ACTIVE' ? Math.max(0, round2(Number(r.amount) - Number(r.allocated))) : 0,
      })),
    };
  }

  /** Money paid: shared over the supplier's unpaid bills (the split given, else oldest due first); the rest is an advance. */
  async pay(user: PurchaseUser, body: any) {
    const c = user.company_id;
    const parsed = parsePayment(body, this.db.today());
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const out = await this.db.tx(async (t) => {
      const s = await this.db.one('SELECT id, name FROM suppliers WHERE id = :id AND company_id = :c', { id: v.supplier_id, c }, t);
      if (!s) throw bad('Choose the supplier');
      if (v.bank_account_id) {
        const ba = await this.db.one('SELECT id FROM company_bank_accounts WHERE id = :id AND company_id = :c', { id: v.bank_account_id, c }, t);
        if (!ba) throw bad("That bank account isn't yours");
      }
      if (v.po_id) {
        const po = await this.db.one('SELECT id, supplier_id FROM purchase_orders WHERE id = :id AND company_id = :c', { id: v.po_id, c }, t);
        if (!po || Number(po.supplier_id) !== v.supplier_id) throw bad("That PO isn't this supplier's");
      }
      const bills = await this.db.sel(
        `SELECT b.id, b.bill_number, b.balance_amount, DATE_FORMAT(${PAY_BY_SQL('b', 's')}, '%Y-%m-%d') AS pay_by
           FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.company_id = :c AND b.supplier_id = :s AND b.status IN ${OPEN_BILL} FOR UPDATE`,
        { c, s: v.supplier_id },
        t,
      );
      const alloc = allocatePayment(
        v.amount,
        bills.map((b) => ({ id: Number(b.id), balance: round2(b.balance_amount), pay_by: b.pay_by, bill_number: b.bill_number })),
        v.allocations,
      );
      if (!alloc.ok) throw bad(alloc.message);
      const paymentId = await this.db.insert(
        `INSERT INTO supplier_payments (company_id, supplier_id, po_id, payment_date, amount, mode, reference, bank_account_id, notes, status, created_by)
         VALUES (:c, :s, :po, :d, :amt, :mode, :ref, :bank, :notes, 'ACTIVE', :u)`,
        { c, s: v.supplier_id, po: v.po_id, d: v.payment_date, amt: v.amount, mode: v.mode, ref: v.reference, bank: v.bank_account_id, notes: v.notes, u: user.user_id },
        t,
      );
      for (const a of alloc.allocations) await this.allocate(paymentId, a.bill_id, a.amount, user.user_id, t);
      return { paymentId, name: s.name, bills: alloc.allocations.length, advance: alloc.advance };
    });
    return {
      id: out.paymentId,
      advance: out.advance,
      message: `₹${v.amount} paid to ${out.name}${out.bills ? ` — against ${out.bills} bill${out.bills > 1 ? 's' : ''}` : ''}${out.advance ? `; ₹${out.advance} kept as an advance` : ''}`,
    };
  }

  private async allocate(paymentId: number, billId: number, amount: number, userId: number, t: any) {
    await this.db.insert('INSERT INTO supplier_payment_allocations (payment_id, bill_id, amount) VALUES (:p, :b, :a)', { p: paymentId, b: billId, a: amount }, t);
    const b = await this.db.one('SELECT grand_total, paid_amount FROM purchase_bills WHERE id = :id FOR UPDATE', { id: billId }, t);
    const paid = round2(Number(b.paid_amount) + amount);
    await this.db.run(
      'UPDATE purchase_bills SET paid_amount = :paid, balance_amount = :bal, status = :st, updated_by = :u WHERE id = :id',
      { paid, bal: Math.max(0, round2(Number(b.grand_total) - paid)), st: billStatus(b.grand_total, paid), u: userId, id: billId },
      t,
    );
  }

  /** Undo a payment: its bills owe that money again. */
  async cancelPayment(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const reason = parseReason(body?.reason);
    if (!reason.ok) throw bad(reason.message);
    await this.db.tx(async (t) => {
      const p = await this.db.one('SELECT * FROM supplier_payments WHERE id = :id AND company_id = :c FOR UPDATE', { id, c }, t);
      if (!p) throw notFound('Payment');
      if (p.status !== 'ACTIVE') throw bad('This payment is already cancelled');
      const allocations = await this.db.sel('SELECT bill_id, amount FROM supplier_payment_allocations WHERE payment_id = :id', { id }, t);
      for (const a of allocations) {
        const b = await this.db.one('SELECT grand_total, paid_amount, status FROM purchase_bills WHERE id = :id FOR UPDATE', { id: a.bill_id }, t);
        if (!b || b.status === 'CANCELLED') continue;
        const paid = Math.max(0, round2(Number(b.paid_amount) - Number(a.amount)));
        await this.db.run(
          'UPDATE purchase_bills SET paid_amount = :paid, balance_amount = :bal, status = :st, updated_by = :u WHERE id = :id',
          { paid, bal: round2(Number(b.grand_total) - paid), st: billStatus(b.grand_total, paid), u: user.user_id, id: a.bill_id },
          t,
        );
      }
      await this.db.run(
        `UPDATE supplier_payments SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`,
        { r: reason.value, u: user.user_id, id },
        t,
      );
    });
    return { id, cancelled: true, message: 'Payment cancelled — its bills are due again' };
  }

  /** Use the supplier's advance (money paid but not against a bill) for this bill. */
  async applyAdvance(user: PurchaseUser, billId: number) {
    const c = user.company_id;
    const used = await this.db.tx(async (t) => {
      const b = await this.db.one('SELECT id, supplier_id, status FROM purchase_bills WHERE id = :id AND company_id = :c FOR UPDATE', { id: billId, c }, t);
      if (!b) throw notFound('Bill');
      if (!['UNPAID', 'PARTLY_PAID'].includes(b.status)) throw bad('This bill has nothing left to pay');
      const amount = await this.useAdvance(c, Number(b.supplier_id), billId, user.user_id, t);
      if (!amount) throw bad('There is no advance left for this supplier');
      return amount;
    });
    return { ...(await this.get(user, billId)), message: `₹${used} of advance used for this bill` };
  }

  private async useAdvance(companyId: number, supplierId: number, billId: number, userId: number, t: any): Promise<number> {
    const bill = await this.db.one('SELECT balance_amount FROM purchase_bills WHERE id = :id FOR UPDATE', { id: billId }, t);
    let left = round2(bill?.balance_amount);
    if (left <= 0) return 0;
    const payments = await this.db.sel(
      `SELECT p.id, p.amount - COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = p.id), 0) AS free
         FROM supplier_payments p WHERE p.company_id = :c AND p.supplier_id = :s AND p.status = 'ACTIVE'
        ORDER BY p.payment_date, p.id FOR UPDATE`,
      { c: companyId, s: supplierId },
      t,
    );
    let used = 0;
    for (const p of payments) {
      const free = round2(p.free);
      if (free <= 0 || left <= 0) continue;
      const take = round2(Math.min(free, left));
      await this.allocate(Number(p.id), billId, take, userId, t);
      left = round2(left - take);
      used = round2(used + take);
    }
    return used;
  }

  /** Bills of one PO (for the PO panel) — read by anyone who can see bills. */
  async ofPo(user: PurchaseUser, poId: number) {
    const rows = await this.db.sel(
      `SELECT id, bill_number, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, grand_total, balance_amount, status FROM purchase_bills WHERE company_id = :c AND po_id = :po ORDER BY bill_date, id`,
      { c: user.company_id, po: poId },
    );
    return rows.map((r) => ({ id: Number(r.id), bill_number: r.bill_number, bill_date: r.bill_date, grand_total: round2(r.grand_total), balance_amount: round2(r.balance_amount), status: r.status }));
  }
}

