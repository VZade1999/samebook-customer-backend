import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { companyTaxesTransport } from '../common/transport-gst';
import { GST_STATE_CODES } from '../common/gst-state.util';
import { BILLABLE_QUOTATION_STATUSES, SENT_QTY_SQL } from '../invoice/billing.rules';
import { changeLevel, levelOf, lockRows, newBatch, record, syncTotals, LedgerEntry } from '../stock/stock-ledger';
import {
  AMENDABLE_STATUSES,
  DEFAULT_GST,
  DEFAULT_PO_TERMS,
  DRAFT_STATUSES,
  DocLine,
  OPEN_STATUSES,
  PURCHASE_PERMS,
  PURCHASES_MODULE,
  PoStatus,
  RECEIVABLE_STATUSES,
  ReceiptLedgerRow,
  amendProblem,
  cancelBlocker,
  closeBlocker,
  docTotals,
  hsnSummary,
  lineAmount,
  needsApproval,
  pageOf,
  parseLines,
  parsePoFilter,
  parsePoHeader,
  parseReason,
  parseReceipt,
  parseSettings,
  placeCodeFrom,
  purchaseTaxType,
  receiptStatus,
  round2,
  round3,
  searchTerm,
} from './purchase.rules';
import { PurchaseDb, PurchaseUser, bad, can, isoDate, isoTime, notFound, parseJson } from './purchase-db';

const OPEN_IN = OPEN_STATUSES.map((s) => `'${s}'`).join(', ');
const STATUS_WORD: Record<string, string> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'waiting for approval',
  APPROVED: 'approved',
  SENT: 'sent',
  PARTLY_RECEIVED: 'part received',
  RECEIVED: 'received',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
};
const word = (s: string) => STATUS_WORD[s] || s.toLowerCase();
const inr = (v: unknown) => `₹${round2(v).toLocaleString('en-IN', { minimumFractionDigits: round2(v) % 1 ? 2 : 0 })}`;

/** The received / billed quantities of each PO line. */
const LEDGER_SQL = `
  SELECT i.id AS po_item_id, i.item_name, i.product_id, i.unit, i.qty AS ordered,
         COALESCE((SELECT SUM(g.accepted_qty) FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id
                    WHERE g.po_item_id = i.id AND r.status = 'RECEIVED'), 0) AS received,
         COALESCE((SELECT SUM(bi.qty) FROM purchase_bill_items bi JOIN purchase_bills b ON b.id = bi.bill_id
                    WHERE bi.po_item_id = i.id AND b.status <> 'CANCELLED'), 0) AS billed
    FROM purchase_order_items i WHERE i.po_id = :po ORDER BY i.line_no, i.id`;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly db: PurchaseDb,
    private readonly notifications: NotificationsService,
    private readonly appLogger: AppLogger,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  private async poRow(companyId: number, id: number, t?: any, lock = false) {
    const po = await this.db.one(`SELECT * FROM purchase_orders WHERE id = :id AND company_id = :c${lock ? ' FOR UPDATE' : ''}`, { id, c: companyId }, t);
    if (!po) throw notFound('Purchase order');
    return po;
  }

  private async ledger(poId: number, t?: any): Promise<ReceiptLedgerRow[]> {
    const rows = await this.db.sel(LEDGER_SQL, { po: poId }, t);
    return rows.map((r) => ({
      po_item_id: Number(r.po_item_id),
      item_name: r.item_name,
      product_id: r.product_id ? Number(r.product_id) : null,
      unit: r.unit,
      ordered: round3(r.ordered),
      received: round3(r.received),
      billed: round3(r.billed),
    }));
  }

  /** Purchase orders, newest first, with how much has arrived. */
  async list(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const today = this.db.today();
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const filter = parsePoFilter(query?.status);
    const q = searchTerm(query?.q);
    const where = ['po.company_id = :c'];
    if (filter === 'TO_SEND') where.push(`po.status = 'APPROVED'`);
    else if (filter === 'TO_RECEIVE') where.push(`po.status IN (${OPEN_IN})`);
    else if (filter === 'LATE') where.push(`po.status IN (${OPEN_IN}) AND po.expected_date < :today`);
    else if (filter !== 'ALL') where.push('po.status = :status');
    if (Number(query?.supplier_id) > 0) where.push('po.supplier_id = :supplier');
    if (Number(query?.quotation_id) > 0) where.push('po.quotation_id = :quotation');
    if (q) where.push('(po.po_number LIKE :q OR s.name LIKE :q OR po.supplier_ref LIKE :q)');
    const rep = { c, today, status: filter, supplier: Number(query?.supplier_id) || null, quotation: Number(query?.quotation_id) || null, q: q ? `%${q}%` : null, limit, offset };
    const from = `FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE ${where.join(' AND ')}`;
    const rows = await this.db.sel(
      `SELECT po.id, po.po_number, DATE_FORMAT(po.po_date, '%Y-%m-%d') AS po_date, DATE_FORMAT(po.expected_date, '%Y-%m-%d') AS expected_date,
              po.status, po.revision, po.grand_total, po.supplier_id, s.name AS supplier_name, s.msme_type,
              (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS items,
              (SELECT COALESCE(SUM(i.qty), 0) FROM purchase_order_items i WHERE i.po_id = po.id) AS ordered_qty,
              (SELECT COALESCE(SUM(g.accepted_qty), 0) FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id
                 WHERE r.po_id = po.id AND r.status = 'RECEIVED') AS received_qty
         ${from} ORDER BY po.po_date DESC, po.id DESC LIMIT :limit OFFSET :offset`,
      rep,
    );
    const total = await this.db.one(`SELECT COUNT(*) AS n ${from}`, rep);
    const money = can(user, PURCHASE_PERMS.view);
    return {
      page,
      limit,
      total: Number(total?.n || 0),
      rows: rows.map((r) => {
        const ordered = round3(r.ordered_qty);
        const received = round3(r.received_qty);
        return {
          id: Number(r.id),
          po_number: r.po_number,
          po_date: r.po_date,
          expected_date: r.expected_date,
          status: r.status,
          revision: Number(r.revision || 0),
          supplier_id: Number(r.supplier_id),
          supplier_name: r.supplier_name,
          items: Number(r.items || 0),
          received_pct: ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0,
          late: OPEN_STATUSES.includes(r.status) && !!r.expected_date && r.expected_date < today,
          grand_total: money ? round2(r.grand_total) : null,
        };
      }),
    };
  }

  /** Counts and the open value for the page's tiles. */
  async summary(user: PurchaseUser) {
    const c = user.company_id;
    const today = this.db.today();
    const r = await this.db.one(
      `SELECT SUM(status = 'DRAFT') AS draft, SUM(status = 'PENDING_APPROVAL') AS pending, SUM(status = 'APPROVED') AS to_send,
              SUM(status IN (${OPEN_IN})) AS to_receive, SUM(status IN (${OPEN_IN}) AND expected_date < :today) AS late,
              COALESCE(SUM(CASE WHEN status IN (${OPEN_IN}) THEN grand_total END), 0) AS open_value,
              COALESCE(SUM(CASE WHEN status <> 'CANCELLED' AND status <> 'DRAFT' AND po_date >= :month THEN grand_total END), 0) AS ordered_this_month,
              COUNT(*) AS total
         FROM purchase_orders WHERE company_id = :c`,
      { c, today, month: `${today.slice(0, 7)}-01` },
    );
    const money = can(user, PURCHASE_PERMS.view);
    const n = (v: unknown) => Number(v || 0);
    return {
      draft: n(r?.draft),
      pending: n(r?.pending),
      to_send: n(r?.to_send),
      to_receive: n(r?.to_receive),
      late: n(r?.late),
      total: n(r?.total),
      open_value: money ? round2(r?.open_value) : null,
      ordered_this_month: money ? round2(r?.ordered_this_month) : null,
      can: {
        create: can(user, PURCHASE_PERMS.create),
        approve: can(user, PURCHASE_PERMS.approve),
        receive: can(user, PURCHASE_PERMS.receive),
        bills: can(user, PURCHASE_PERMS.bills),
        view: money,
      },
    };
  }

  /** One PO with its lines (ordered / received / billed), receipts, bills and history. */
  async get(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const po = await this.poRow(c, id);
    const [lines, ledger, receipts, receiptLines, bills, activity] = await Promise.all([
      this.db.sel('SELECT * FROM purchase_order_items WHERE po_id = :id ORDER BY line_no, id', { id }),
      this.ledger(id),
      this.db.sel(
        `SELECT r.id, r.grn_number, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS receipt_date, r.status, r.supplier_challan_no, r.supplier_invoice_no,
                r.vehicle_number, r.eway_bill_number, r.transporter_name, r.notes, r.cancel_reason, w.name AS warehouse_name,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS received_by,
                DATE_FORMAT(r.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at
           FROM goods_receipts r LEFT JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN users u ON u.id = r.created_by
          WHERE r.company_id = :c AND r.po_id = :id ORDER BY r.receipt_date, r.id`,
        { c, id },
      ),
      this.db.sel(
        `SELECT g.grn_id, g.po_item_id, g.item_name, g.unit, g.received_qty, g.accepted_qty, g.rejected_qty, g.reject_reason
           FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id WHERE r.po_id = :id AND r.company_id = :c ORDER BY g.id`,
        { c, id },
      ),
      this.db.sel(
        `SELECT id, bill_number, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, grand_total, balance_amount, status
           FROM purchase_bills WHERE company_id = :c AND po_id = :id ORDER BY bill_date, id`,
        { c, id },
      ),
      this.db.sel(
        `SELECT a.id, a.action, a.note, (a.snapshot IS NOT NULL) AS has_snapshot, DATE_FORMAT(a.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS user_name
           FROM purchase_order_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.po_id = :id AND a.company_id = :c ORDER BY a.id DESC LIMIT 60`,
        { c, id },
      ),
    ]);
    const money = can(user, PURCHASE_PERMS.view);
    const byItem = new Map(ledger.map((r) => [r.po_item_id, r]));
    const docLines: DocLine[] = lines.map((l) => ({
      product_id: l.product_id ? Number(l.product_id) : null,
      item_name: l.item_name,
      description: l.description,
      hsn_code: l.hsn_code,
      unit: l.unit,
      qty: round3(l.qty),
      rate: round2(l.rate),
      discount_percent: round2(l.discount_percent),
      gst_rate: round2(l.gst_rate),
    }));
    const totals = docTotals(docLines, po.freight_charges, po.tax_type, Number(po.freight_gst) === 1);
    const receivedAny = ledger.some((r) => r.received > 0);
    const st = po.status as PoStatus;
    const unbilled = ledger.some((r) => r.received - (r.billed || 0) > 0.0005);
    const [createdBy, approvedBy, forQuotation] = await Promise.all([
      this.db.userName(po.created_by),
      this.db.userName(po.approved_by),
      po.quotation_id
        ? this.db.one('SELECT id, quotation_number, customer_name FROM quotations WHERE id = :q AND company_id = :c', { q: po.quotation_id, c })
        : Promise.resolve(null),
    ]);
    const hide = (v: unknown) => (money ? round2(v) : null);
    return {
      id: Number(po.id),
      po_number: po.po_number,
      po_date: isoDate(po.po_date),
      expected_date: isoDate(po.expected_date),
      status: st,
      revision: Number(po.revision || 0),
      supplier_id: Number(po.supplier_id),
      supplier: parseJson(po.supplier_snapshot),
      supplier_ref: po.supplier_ref,
      quotation: forQuotation ? { id: Number(forQuotation.id), number: forQuotation.quotation_number, customer_name: forQuotation.customer_name } : null,
      buyer: parseJson(po.buyer_snapshot),
      ship_to: parseJson(po.ship_to_snapshot),
      warehouse_id: po.warehouse_id ? Number(po.warehouse_id) : null,
      issuing_location_id: po.issuing_location_id ? Number(po.issuing_location_id) : null,
      place_of_supply: po.place_of_supply,
      place_of_supply_code: po.place_of_supply_code,
      tax_type: po.tax_type,
      sub_total: hide(po.sub_total),
      discount_amount: hide(po.discount_amount),
      freight_charges: hide(po.freight_charges),
      freight_gst: Number(po.freight_gst) === 1,
      taxable_amount: hide(po.taxable_amount),
      cgst_amount: hide(po.cgst_amount),
      sgst_amount: hide(po.sgst_amount),
      igst_amount: hide(po.igst_amount),
      round_off: hide(po.round_off),
      grand_total: hide(po.grand_total),
      payment_terms: po.payment_terms,
      delivery_terms: po.delivery_terms,
      notes: po.notes,
      terms_conditions: po.terms_conditions,
      created_by: createdBy,
      approved_by: approvedBy,
      approved_at: isoTime(po.approved_at),
      sent_at: isoTime(po.sent_at),
      closed_at: isoTime(po.closed_at),
      close_reason: po.close_reason,
      created_at: isoTime(po.created_at),
      updated_at: isoTime(po.updated_at),
      money_hidden: !money,
      lines: lines.map((l, i) => {
        const led = byItem.get(Number(l.id));
        const priced = totals.lines[i];
        return {
          id: Number(l.id),
          line_no: Number(l.line_no),
          product_id: l.product_id ? Number(l.product_id) : null,
          item_name: l.item_name,
          description: l.description,
          hsn_code: l.hsn_code,
          unit: l.unit,
          qty: round3(l.qty),
          rate: hide(l.rate),
          discount_percent: money ? round2(l.discount_percent) : null,
          gst_rate: money ? round2(l.gst_rate) : null,
          amount: hide(l.amount),
          tax: money ? round2(priced.cgst + priced.sgst + priced.igst) : null,
          received: led?.received ?? 0,
          billed: led?.billed ?? 0,
          pending: Math.max(0, round3((led ? led.ordered - led.received : round3(l.qty)))),
        };
      }),
      hsn_summary: money ? hsnSummary(totals.lines) : [],
      receipts: receipts.map((r) => ({
        id: Number(r.id),
        grn_number: r.grn_number,
        receipt_date: r.receipt_date,
        status: r.status,
        warehouse_name: r.warehouse_name,
        supplier_challan_no: r.supplier_challan_no,
        supplier_invoice_no: r.supplier_invoice_no,
        vehicle_number: r.vehicle_number,
        eway_bill_number: r.eway_bill_number,
        transporter_name: r.transporter_name,
        notes: r.notes,
        cancel_reason: r.cancel_reason,
        received_by: r.received_by || null,
        created_at: r.created_at,
        lines: receiptLines
          .filter((g) => Number(g.grn_id) === Number(r.id))
          .map((g) => ({ po_item_id: Number(g.po_item_id), item_name: g.item_name, unit: g.unit, received_qty: round3(g.received_qty), accepted_qty: round3(g.accepted_qty), rejected_qty: round3(g.rejected_qty), reject_reason: g.reject_reason })),
      })),
      bills: money || can(user, PURCHASE_PERMS.bills)
        ? bills.map((b) => ({ id: Number(b.id), bill_number: b.bill_number, bill_date: b.bill_date, grand_total: round2(b.grand_total), balance_amount: round2(b.balance_amount), status: b.status }))
        : [],
      activity: activity.map((a) => ({ id: Number(a.id), action: a.action, note: a.note, user_name: a.user_name || null, created_at: a.created_at, has_snapshot: Number(a.has_snapshot) === 1 })),
      can: {
        edit: DRAFT_STATUSES.includes(st) && can(user, PURCHASE_PERMS.create),
        submit: st === 'DRAFT' && can(user, PURCHASE_PERMS.create),
        approve: st === 'PENDING_APPROVAL' && can(user, PURCHASE_PERMS.approve),
        send_back: st === 'PENDING_APPROVAL' && can(user, PURCHASE_PERMS.approve),
        mark_sent: st === 'APPROVED' && (can(user, PURCHASE_PERMS.create) || can(user, PURCHASE_PERMS.approve)),
        amend: AMENDABLE_STATUSES.includes(st) && can(user, PURCHASE_PERMS.approve),
        receive: RECEIVABLE_STATUSES.includes(st) && can(user, PURCHASE_PERMS.receive),
        cancel: !DRAFT_STATUSES.includes(st) && !cancelBlocker(po, receivedAny) && can(user, PURCHASE_PERMS.approve),
        close: !closeBlocker(po, receivedAny) && can(user, PURCHASE_PERMS.approve),
        reopen: st === 'CLOSED' && can(user, PURCHASE_PERMS.approve),
        delete: DRAFT_STATUSES.includes(st) && can(user, PURCHASE_PERMS.create),
        bill: ['PARTLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(st) && unbilled && can(user, PURCHASE_PERMS.bills),
        undo_receipt: can(user, PURCHASE_PERMS.receive),
        pdf: money && st !== 'CANCELLED',
      },
    };
  }

  // ── Building a PO from the form ──────────────────────────────────────────

  /**
   * Checks the form and works everything out: supplier and our own details,
   * where the goods go, which GST applies, every line's tax and the totals.
   */
  private async build(user: PurchaseUser, body: any, t: any, opts: { po?: any; amend?: boolean } = {}) {
    const c = user.company_id;
    const head = parsePoHeader({ ...body, po_date: opts.po && !body?.po_date ? isoDate(opts.po.po_date) : body?.po_date }, this.db.today());
    if (!head.ok) throw bad(head.message);
    const h = head.value;
    if (opts.amend && Number(h.supplier_id) !== Number(opts.po?.supplier_id)) {
      throw bad("An approved PO's supplier can't change — cancel it and make a new PO for the other supplier");
    }
    const supplier = await this.db.one('SELECT * FROM suppliers WHERE id = :id AND company_id = :c', { id: h.supplier_id, c }, t);
    if (!supplier) throw bad('Choose the supplier');
    if (Number(supplier.is_active) !== 1 && !opts.po) throw bad(`${supplier.name} is archived — restore it first`);
    const addresses = await this.db.sel('SELECT * FROM supplier_addresses WHERE supplier_id = :s ORDER BY is_primary DESC, id', { s: supplier.id }, t);
    const address = h.supplier_address_id ? addresses.find((a) => Number(a.id) === h.supplier_address_id) : addresses[0];
    if (h.supplier_address_id && !address) throw bad("That address isn't the supplier's — pick it again");
    const contact = await this.db.one('SELECT name, phone, email FROM supplier_contacts WHERE supplier_id = :s ORDER BY is_primary DESC, id LIMIT 1', { s: supplier.id }, t);

    // Products on the lines must be the company's own.
    const raw: any[] = Array.isArray(body?.items) ? body.items : [];
    const productIds = [...new Set(raw.map((r) => Number(r?.product_id)).filter((x) => x > 0))];
    const products = productIds.length
      ? await this.db.sel('SELECT id, name, product_code, unit, tax_percentage FROM products WHERE company_id = :c AND id IN (:ids)', { c, ids: productIds }, t)
      : [];
    if (products.length !== productIds.length) throw bad("Some products aren't in your product list — pick them again");
    const pmap = new Map(products.map((p) => [Number(p.id), p]));
    const parsed = parseLines(raw, {
      gstFor: (r) => {
        const rate = Number(pmap.get(Number(r?.product_id))?.tax_percentage);
        return rate > 0 ? rate : DEFAULT_GST;
      },
    });
    if (!parsed.ok) throw bad(parsed.message);
    const lines = parsed.lines.map((l) => {
      const p = l.product_id ? pmap.get(l.product_id) : null;
      const hsn = l.hsn_code || (p && /^[0-9]{2,8}$/.test(String(p.product_code || '').trim()) ? String(p.product_code).trim() : null);
      return { ...l, hsn_code: hsn, unit: l.unit || p?.unit || null };
    });

    const buyer = await this.db.buyer(c, h.issuing_location_id, t);
    const wh = await this.db.warehouse(c, h.warehouse_id, t);
    if (h.warehouse_id && !wh) throw bad("That warehouse isn't active — pick another one");
    const placeCode = placeCodeFrom(wh?.state_code, buyer.state_code, buyer.gstin);
    const supplierGstin = address?.gstin || supplier.gstin;
    const taxType = purchaseTaxType({ gst_type: supplier.gst_type, gstin: supplierGstin, state_code: address?.state_code || supplier.state_code }, placeCode);
    const freightTaxed = await companyTaxesTransport(this.db.sequelize, c, t);
    const totals = docTotals(lines, h.freight_charges, taxType, freightTaxed);
    const settings = await this.db.settings(c, t);

    const supplierSnapshot = {
      id: Number(supplier.id),
      name: supplier.name,
      legal_name: supplier.legal_name,
      gst_type: supplier.gst_type,
      gstin: supplierGstin || null,
      pan: supplier.pan,
      state: address?.state || supplier.state,
      state_code: address?.state_code || supplier.state_code || (supplierGstin ? String(supplierGstin).slice(0, 2) : null),
      msme_type: supplier.msme_type,
      udyam_number: supplier.udyam_number,
      phone: contact?.phone || supplier.phone,
      email: contact?.email || supplier.email,
      contact_name: contact?.name || null,
      address: address
        ? {
            id: Number(address.id),
            label: address.label,
            lines: [address.address_line_1, address.address_line_2, [address.city, address.state, address.postal_code].filter(Boolean).join(', ')].filter(Boolean),
          }
        : null,
    };
    const shipTo = wh
      ? { warehouse_id: wh.id, name: wh.name, lines: [wh.address, [wh.city, wh.state].filter(Boolean).join(', ')].filter(Boolean), state: wh.state, state_code: wh.state_code }
      : null;
    const credit = supplier.credit_days === null || supplier.credit_days === undefined ? null : Number(supplier.credit_days);
    return {
      h,
      lines: totals.lines,
      totals,
      taxType,
      placeCode,
      settings,
      values: {
        supplier_id: Number(supplier.id),
        supplier_address_id: address ? Number(address.id) : null,
        supplier_snapshot: JSON.stringify(supplierSnapshot),
        supplier_ref: h.supplier_ref,
        po_date: h.po_date,
        expected_date: h.expected_date,
        issuing_location_id: buyer.location_id,
        buyer_snapshot: JSON.stringify(buyer),
        warehouse_id: wh?.id ?? null,
        ship_to_snapshot: shipTo ? JSON.stringify(shipTo) : null,
        place_of_supply: placeCode ? placeCodeLabel(placeCode) : null,
        place_of_supply_code: placeCode,
        tax_type: taxType,
        sub_total: totals.sub_total,
        discount_amount: totals.discount_amount,
        freight_charges: totals.freight_charges,
        freight_gst: totals.freight_gst,
        taxable_amount: totals.taxable_amount,
        cgst_amount: totals.cgst_amount,
        sgst_amount: totals.sgst_amount,
        igst_amount: totals.igst_amount,
        round_off: totals.round_off,
        grand_total: totals.grand_total,
        payment_terms:
          body?.payment_terms !== undefined ? h.payment_terms : settings.default_payment_terms || (credit !== null ? (credit ? `${credit} days from receipt of goods and invoice` : 'Payment on delivery') : null),
        delivery_terms: body?.delivery_terms !== undefined ? h.delivery_terms : settings.default_delivery_terms,
        notes: h.notes,
        terms_conditions: body?.terms_conditions !== undefined ? h.terms_conditions : settings.default_terms || DEFAULT_PO_TERMS,
      },
    };
  }

  /** Writes the lines: updates the ones that exist, adds new ones, removes the rest. */
  private async saveLines(poId: number, lines: (DocLine & { po_item_id?: number | null; amount?: number })[], t: any) {
    const existing = await this.db.sel('SELECT id FROM purchase_order_items WHERE po_id = :po', { po: poId }, t);
    const keep = new Set<number>();
    for (const [i, l] of lines.entries()) {
      const vals = {
        po: poId,
        line_no: i + 1,
        product_id: l.product_id,
        item_name: l.item_name,
        description: l.description,
        hsn: l.hsn_code,
        unit: l.unit,
        qty: l.qty,
        rate: l.rate,
        disc: l.discount_percent,
        gst: l.gst_rate,
        amount: l.amount ?? lineAmount(l),
      };
      const id = l.po_item_id && existing.some((e) => Number(e.id) === Number(l.po_item_id)) ? Number(l.po_item_id) : null;
      if (id) {
        keep.add(id);
        await this.db.run(
          `UPDATE purchase_order_items SET line_no = :line_no, product_id = :product_id, item_name = :item_name, description = :description, hsn_code = :hsn,
                  unit = :unit, qty = :qty, rate = :rate, discount_percent = :disc, gst_rate = :gst, amount = :amount WHERE id = :id AND po_id = :po`,
          { ...vals, id },
          t,
        );
      } else {
        await this.db.insert(
          `INSERT INTO purchase_order_items (po_id, line_no, product_id, item_name, description, hsn_code, unit, qty, rate, discount_percent, gst_rate, amount)
           VALUES (:po, :line_no, :product_id, :item_name, :description, :hsn, :unit, :qty, :rate, :disc, :gst, :amount)`,
          vals,
          t,
        );
      }
    }
    const drop = existing.map((e) => Number(e.id)).filter((id) => !keep.has(id));
    if (drop.length) await this.db.run('DELETE FROM purchase_order_items WHERE po_id = :po AND id IN (:drop)', { po: poId, drop }, t);
  }

  private async log(companyId: number, poId: number, action: string, userId: number | null, note: string | null, t?: any, snapshot?: unknown) {
    await this.db.insert(
      'INSERT INTO purchase_order_activity (company_id, po_id, action, note, snapshot, user_id) VALUES (:c, :po, :a, :note, :snap, :u)',
      { c: companyId, po: poId, a: action, note: note ? note.slice(0, 500) : null, snap: snapshot === undefined ? null : JSON.stringify(snapshot), u: userId },
      t,
    );
  }

  /** Approved straight away, or waiting for someone who can approve. */
  private decide(user: PurchaseUser, total: number, limit: number | null): 'APPROVED' | 'PENDING_APPROVAL' {
    return needsApproval(total, can(user, PURCHASE_PERMS.approve), limit) ? 'PENDING_APPROVAL' : 'APPROVED';
  }

  private async tellApprovers(user: PurchaseUser, po: { id: number; po_number: string; grand_total: number; supplier: string }) {
    const who = (await this.db.userName(user.user_id)) || 'Someone';
    const ids = await this.db.approvers(user.company_id);
    void this.notifications.notify({
      companyId: user.company_id,
      userIds: ids,
      module: PURCHASES_MODULE,
      type: 'PO_APPROVAL',
      title: `${po.po_number} needs your approval`,
      body: `${who} raised ${inr(po.grand_total)} for ${po.supplier}.`,
      link: `/app/purchase-orders?open=${po.id}`,
      entityType: 'purchase_order',
      entityId: po.id,
      actorId: user.user_id,
    });
  }

  private async tellCreator(user: PurchaseUser, po: any, type: string, title: string, body: string | null) {
    if (!po.created_by) return;
    void this.notifications.notify({
      companyId: user.company_id,
      userIds: [Number(po.created_by)],
      module: PURCHASES_MODULE,
      type,
      title,
      body,
      link: `/app/purchase-orders?open=${po.id}`,
      entityType: 'purchase_order',
      entityId: Number(po.id),
      actorId: user.user_id,
    });
  }

  // ── Create, edit, approve ────────────────────────────────────────────────

  /**
   * The editor's live figures: GST type, every line's tax, totals and whether
   * the PO would wait for approval — the same maths as saving, nothing saved.
   */
  async preview(user: PurchaseUser, body: any) {
    const b = await this.build(user, { ...body, items: (Array.isArray(body?.items) ? body.items : []).filter((i: any) => String(i?.item_name ?? '').trim()) }, undefined);
    return {
      tax_type: b.taxType,
      place_of_supply: b.values.place_of_supply,
      place_of_supply_code: b.placeCode,
      freight_gst: b.totals.freight_gst === 1,
      sub_total: b.totals.sub_total,
      discount_amount: b.totals.discount_amount,
      items_value: b.totals.items_value,
      freight_charges: b.totals.freight_charges,
      taxable_amount: b.totals.taxable_amount,
      cgst_amount: b.totals.cgst_amount,
      sgst_amount: b.totals.sgst_amount,
      igst_amount: b.totals.igst_amount,
      round_off: b.totals.round_off,
      grand_total: b.totals.grand_total,
      lines: b.lines.map((l) => ({ amount: l.amount, tax: round2(l.cgst + l.sgst + l.igst), gst_rate: l.gst_rate, hsn_code: l.hsn_code, unit: l.unit })),
      approval: this.decide(user, b.totals.grand_total, b.settings.approval_limit),
      payment_terms: b.values.payment_terms,
      delivery_terms: b.values.delivery_terms,
      terms_conditions: b.values.terms_conditions,
    };
  }

  async create(user: PurchaseUser, body: any) {
    const c = user.company_id;
    const submit = body?.submit === true || body?.submit === 'true';
    const out = await this.db.tx(async (t) => {
      const b = await this.build(user, body, t);
      const status = submit ? this.decide(user, b.totals.grand_total, b.settings.approval_limit) : 'DRAFT';
      const quotationId = Number(body?.quotation_id) > 0 ? Number(body.quotation_id) : null;
      if (quotationId && !(await this.db.one('SELECT id FROM quotations WHERE id = :q AND company_id = :c', { q: quotationId, c }, t))) {
        throw bad("That customer quotation isn't yours");
      }
      const { number, seriesId } = await this.db.nextNumber(c, 'PURCHASE_ORDER', t, Number(body?.series_id) || null);
      const v = { ...b.values, quotation_id: quotationId };
      const cols = Object.keys(v);
      const id = await this.db.insert(
        `INSERT INTO purchase_orders (company_id, po_number, series_id, status, ${cols.join(', ')}, submitted_at, approved_by, approved_at, created_by, updated_by)
         VALUES (:company_id, :po_number, :series_id, :status, ${cols.map((k) => `:${k}`).join(', ')}, ${submit ? 'NOW()' : 'NULL'}, :approved_by, ${status === 'APPROVED' ? 'NOW()' : 'NULL'}, :u, :u)`,
        { company_id: c, po_number: number, series_id: seriesId, status, ...v, approved_by: status === 'APPROVED' ? user.user_id : null, u: user.user_id },
        t,
      );
      await this.saveLines(id, b.lines, t);
      await this.log(c, id, 'CREATED', user.user_id, submit ? (status === 'APPROVED' ? 'Made and approved' : 'Made and sent for approval') : 'Saved as a draft', t);
      return { id, number, status, total: b.totals.grand_total, supplier: JSON.parse(v.supplier_snapshot).name };
    });
    if (out.status === 'PENDING_APPROVAL') await this.tellApprovers(user, { id: out.id, po_number: out.number, grand_total: out.total, supplier: out.supplier });
    return { ...(await this.get(user, out.id)), message: messageFor(out.number, out.status) };
  }

  async update(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const submit = body?.submit === true || body?.submit === 'true';
    const out = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (!DRAFT_STATUSES.includes(po.status)) {
        throw bad(`${po.po_number} is ${word(po.status)} — ${AMENDABLE_STATUSES.includes(po.status) ? 'amend it instead' : "it can't be changed"}`);
      }
      const b = await this.build(user, body, t, { po });
      const status = submit ? this.decide(user, b.totals.grand_total, b.settings.approval_limit) : 'DRAFT';
      const v = b.values;
      await this.db.run(
        `UPDATE purchase_orders SET ${Object.keys(v).map((k) => `${k} = :${k}`).join(', ')}, status = :status,
                submitted_at = ${submit ? 'NOW()' : 'NULL'}, approved_by = :approved_by, approved_at = ${status === 'APPROVED' ? 'NOW()' : 'NULL'}, updated_by = :u
          WHERE id = :id AND company_id = :c`,
        { ...v, status, approved_by: status === 'APPROVED' ? user.user_id : null, u: user.user_id, id, c },
        t,
      );
      await this.saveLines(id, b.lines, t);
      await this.log(c, id, submit ? 'SUBMITTED' : 'UPDATED', user.user_id, submit ? (status === 'APPROVED' ? 'Saved and approved' : 'Saved and sent for approval') : 'Draft saved', t);
      return { number: po.po_number, status, total: b.totals.grand_total, supplier: JSON.parse(v.supplier_snapshot).name };
    });
    if (out.status === 'PENDING_APPROVAL') await this.tellApprovers(user, { id, po_number: out.number, grand_total: out.total, supplier: out.supplier });
    return { ...(await this.get(user, id)), message: messageFor(out.number, out.status) };
  }

  /** Send a draft for approval (or approve it, for someone who can). */
  async submit(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const out = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (po.status !== 'DRAFT') throw bad(`${po.po_number} is ${word(po.status)}, not a draft`);
      const settings = await this.db.settings(c, t);
      const status = this.decide(user, round2(po.grand_total), settings.approval_limit);
      await this.db.run(
        `UPDATE purchase_orders SET status = :s, submitted_at = NOW(), approved_by = :ab, approved_at = ${status === 'APPROVED' ? 'NOW()' : 'NULL'}, updated_by = :u WHERE id = :id`,
        { s: status, ab: status === 'APPROVED' ? user.user_id : null, u: user.user_id, id },
        t,
      );
      await this.log(c, id, status === 'APPROVED' ? 'APPROVED' : 'SUBMITTED', user.user_id, status === 'APPROVED' ? 'Approved' : 'Sent for approval', t);
      return { status, number: po.po_number, total: round2(po.grand_total), supplier: parseJson(po.supplier_snapshot)?.name || '' };
    });
    if (out.status === 'PENDING_APPROVAL') await this.tellApprovers(user, { id, po_number: out.number, grand_total: out.total, supplier: out.supplier });
    return { ...(await this.get(user, id)), message: messageFor(out.number, out.status) };
  }

  async approve(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const po = await this.db.tx(async (t) => {
      const row = await this.poRow(c, id, t, true);
      if (row.status !== 'PENDING_APPROVAL') throw bad(`${row.po_number} is ${word(row.status)} — only a PO waiting for approval can be approved`);
      await this.db.run(`UPDATE purchase_orders SET status = 'APPROVED', approved_by = :u, approved_at = NOW(), updated_by = :u WHERE id = :id`, { u: user.user_id, id }, t);
      await this.log(c, id, 'APPROVED', user.user_id, 'Approved', t);
      return row;
    });
    const who = (await this.db.userName(user.user_id)) || 'An approver';
    await this.tellCreator(user, po, 'PO_APPROVED', `${po.po_number} is approved`, `${who} approved it — you can send it to the supplier now.`);
    return { ...(await this.get(user, id)), message: `${po.po_number} approved` };
  }

  async sendBack(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const note = parseReason(body?.note, 'a note for the person who made it');
    if (!note.ok) throw bad(note.message);
    const po = await this.db.tx(async (t) => {
      const row = await this.poRow(c, id, t, true);
      if (row.status !== 'PENDING_APPROVAL') throw bad(`${row.po_number} is ${word(row.status)} — only a PO waiting for approval can be sent back`);
      await this.db.run(`UPDATE purchase_orders SET status = 'DRAFT', submitted_at = NULL, updated_by = :u WHERE id = :id`, { u: user.user_id, id }, t);
      await this.log(c, id, 'SENT_BACK', user.user_id, note.value, t);
      return row;
    });
    const who = (await this.db.userName(user.user_id)) || 'An approver';
    await this.tellCreator(user, po, 'PO_SENT_BACK', `${po.po_number} was sent back`, `${who}: ${note.value}`);
    return { ...(await this.get(user, id)), message: `${po.po_number} sent back as a draft` };
  }

  /** Record that the PO went to the supplier (PDF shared by email / WhatsApp). */
  async markSent(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const po = await this.db.tx(async (t) => {
      const row = await this.poRow(c, id, t, true);
      if (row.status !== 'APPROVED') throw bad(`${row.po_number} is ${word(row.status)} — only an approved PO is sent`);
      await this.db.run(`UPDATE purchase_orders SET status = 'SENT', sent_at = NOW(), updated_by = :u WHERE id = :id`, { u: user.user_id, id }, t);
      await this.log(c, id, 'SENT', user.user_id, Number(row.revision) ? `Amendment ${row.revision} sent to the supplier` : 'Sent to the supplier', t);
      return row;
    });
    return { ...(await this.get(user, id)), message: `${po.po_number} marked as sent` };
  }

  /**
   * Change an approved PO: a new amendment (revision + 1). The earlier version
   * stays in the history; lines with goods received keep at least that much.
   */
  async amend(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const out = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (!AMENDABLE_STATUSES.includes(po.status)) throw bad(`${po.po_number} is ${word(po.status)} — it can't be amended`);
      const ledger = await this.ledger(id, t);
      const b = await this.build(user, body, t, { po, amend: true });
      const problem = amendProblem(b.lines, ledger);
      if (problem) throw bad(problem);
      const before = { header: po, lines: await this.db.sel('SELECT * FROM purchase_order_items WHERE po_id = :id ORDER BY line_no, id', { id }, t) };
      const received = new Map(ledger.map((r) => [r.po_item_id, r.received]));
      const next = receiptStatus(
        b.lines.map((l) => ({ ordered: l.qty, received: l.po_item_id ? received.get(Number(l.po_item_id)) || 0 : 0 })),
        'APPROVED',
      );
      const revision = Number(po.revision || 0) + 1;
      const v = b.values;
      await this.db.run(
        `UPDATE purchase_orders SET ${Object.keys(v).map((k) => `${k} = :${k}`).join(', ')}, status = :status, revision = :rev,
                sent_at = ${next === 'APPROVED' ? 'NULL' : 'sent_at'}, approved_by = :u, approved_at = NOW(), updated_by = :u
          WHERE id = :id AND company_id = :c`,
        { ...v, status: next, rev: revision, u: user.user_id, id, c },
        t,
      );
      await this.saveLines(id, b.lines, t);
      const reason = typeof body?.amend_note === 'string' && body.amend_note.trim() ? ` — ${body.amend_note.trim().slice(0, 200)}` : '';
      await this.log(c, id, 'AMENDED', user.user_id, `Amendment ${revision}${reason}`, t, before);
      return { number: po.po_number, revision };
    });
    return { ...(await this.get(user, id)), message: `${out.number} amended (Amendment No. ${out.revision}) — send the new PDF to the supplier` };
  }

  async cancel(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const reason = parseReason(body?.reason);
    if (!reason.ok) throw bad(reason.message);
    const number = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      const ledger = await this.ledger(id, t);
      const blocker = cancelBlocker(po, ledger.some((r) => r.received > 0));
      if (blocker) throw bad(blocker);
      await this.db.run(`UPDATE purchase_orders SET status = 'CANCELLED', closed_by = :u, closed_at = NOW(), close_reason = :r, updated_by = :u WHERE id = :id`, { u: user.user_id, r: reason.value, id }, t);
      await this.log(c, id, 'CANCELLED', user.user_id, reason.value, t);
      return po.po_number;
    });
    return { ...(await this.get(user, id)), message: `${number} cancelled` };
  }

  /** Part came and the rest won't: stop expecting it. */
  async close(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const reason = parseReason(body?.reason);
    if (!reason.ok) throw bad(reason.message);
    const number = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      const ledger = await this.ledger(id, t);
      const blocker = closeBlocker(po, ledger.some((r) => r.received > 0));
      if (blocker) throw bad(blocker);
      await this.db.run(`UPDATE purchase_orders SET status = 'CLOSED', closed_by = :u, closed_at = NOW(), close_reason = :r, updated_by = :u WHERE id = :id`, { u: user.user_id, r: reason.value, id }, t);
      await this.log(c, id, 'CLOSED', user.user_id, reason.value, t);
      return po.po_number;
    });
    return { ...(await this.get(user, id)), message: `${number} closed — the rest is no longer expected` };
  }

  async reopen(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const number = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (po.status !== 'CLOSED') throw bad(`${po.po_number} is ${word(po.status)} — only a closed PO can be reopened`);
      const status = receiptStatus(await this.ledger(id, t), po.sent_at ? 'SENT' : 'APPROVED');
      await this.db.run(`UPDATE purchase_orders SET status = :s, closed_by = NULL, closed_at = NULL, close_reason = NULL, updated_by = :u WHERE id = :id`, { s: status, u: user.user_id, id }, t);
      await this.log(c, id, 'REOPENED', user.user_id, 'Reopened — the rest is expected again', t);
      return po.po_number;
    });
    return { ...(await this.get(user, id)), message: `${number} reopened` };
  }

  /** Delete a PO that never left: a draft or one still waiting for approval. */
  async remove(user: PurchaseUser, id: number) {
    const c = user.company_id;
    const number = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (!DRAFT_STATUSES.includes(po.status)) throw bad(`${po.po_number} is ${word(po.status)} — cancel it instead`);
      await this.db.run('DELETE FROM purchase_order_items WHERE po_id = :id', { id }, t);
      await this.db.run('DELETE FROM purchase_order_activity WHERE po_id = :id AND company_id = :c', { id, c }, t);
      await this.db.run('DELETE FROM purchase_orders WHERE id = :id AND company_id = :c', { id, c }, t);
      return po.po_number;
    });
    return { id, deleted: true, message: `${number} deleted` };
  }

  // ── Goods received (GRN) ─────────────────────────────────────────────────

  /** Goods arrived: a GRN, accepted quantities into stock, the PO's status follows. */
  async receive(user: PurchaseUser, id: number, body: any) {
    const c = user.company_id;
    const out = await this.db.tx(async (t) => {
      const po = await this.poRow(c, id, t, true);
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw bad(DRAFT_STATUSES.includes(po.status) ? `${po.po_number} isn't approved yet` : `${po.po_number} is ${word(po.status)} — nothing more is expected`);
      }
      const ledger = await this.ledger(id, t);
      const settings = await this.db.settings(c, t);
      const parsed = parseReceipt(body, ledger, { today: this.db.today(), poDate: isoDate(po.po_date) || this.db.today(), overPercent: settings.over_receipt_percent });
      if (!parsed.ok) throw bad(parsed.message);
      const wh = await this.db.warehouse(c, parsed.header.warehouse_id ?? (po.warehouse_id ? Number(po.warehouse_id) : null), t);
      if (!wh) throw bad('Choose the warehouse the goods went into');
      const items = await this.db.sel('SELECT id, product_id, item_name, unit, rate, discount_percent FROM purchase_order_items WHERE po_id = :id', { id }, t);
      const itemOf = new Map(items.map((i) => [Number(i.id), i]));
      const stock = parsed.lines
        .map((l) => ({ l, item: itemOf.get(l.po_item_id)! }))
        .filter((x) => x.item?.product_id && x.l.accepted_qty > 0);
      await lockRows(this.db.sequelize, t, stock.map((x) => ({ product_id: Number(x.item.product_id), warehouse_id: wh.id })));
      const { number, seriesId } = await this.db.nextNumber(c, 'GOODS_RECEIPT', t, Number(body?.series_id) || null);
      const batch = stock.length ? newBatch() : null;
      const h = parsed.header;
      const grnId = await this.db.insert(
        `INSERT INTO goods_receipts (company_id, grn_number, series_id, po_id, supplier_id, warehouse_id, receipt_date, supplier_challan_no, supplier_invoice_no,
                                     vehicle_number, eway_bill_number, transporter_name, notes, status, stock_batch_id, created_by)
         VALUES (:c, :n, :sid, :po, :s, :w, :d, :ch, :inv, :veh, :eway, :tr, :notes, 'RECEIVED', :batch, :u)`,
        {
          c,
          n: number,
          sid: seriesId,
          po: id,
          s: po.supplier_id,
          w: wh.id,
          d: h.receipt_date,
          ch: h.supplier_challan_no,
          inv: h.supplier_invoice_no,
          veh: h.vehicle_number,
          eway: h.eway_bill_number,
          tr: h.transporter_name,
          notes: h.notes,
          batch,
          u: user.user_id,
        },
        t,
      );
      for (const l of parsed.lines) {
        const item = itemOf.get(l.po_item_id)!;
        await this.db.insert(
          `INSERT INTO goods_receipt_items (grn_id, po_item_id, product_id, item_name, unit, received_qty, accepted_qty, rejected_qty, reject_reason, unit_cost)
           VALUES (:g, :pi, :p, :name, :unit, :rq, :aq, :xq, :why, :cost)`,
          {
            g: grnId,
            pi: l.po_item_id,
            p: item.product_id || null,
            name: item.item_name,
            unit: item.unit,
            rq: l.received_qty,
            aq: l.accepted_qty,
            xq: l.rejected_qty,
            why: l.reject_reason,
            cost: round2(Number(item.rate) * (1 - Number(item.discount_percent || 0) / 100)),
          },
          t,
        );
      }
      // Stock: accepted quantities into the warehouse, at the PO's net rate.
      const entries: LedgerEntry[] = [];
      for (const { l, item } of stock) {
        const qty = Math.round(l.accepted_qty);
        const after = await changeLevel(this.db.sequelize, t, Number(item.product_id), wh.id, qty);
        const cost = round2(Number(item.rate) * (1 - Number(item.discount_percent || 0) / 100));
        entries.push({
          company_id: c,
          product_id: Number(item.product_id),
          warehouse_id: wh.id,
          type: 'RECEIVED',
          quantity: qty,
          balance_after: after,
          unit_cost: cost,
          reference_type: 'grn',
          reference_id: grnId,
          reference_no: number,
          batch_id: batch,
          note: `${po.po_number}${h.supplier_invoice_no ? ` · bill ${h.supplier_invoice_no}` : h.supplier_challan_no ? ` · challan ${h.supplier_challan_no}` : ''}`,
          created_by: user.user_id,
        });
        if (cost > 0) {
          await this.db.run('UPDATE products SET cost_price = :cost, updated_at = NOW() WHERE id = :p AND company_id = :c', { cost, p: Number(item.product_id), c }, t);
        }
      }
      await record(this.db.sequelize, t, entries);
      await syncTotals(this.db.sequelize, t, stock.map((x) => Number(x.item.product_id)));
      const status = receiptStatus(await this.ledger(id, t), po.status);
      if (status !== po.status) await this.db.run('UPDATE purchase_orders SET status = :s, updated_by = :u WHERE id = :id', { s: status, u: user.user_id, id }, t);
      const what = parsed.lines.map((l) => `${round3(l.accepted_qty)} ${itemOf.get(l.po_item_id)?.unit || ''} ${itemOf.get(l.po_item_id)?.item_name || ''}`.replace(/\s+/g, ' ').trim()).join(', ');
      await this.log(c, id, 'RECEIVED', user.user_id, `${number} into ${wh.name}: ${what}`.slice(0, 500), t);
      return { grnId, number, status, warehouse: wh.name, units: stock.reduce((s, x) => s + Math.round(x.l.accepted_qty), 0) };
    });
    return {
      ...(await this.get(user, id)),
      grn: { id: out.grnId, grn_number: out.number },
      message: `${out.number} saved — ${out.units ? `${out.units} unit${out.units === 1 ? '' : 's'} added to ${out.warehouse}` : 'nothing added to stock'}${out.status === 'RECEIVED' ? '; everything ordered has arrived' : ''}`,
    };
  }

  /** Undo a GRN: its goods leave stock again (they must still be there) and the PO expects them again. */
  async cancelReceipt(user: PurchaseUser, grnId: number, body: any) {
    const c = user.company_id;
    const reason = parseReason(body?.reason);
    if (!reason.ok) throw bad(reason.message);
    const out = await this.db.tx(async (t) => {
      const grn = await this.db.one('SELECT * FROM goods_receipts WHERE id = :id AND company_id = :c FOR UPDATE', { id: grnId, c }, t);
      if (!grn) throw notFound('Goods received note');
      if (grn.status !== 'RECEIVED') throw bad(`${grn.grn_number} is already cancelled`);
      const po = await this.poRow(c, Number(grn.po_id), t, true);
      const items = await this.db.sel('SELECT * FROM goods_receipt_items WHERE grn_id = :g', { g: grnId }, t);
      const ledger = await this.ledger(Number(po.id), t);
      for (const it of items) {
        const row = ledger.find((r) => r.po_item_id === Number(it.po_item_id));
        if (row && (row.billed || 0) > round3(row.received - Number(it.accepted_qty)) + 0.0005) {
          throw bad(`${it.item_name}: these goods are on a supplier bill already — cancel that bill first`);
        }
      }
      const stock = items.filter((it) => it.product_id && Number(it.accepted_qty) > 0);
      const wh = Number(grn.warehouse_id);
      await lockRows(this.db.sequelize, t, stock.map((it) => ({ product_id: Number(it.product_id), warehouse_id: wh })));
      for (const it of stock) {
        const level = await levelOf(this.db.sequelize, t, Number(it.product_id), wh);
        if (level < Math.round(Number(it.accepted_qty))) {
          throw bad(`${it.item_name}: only ${level} left in that warehouse, so the ${Math.round(Number(it.accepted_qty))} received can't be taken back out`);
        }
      }
      const batch = stock.length ? newBatch() : null;
      const entries: LedgerEntry[] = [];
      for (const it of stock) {
        const qty = Math.round(Number(it.accepted_qty));
        const after = await changeLevel(this.db.sequelize, t, Number(it.product_id), wh, -qty);
        entries.push({
          company_id: c,
          product_id: Number(it.product_id),
          warehouse_id: wh,
          type: 'RECEIVE_CANCELLED',
          quantity: -qty,
          balance_after: after,
          unit_cost: it.unit_cost === null ? null : round2(it.unit_cost),
          reason: reason.value,
          reference_type: 'grn',
          reference_id: grnId,
          reference_no: grn.grn_number,
          batch_id: batch,
          note: po.po_number,
          created_by: user.user_id,
        });
      }
      await record(this.db.sequelize, t, entries);
      await syncTotals(this.db.sequelize, t, stock.map((it) => Number(it.product_id)));
      await this.db.run(
        `UPDATE goods_receipts SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`,
        { r: reason.value, u: user.user_id, id: grnId },
        t,
      );
      if (po.status !== 'CLOSED') {
        const status = receiptStatus(await this.ledger(Number(po.id), t), po.sent_at ? 'SENT' : 'APPROVED');
        if (status !== po.status) await this.db.run('UPDATE purchase_orders SET status = :s, updated_by = :u WHERE id = :id', { s: status, u: user.user_id, id: po.id }, t);
      }
      await this.log(c, Number(po.id), 'RECEIPT_CANCELLED', user.user_id, `${grn.grn_number}: ${reason.value}`, t);
      return { poId: Number(po.id), number: grn.grn_number };
    });
    return { ...(await this.get(user, out.poId)), message: `${out.number} cancelled — its goods were taken back out of stock` };
  }

  /** Recent goods received notes (the store's list). */
  async receipts(user: PurchaseUser, query: any) {
    const c = user.company_id;
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchTerm(query?.q);
    const rows = await this.db.sel(
      `SELECT r.id, r.grn_number, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS receipt_date, r.status, r.po_id, po.po_number, s.name AS supplier_name,
              w.name AS warehouse_name, r.supplier_invoice_no, r.supplier_challan_no,
              (SELECT COALESCE(SUM(g.accepted_qty), 0) FROM goods_receipt_items g WHERE g.grn_id = r.id) AS accepted,
              (SELECT COALESCE(SUM(g.rejected_qty), 0) FROM goods_receipt_items g WHERE g.grn_id = r.id) AS rejected
         FROM goods_receipts r JOIN purchase_orders po ON po.id = r.po_id JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN warehouses w ON w.id = r.warehouse_id
        WHERE r.company_id = :c ${q ? 'AND (r.grn_number LIKE :q OR po.po_number LIKE :q OR s.name LIKE :q OR r.supplier_invoice_no LIKE :q)' : ''}
        ORDER BY r.receipt_date DESC, r.id DESC LIMIT :limit OFFSET :offset`,
      { c, q: q ? `%${q}%` : null, limit, offset },
    );
    return {
      page,
      limit,
      rows: rows.map((r) => ({
        id: Number(r.id),
        grn_number: r.grn_number,
        receipt_date: r.receipt_date,
        status: r.status,
        po_id: Number(r.po_id),
        po_number: r.po_number,
        supplier_name: r.supplier_name,
        warehouse_name: r.warehouse_name,
        supplier_invoice_no: r.supplier_invoice_no,
        supplier_challan_no: r.supplier_challan_no,
        accepted: round3(r.accepted),
        rejected: round3(r.rejected),
      })),
    };
  }

  /**
   * Products for typed names (the AI Assistant's "draft a PO"): the exact
   * name (any case) wins; otherwise up to five that contain it.
   */
  async matchProducts(user: PurchaseUser, names: string[]) {
    const c = user.company_id;
    const out = new Map<string, { exact: any | null; options: any[] }>();
    for (const raw of [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 50)) {
      const k = raw.toLowerCase().replace(/\s+/g, ' ');
      const exact = await this.db.one(
        `SELECT id, name, unit, product_code, tax_percentage, cost_price FROM products WHERE company_id = :c AND is_active = 1 AND LOWER(TRIM(name)) = :k LIMIT 1`,
        { c, k },
      );
      const options = exact
        ? []
        : await this.db.sel(
            `SELECT id, name, unit, product_code, tax_percentage, cost_price FROM products WHERE company_id = :c AND is_active = 1 AND name LIKE :like ORDER BY CHAR_LENGTH(name), name LIMIT 5`,
            { c, like: `%${raw.replace(/[\\%_]/g, (m) => `\\${m}`)}%` },
          );
      out.set(raw, { exact, options });
    }
    return out;
  }

  // ── Order for a customer's quotation (back-to-back buying) ──────────────

  /**
   * What to order for an approved customer quotation: each line still to
   * send, less the stock you hold and what is already on order. Lines are
   * matched to your products by name (quotation lines carry no product id);
   * the last supplier and price come from earlier POs.
   */
  async forQuotation(user: PurchaseUser, quotationId: number) {
    const c = user.company_id;
    const qt = await this.db.one(
      `SELECT id, quotation_number, customer_name, status, COALESCE(has_invoice, 0) AS has_invoice FROM quotations
        WHERE id = :q AND company_id = :c AND COALESCE(status, '') <> 'DELETED'`,
      { q: quotationId, c },
    );
    if (!qt) throw notFound('Quotation');
    if (!BILLABLE_QUOTATION_STATUSES.includes(String(qt.status || '').toUpperCase()) && Number(qt.has_invoice) !== 1) {
      throw bad(`${qt.quotation_number} isn't approved yet — order from suppliers once the customer confirms`);
    }
    const items = await this.db.sel(
      `SELECT qi.id, qi.product_name, qi.hsn_code, qi.unit, qi.qty, ${SENT_QTY_SQL} AS sent
         FROM quotation_items qi WHERE qi.quotation_id = :q ORDER BY qi.id`,
      { q: quotationId },
    );
    const key = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const names = [...new Set(items.map((i) => key(i.product_name)).filter(Boolean))];
    const products = names.length
      ? await this.db.sel(
          `SELECT id, name, product_code, unit, tax_percentage, stock_quantity, cost_price FROM products
            WHERE company_id = :c AND is_active = 1 AND LOWER(TRIM(name)) IN (:names)`,
          { c, names },
        )
      : [];
    const byName = new Map(products.map((p) => [key(p.name), p]));
    const ids = products.map((p) => Number(p.id));
    // Items not in the product list have no stock to count, so what was
    // already bought for this quotation is subtracted instead (approved POs;
    // a closed PO counts only what arrived).
    const [onOrder, last, boughtRows] = await Promise.all([
      this.onOrder(user, ids),
      this.lastBought(user, ids),
      this.db.sel(
        `SELECT i.item_name,
                CASE WHEN po.status = 'CLOSED'
                     THEN COALESCE((SELECT SUM(g.accepted_qty) FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id
                                     WHERE g.po_item_id = i.id AND r.status = 'RECEIVED'), 0)
                     ELSE i.qty END AS qty
           FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
          WHERE po.company_id = :c AND po.quotation_id = :q AND i.product_id IS NULL
            AND po.status IN (${OPEN_IN}, 'RECEIVED', 'CLOSED')`,
        { c, q: quotationId },
      ),
    ]);
    const ordered = new Map(onOrder.map((o) => [o.product_id, o.on_order]));
    const lastOf = new Map(last.map((l) => [l.product_id, l]));
    // Several lines of the same product share its stock, first come first served.
    const left = new Map(products.map((p) => [Number(p.id), Math.max(0, Number(p.stock_quantity) || 0) + (ordered.get(Number(p.id)) || 0)]));
    const bought = new Map<string, number>();
    for (const b of boughtRows) bought.set(key(b.item_name), (bought.get(key(b.item_name)) || 0) + Number(b.qty));
    const lines = items.map((i) => {
      const p = byName.get(key(i.product_name));
      const need = Math.max(0, round3(Number(i.qty) - Number(i.sent)));
      if (!p) {
        const k = key(i.product_name);
        const done = bought.get(k) || 0;
        bought.set(k, Math.max(0, done - Number(i.qty)));
        // min(): what is left to send, but never more than is left to buy.
        const toOrder = Math.max(0, round3(Math.min(need, Number(i.qty) - done)));
        return { item_name: i.product_name, product_id: null, hsn_code: i.hsn_code, unit: i.unit, need, in_stock: null, on_order: null, to_order: toOrder, rate: null, gst_rate: null, supplier_id: null, in_list: false };
      }
      const pid = Number(p.id);
      const cover = left.get(pid) || 0;
      const toOrder = Math.max(0, Math.ceil(need - cover));
      left.set(pid, Math.max(0, cover - need));
      const l = lastOf.get(pid);
      const hsn = /^[0-9]{2,8}$/.test(String(p.product_code || '').trim()) ? String(p.product_code).trim() : i.hsn_code;
      return {
        item_name: p.name,
        product_id: pid,
        hsn_code: hsn,
        unit: p.unit || i.unit,
        need,
        in_stock: Math.max(0, Number(p.stock_quantity) || 0),
        on_order: ordered.get(pid) || 0,
        to_order: toOrder,
        rate: l ? l.rate : Number(p.cost_price) > 0 ? round2(p.cost_price) : null,
        discount_percent: l ? l.discount_percent : 0,
        gst_rate: l ? l.gst_rate : Number(p.tax_percentage) > 0 ? round2(p.tax_percentage) : DEFAULT_GST,
        supplier_id: l ? l.supplier_id : null,
        in_list: true,
      };
    });
    const suppliers = [...new Set(lines.filter((l) => l.to_order > 0 && l.supplier_id).map((l) => l.supplier_id))];
    return {
      quotation: { id: Number(qt.id), number: qt.quotation_number, customer_name: qt.customer_name },
      supplier_id: suppliers.length === 1 ? suppliers[0] : null,
      lines,
      already: await this.db.sel(
        `SELECT id, po_number, status FROM purchase_orders WHERE company_id = :c AND quotation_id = :q AND status <> 'CANCELLED' ORDER BY id`,
        { c, q: quotationId },
      ),
    };
  }

  // ── Settings and stock helpers ───────────────────────────────────────────

  async getSettings(user: PurchaseUser) {
    const s = await this.db.settings(user.company_id);
    return { ...s, standard_terms: DEFAULT_PO_TERMS, can_edit: can(user, 'companies.edit') };
  }

  async saveSettings(user: PurchaseUser, body: any) {
    const parsed = parseSettings(body);
    if (!parsed.ok) throw bad(parsed.message);
    await this.db.saveSettings(user.company_id, user.user_id, parsed.value);
    return { ...(await this.getSettings(user)), message: 'Purchase settings saved' };
  }

  /** Quantities still expected from suppliers, per product (for the Products and Stock pages). */
  async onOrder(user: PurchaseUser, productIds: number[]) {
    const ids = [...new Set(productIds.filter((x) => Number.isInteger(x) && x > 0))].slice(0, 500);
    const rows = await this.db.sel(
      `SELECT i.product_id, SUM(GREATEST(i.qty - COALESCE((SELECT SUM(g.accepted_qty) FROM goods_receipt_items g JOIN goods_receipts r ON r.id = g.grn_id
                                                              WHERE g.po_item_id = i.id AND r.status = 'RECEIVED'), 0), 0)) AS pending,
              MIN(po.expected_date) AS next_date, COUNT(DISTINCT po.id) AS pos
         FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
        WHERE po.company_id = :c AND po.status IN (${OPEN_IN}) AND i.product_id IS NOT NULL ${ids.length ? 'AND i.product_id IN (:ids)' : ''}
        GROUP BY i.product_id HAVING pending > 0`,
      { c: user.company_id, ids },
    );
    return rows.map((r) => ({ product_id: Number(r.product_id), on_order: round3(r.pending), next_date: isoDate(r.next_date), pos: Number(r.pos) }));
  }

  /** Last supplier and price per product — for "Order now" drafts. */
  async lastBought(user: PurchaseUser, productIds: number[]) {
    const ids = [...new Set(productIds.filter((x) => Number.isInteger(x) && x > 0))].slice(0, 200);
    if (!ids.length) return [];
    const rows = await this.db.sel(
      `SELECT i.product_id, po.supplier_id, s.name AS supplier_name, i.rate, i.discount_percent, i.gst_rate, DATE_FORMAT(po.po_date, '%Y-%m-%d') AS po_date
         FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.company_id = :c AND po.status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'CANCELLED') AND i.product_id IN (:ids) AND s.is_active = 1
        ORDER BY po.po_date DESC, po.id DESC`,
      { c: user.company_id, ids },
    );
    const seen = new Set<number>();
    const out: any[] = [];
    for (const r of rows) {
      const p = Number(r.product_id);
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ product_id: p, supplier_id: Number(r.supplier_id), supplier_name: r.supplier_name, rate: round2(r.rate), discount_percent: round2(r.discount_percent), gst_rate: round2(r.gst_rate), po_date: r.po_date });
    }
    return out;
  }
}

/** The state's name for a GST state code (the PDF shows "Maharashtra (27)"). */
const placeCodeLabel = (code: string) => GST_STATE_CODES[code] || code;

const messageFor = (number: string, status: string) =>
  status === 'APPROVED' ? `${number} is approved — download the PDF and send it to the supplier` : status === 'PENDING_APPROVAL' ? `${number} sent for approval` : `${number} saved as a draft`;
