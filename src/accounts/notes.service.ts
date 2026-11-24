import { Injectable } from '@nestjs/common';
import { billStatus } from '../purchases/purchase.rules';
import { LedgerEntry, changeLevel, defaultWarehouse, levelOf, lockRows, newBatch, record, syncTotals } from '../stock/stock-ledger';
import { LedgerDb, LedgerUser, bad, notFound } from './ledger-db';
import { LedgerSyncService } from './ledger-sync.service';
import {
  NOTE_REASON_WORD,
  NoteReason,
  P,
  R,
  gstAt,
  gstOnLines,
  invoiceStatusAfter,
  noteGstDeadline,
  pageOf,
  parseNote,
  parseRefund,
  priceReturn,
  searchText,
  takeCredits,
  unitValues,
  voucherPrefix,
} from './ledger.rules';

const LIVE = `COALESCE(i.status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`;
const money = (p: number) => `₹${R(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (q: number) => Math.abs(q - Math.round(q)) < 1e-9;

export interface CreditSource {
  kind: 'receipt' | 'note';
  id: number;
  number: string;
  date: string;
  leftPaise: number;
}

/**
 * Accounts, step 3 — GST credit notes (against your invoices: goods returned
 * or price reduced), debit notes (against suppliers' bills), and refunds of a
 * customer's advance. Each changes the invoice's / bill's balance and stock
 * where goods move; the books record them by themselves (LedgerSyncService).
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly db: LedgerDb,
    private readonly books: LedgerSyncService,
  ) {}

  private get seq() {
    return this.db.sequelize;
  }

  private async ctx(c: number) {
    const s = await this.books.settings(c);
    return { today: this.db.today(), booksStart: s.books_start };
  }

  private async warehouses(c: number) {
    return (await this.db.sel(`SELECT id, name, is_default FROM warehouses WHERE company_id = :c AND is_active = 1 ORDER BY is_default DESC, name`, { c })).map((w) => ({
      id: Number(w.id),
      name: w.name,
      is_default: Number(w.is_default) === 1,
    }));
  }

  // ── A customer's advance (receipts not used, credit notes not applied) ─────

  /** What a customer has in advance, oldest first: unused receipts and unapplied credit notes, less refunds. */
  async creditSources(c: number, customerId: number, t?: any, lock = false): Promise<CreditSource[]> {
    const refunded = (col: string, id: string) =>
      `COALESCE((SELECT SUM(s.amount) FROM customer_refund_sources s JOIN customer_refunds f ON f.id = s.refund_id AND f.status = 'ACTIVE' WHERE s.${col} = ${id}), 0)`;
    const receipts = await this.db.sel(
      `SELECT r.id, r.receipt_number AS num, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS d,
              r.amount - COALESCE((SELECT SUM(p.payment_amount) FROM invoice_payments p WHERE p.receipt_id = r.id), 0) - ${refunded('receipt_id', 'r.id')} AS left_amt
         FROM customer_receipts r WHERE r.company_id = :c AND r.customer_id = :cust AND r.status = 'ACTIVE' ORDER BY r.receipt_date, r.id ${lock ? 'FOR UPDATE' : ''}`,
      { c, cust: customerId },
      t,
    );
    const notes = await this.db.sel(
      `SELECT n.id, n.cn_number AS num, DATE_FORMAT(n.cn_date, '%Y-%m-%d') AS d,
              n.total - COALESCE((SELECT SUM(a.amount) FROM credit_note_applications a WHERE a.credit_note_id = n.id), 0) - ${refunded('credit_note_id', 'n.id')} AS left_amt
         FROM credit_notes n WHERE n.company_id = :c AND n.customer_id = :cust AND n.status = 'ACTIVE' ORDER BY n.cn_date, n.id ${lock ? 'FOR UPDATE' : ''}`,
      { c, cust: customerId },
      t,
    );
    return [
      ...receipts.map((r) => ({ kind: 'receipt' as const, id: Number(r.id), number: r.num, date: r.d, leftPaise: Math.max(0, P(r.left_amt)) })),
      ...notes.map((n) => ({ kind: 'note' as const, id: Number(n.id), number: n.num, date: n.d, leftPaise: Math.max(0, P(n.left_amt)) })),
    ]
      .filter((x) => x.leftPaise > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }

  /**
   * Apply credit-note value to an invoice: recorded, the invoice's credited
   * amount, balance and status updated, history logged. `inv` holds the
   * invoice as locked (gross total, paid, credited, status).
   */
  async creditInvoice(t: any, userId: number, note: { id: number; number: string }, inv: any, paise: number, c: number) {
    if (paise <= 0) return;
    await this.db.insert(
      `INSERT INTO credit_note_applications (company_id, credit_note_id, invoice_id, amount, created_by) VALUES (:c, :n, :i, :a, :u)`,
      { c, n: note.id, i: inv.id, a: paise / 100, u: userId },
      t,
    );
    const credited = P(inv.credited) + paise;
    const due = P(inv.grand_total) - credited;
    const paid = P(inv.paid);
    const status = invoiceStatusAfter(inv.status, due, paid);
    await this.db.run(`UPDATE invoices SET credited_amount = :cr, balance_amount = :bal, status = :st, updated_at = NOW() WHERE id = :id`, { cr: credited / 100, bal: (due - paid) / 100, st: status, id: inv.id }, t);
    await this.db.run(
      `INSERT INTO invoice_activity_logs (invoice_id, action, changed_by, new_value, created_at) VALUES (:id, 'CREDIT_NOTE', :u, :v, NOW())`,
      { id: inv.id, u: userId, v: JSON.stringify({ credit_note: note.number, amount: R(paise), credited_amount: credited / 100, balance_amount: (due - paid) / 100 }) },
      t,
    );
    inv.credited = credited / 100;
    inv.status = status;
  }

  // ── Credit notes ───────────────────────────────────────────────────────────

  /** Invoices a credit note can be raised on (live ones, newest first; search by number or customer). */
  async noteInvoices(u: LedgerUser, query: any) {
    const c = u.company_id;
    const q = searchText(query?.q);
    const rows = await this.db.sel(
      `SELECT i.id, i.invoice_number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS d, i.customer_name, i.grand_total, COALESCE(i.credited_amount, 0) AS credited, i.balance_amount
         FROM invoices i WHERE i.company_id = :c AND ${LIVE} ${q ? 'AND (i.invoice_number LIKE :like OR i.customer_name LIKE :like)' : ''}
        ORDER BY i.invoice_date DESC, i.id DESC LIMIT 20`,
      { c, like: `%${q}%` },
    );
    return { rows: rows.map((r) => ({ id: Number(r.id), number: r.invoice_number, date: r.d, customer_name: r.customer_name, total: R(P(r.grand_total)), credited: R(P(r.credited)), balance: R(P(r.balance_amount)) })) };
  }

  private async invoiceLines(c: number, invoiceId: number, t?: any) {
    return this.db.sel(
      `SELECT ii.id, ii.product_name, ii.hsn_code, ii.unit, ii.qty, ii.rate, ii.discount_percent, ii.delivery_challan_item_id,
              dci.product_id AS challan_product,
              (SELECT p.id FROM products p WHERE p.company_id = :c AND p.is_active = 1 AND LOWER(TRIM(p.name)) COLLATE utf8mb4_unicode_ci = LOWER(TRIM(ii.product_name)) COLLATE utf8mb4_unicode_ci ORDER BY p.id LIMIT 1) AS name_product,
              COALESCE((SELECT SUM(ci.qty) FROM credit_note_items ci JOIN credit_notes n ON n.id = ci.credit_note_id AND n.status = 'ACTIVE' WHERE ci.invoice_item_id = ii.id), 0) AS returned
         FROM invoice_items ii LEFT JOIN delivery_challan_items dci ON dci.id = ii.delivery_challan_item_id
        WHERE ii.invoice_id = :id ORDER BY ii.id`,
      { c, id: invoiceId },
      t,
    );
  }

  private async invoiceHead(c: number, id: number, t?: any, lock = false) {
    const inv = await this.db.one(
      `SELECT i.id, i.invoice_number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS d, i.customer_id, i.customer_name, i.customer_gst_number, i.status,
              i.sub_total, i.discount_amount, i.cgst_percent, i.sgst_percent, i.igst_percent, i.grand_total,
              COALESCE(i.paid_amount, 0) AS paid, COALESCE(i.credited_amount, 0) AS credited,
              COALESCE((SELECT SUM(n.total) FROM credit_notes n WHERE n.invoice_id = i.id AND n.status = 'ACTIVE'), 0) AS noted,
              COALESCE((SELECT SUM(n.taxable_amount) FROM credit_notes n WHERE n.invoice_id = i.id AND n.status = 'ACTIVE'), 0) AS noted_taxable
         FROM invoices i WHERE i.id = :id AND i.company_id = :c AND ${LIVE} ${lock ? 'FOR UPDATE' : ''}`,
      { id, c },
      t,
    );
    if (!inv) throw notFound('Invoice');
    return inv;
  }

  /** Everything the credit-note form needs for one invoice: what can still come back, at what value, and GST rates. */
  async invoiceForNote(u: LedgerUser, invoiceId: number) {
    const c = u.company_id;
    const inv = await this.invoiceHead(c, invoiceId);
    const lines = await this.invoiceLines(c, invoiceId);
    const units = unitValues(inv, lines.map((l) => ({ id: Number(l.id), qty: l.qty, rate: l.rate, discount_percent: l.discount_percent })));
    const { today } = await this.ctx(c);
    const deadline = noteGstDeadline(inv.d);
    return {
      invoice: {
        id: Number(inv.id),
        number: inv.invoice_number,
        date: inv.d,
        customer_id: Number(inv.customer_id),
        customer_name: inv.customer_name,
        gstin: inv.customer_gst_number || null,
        total: R(P(inv.grand_total)),
        paid: R(P(inv.paid)),
        credited: R(P(inv.credited)),
        balance: R(P(inv.grand_total) - P(inv.paid) - P(inv.credited)),
        rates: { cgst: Number(inv.cgst_percent) || 0, sgst: Number(inv.sgst_percent) || 0, igst: Number(inv.igst_percent) || 0 },
      },
      lines: lines.map((l) => ({
        id: Number(l.id),
        name: l.product_name,
        hsn_code: l.hsn_code,
        unit: l.unit,
        qty: Number(l.qty),
        returned: Number(l.returned),
        left: Math.max(0, Math.round((Number(l.qty) - Number(l.returned)) * 1000) / 1000),
        unit_value: Math.round((units.get(Number(l.id)) || 0) * 100) / 100,
        product_id: Number(l.challan_product) || Number(l.name_product) || null,
        from_challan: !!l.delivery_challan_item_id,
      })),
      noted: R(P(inv.noted)),
      can_note: R(P(inv.grand_total) - P(inv.noted)),
      gst_deadline: deadline,
      gst_late: today > deadline,
      warehouses: await this.warehouses(c),
    };
  }

  /** Raise a credit note: GST at the invoice's rates; goods back into stock if asked; applied to the invoice up to its balance. */
  async createCreditNote(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseNote(body, { today, booksStart, docKey: 'invoice_id' });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    if (v.warehouseId && !(await this.db.one(`SELECT id FROM warehouses WHERE id = :id AND company_id = :c AND is_active = 1`, { id: v.warehouseId, c }))) throw bad('Choose one of your warehouses');
    const out = await this.db.tx(async (t) => {
      const inv = await this.invoiceHead(c, v.docId, t, true);
      if (v.date < inv.d) throw bad("A credit note can't be dated before its invoice");
      const lines = await this.invoiceLines(c, v.docId, t);
      const units = unitValues(inv, lines.map((l) => ({ id: Number(l.id), qty: l.qty, rate: l.rate, discount_percent: l.discount_percent })));
      let priced: { item_id: number; qty: number; rate: number; taxablePaise: number }[] = [];
      let taxable: number;
      if (v.lines) {
        const r = priceReturn(
          v.lines,
          lines.map((l) => ({ id: Number(l.id), name: l.product_name, qty: Number(l.qty), returned: Number(l.returned), unit: units.get(Number(l.id)) || 0 })),
        );
        if (!r.ok) throw bad(r.message);
        priced = r.lines;
        taxable = r.taxablePaise;
      } else taxable = v.taxablePaise as number;
      const gst = gstAt(taxable, { cgst: inv.cgst_percent, sgst: inv.sgst_percent, igst: inv.igst_percent });
      const total = taxable + gst.cgst + gst.sgst + gst.igst;
      const room = P(inv.grand_total) - P(inv.noted);
      if (total > room) throw bad(`That is more than is left to credit on ${inv.invoice_number} (${money(room)})`);
      const number = await this.db.nextNumber(c, voucherPrefix('CN', v.date), 'credit_notes', 'cn_number', t);
      const wh = v.stock ? (v.warehouseId ? { id: v.warehouseId } : await defaultWarehouse(this.seq, t, c)) : null;
      const id = await this.db.insert(
        `INSERT INTO credit_notes (company_id, cn_number, cn_date, invoice_id, customer_id, reason, note, taxable_amount, cgst_amount, sgst_amount, igst_amount, total, restock, warehouse_id, status, created_by)
         VALUES (:c, :no, :d, :inv, :cust, :reason, :note, :tx, :cg, :sg, :ig, :total, :restock, :wh, 'ACTIVE', :u)`,
        {
          c,
          no: number,
          d: v.date,
          inv: inv.id,
          cust: inv.customer_id,
          reason: v.reason,
          note: v.note,
          tx: taxable / 100,
          cg: gst.cgst / 100,
          sg: gst.sgst / 100,
          ig: gst.igst / 100,
          total: total / 100,
          restock: wh ? 1 : 0,
          wh: wh?.id ?? null,
          u: u.user_id,
        },
        t,
      );
      const byId = new Map(lines.map((l) => [Number(l.id), l]));
      for (const p of priced) {
        const l = byId.get(p.item_id);
        await this.db.insert(
          `INSERT INTO credit_note_items (credit_note_id, invoice_item_id, product_id, item_name, hsn_code, unit, qty, rate, taxable_amount) VALUES (:n, :ii, :p, :name, :hsn, :unit, :qty, :rate, :tx)`,
          { n: id, ii: p.item_id, p: Number(l.challan_product) || Number(l.name_product) || null, name: l.product_name, hsn: l.hsn_code, unit: l.unit, qty: p.qty, rate: p.rate, tx: p.taxablePaise / 100 },
          t,
        );
      }
      if (!priced.length) {
        await this.db.insert(
          `INSERT INTO credit_note_items (credit_note_id, item_name, taxable_amount) VALUES (:n, :name, :tx)`,
          { n: id, name: NOTE_REASON_WORD[v.reason as NoteReason], tx: taxable / 100 },
          t,
        );
      }
      // Goods back into stock (product lines, whole units).
      let restocked = 0;
      if (wh) {
        const moves = priced.map((p) => ({ p, product: Number(byId.get(p.item_id).challan_product) || Number(byId.get(p.item_id).name_product) || 0 })).filter((m) => m.product && whole(m.p.qty));
        if (moves.length) {
          await lockRows(this.seq, t, moves.map((m) => ({ product_id: m.product, warehouse_id: wh.id })));
          const batch = newBatch();
          const entries: LedgerEntry[] = [];
          for (const m of moves) {
            const after = await changeLevel(this.seq, t, m.product, wh.id, Math.round(m.p.qty));
            entries.push({ company_id: c, product_id: m.product, warehouse_id: wh.id, type: 'RETURN_IN' as const, quantity: Math.round(m.p.qty), balance_after: after, reference_type: 'credit_note', reference_id: id, reference_no: number, batch_id: batch, note: `Returned by ${String(inv.customer_name || '').slice(0, 120)}`, created_by: u.user_id });
            restocked += Math.round(m.p.qty);
          }
          await record(this.seq, t, entries);
          await syncTotals(this.seq, t, moves.map((m) => m.product));
        }
      }
      // Applied to its invoice, up to what is still due there.
      const dueLeft = P(inv.grand_total) - P(inv.credited) - P(inv.paid);
      const applied = Math.max(0, Math.min(total, dueLeft));
      await this.creditInvoice(t, u.user_id, { id, number }, inv, applied, c);
      return { id, number, total: R(total), applied: R(applied), advance: R(total - applied), restocked, invoice: inv.invoice_number };
    });
    this.books.touch(c);
    return {
      ...out,
      message: `${out.number}: ${money(P(out.total))} credited against ${out.invoice}${out.advance ? ` — ${money(P(out.advance))} is now their advance (already paid)` : ''}${out.restocked ? ` · ${out.restocked} back in stock` : ''}`,
    };
  }

  /** Cancel a credit note: invoices owe that again, returned goods go back out (if still in stock). */
  async cancelCreditNote(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const n = await this.db.tx(async (t) => {
      const note = await this.db.one(`SELECT * FROM credit_notes WHERE id = :id AND company_id = :c FOR UPDATE`, { id, c }, t);
      if (!note) throw notFound('Credit note');
      if (note.status !== 'ACTIVE') throw bad('This credit note is already cancelled');
      const refunded = await this.db.one(
        `SELECT COUNT(*) AS n FROM customer_refund_sources s JOIN customer_refunds f ON f.id = s.refund_id AND f.status = 'ACTIVE' WHERE s.credit_note_id = :id`,
        { id },
        t,
      );
      if (Number(refunded?.n)) throw bad('Part of this credit note was refunded — cancel that refund first');
      const apps = await this.db.sel(`SELECT invoice_id, SUM(amount) AS amt FROM credit_note_applications WHERE credit_note_id = :id GROUP BY invoice_id`, { id }, t);
      for (const a of apps) {
        const inv = await this.db.one(
          `SELECT id, grand_total, COALESCE(paid_amount, 0) AS paid, COALESCE(credited_amount, 0) AS credited, status FROM invoices WHERE id = :id AND company_id = :c FOR UPDATE`,
          { id: a.invoice_id, c },
          t,
        );
        if (!inv) continue;
        const credited = Math.max(0, P(inv.credited) - P(a.amt));
        const due = P(inv.grand_total) - credited;
        const paid = P(inv.paid);
        await this.db.run(`UPDATE invoices SET credited_amount = :cr, balance_amount = :bal, status = :st, updated_at = NOW() WHERE id = :id`, { cr: credited / 100, bal: (due - paid) / 100, st: invoiceStatusAfter(inv.status, due, paid), id: inv.id }, t);
        await this.db.run(
          `INSERT INTO invoice_activity_logs (invoice_id, action, changed_by, new_value, created_at) VALUES (:id, 'CREDIT_NOTE_CANCELLED', :u, :v, NOW())`,
          { id: inv.id, u: u.user_id, v: JSON.stringify({ credit_note: note.cn_number, amount: R(P(a.amt)), reason }) },
          t,
        );
      }
      await this.db.run(`DELETE FROM credit_note_applications WHERE credit_note_id = :id`, { id }, t);
      // Returned goods back out, while they are still there.
      const moved = await this.db.sel(`SELECT product_id, warehouse_id, quantity FROM stock_movements WHERE company_id = :c AND reference_type = 'credit_note' AND reference_id = :id AND type = 'RETURN_IN'`, { c, id }, t);
      if (moved.length) {
        await lockRows(this.seq, t, moved.map((m) => ({ product_id: Number(m.product_id), warehouse_id: Number(m.warehouse_id) })));
        const entries: LedgerEntry[] = [];
        const batch = newBatch();
        for (const m of moved) {
          const have = await levelOf(this.seq, t, Number(m.product_id), Number(m.warehouse_id));
          if (have < Number(m.quantity)) throw bad("Some of the returned goods have been sold or moved since, so the credit note can't be cancelled");
          const after = await changeLevel(this.seq, t, Number(m.product_id), Number(m.warehouse_id), -Number(m.quantity));
          entries.push({ company_id: c, product_id: Number(m.product_id), warehouse_id: Number(m.warehouse_id), type: 'RETURN_IN_CANCELLED' as const, quantity: -Number(m.quantity), balance_after: after, reference_type: 'credit_note', reference_id: id, reference_no: note.cn_number, batch_id: batch, note: `Credit note cancelled: ${reason.slice(0, 120)}`, created_by: u.user_id });
        }
        await record(this.seq, t, entries);
        await syncTotals(this.seq, t, moved.map((m) => Number(m.product_id)));
      }
      await this.db.run(`UPDATE credit_notes SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`, { id, r: reason.slice(0, 300), u: u.user_id }, t);
      return note;
    });
    this.books.touch(c);
    return { id, message: `${n.cn_number} cancelled` };
  }

  // ── Debit notes ────────────────────────────────────────────────────────────

  async noteBills(u: LedgerUser, query: any) {
    const c = u.company_id;
    const q = searchText(query?.q);
    const rows = await this.db.sel(
      `SELECT b.id, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS d, s.name AS supplier_name, b.grand_total, COALESCE(b.credited_amount, 0) AS credited, b.balance_amount
         FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.company_id = :c AND b.status <> 'CANCELLED' ${q ? 'AND (b.bill_number LIKE :like OR s.name LIKE :like)' : ''}
        ORDER BY b.bill_date DESC, b.id DESC LIMIT 20`,
      { c, like: `%${q}%` },
    );
    return { rows: rows.map((r) => ({ id: Number(r.id), number: r.bill_number, date: r.d, supplier_name: r.supplier_name, total: R(P(r.grand_total)), credited: R(P(r.credited)), balance: R(P(r.balance_amount)) })) };
  }

  private async billHead(c: number, id: number, t?: any, lock = false) {
    const b = await this.db.one(
      `SELECT b.id, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS d, b.supplier_id, s.name AS supplier_name, s.gstin, b.tax_type, b.status,
              b.sub_total, b.discount_amount, b.grand_total, COALESCE(b.paid_amount, 0) AS paid, COALESCE(b.credited_amount, 0) AS credited,
              COALESCE((SELECT SUM(n.total) FROM debit_notes n WHERE n.bill_id = b.id AND n.status = 'ACTIVE'), 0) AS noted
         FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.id = :id AND b.company_id = :c AND b.status <> 'CANCELLED' ${lock ? 'FOR UPDATE' : ''}`,
      { id, c },
      t,
    );
    if (!b) throw notFound('Bill');
    return b;
  }

  private billLines(billId: number, t?: any) {
    return this.db.sel(
      `SELECT bi.id, bi.item_name, bi.hsn_code, bi.unit, bi.qty, bi.rate, bi.discount_percent, bi.gst_rate, bi.product_id,
              COALESCE((SELECT SUM(di.qty) FROM debit_note_items di JOIN debit_notes n ON n.id = di.debit_note_id AND n.status = 'ACTIVE' WHERE di.bill_item_id = bi.id), 0) AS returned
         FROM purchase_bill_items bi WHERE bi.bill_id = :id ORDER BY bi.id`,
      { id: billId },
      t,
    );
  }

  async billForNote(u: LedgerUser, billId: number) {
    const c = u.company_id;
    const b = await this.billHead(c, billId);
    const lines = await this.billLines(billId);
    const units = unitValues(b, lines.map((l) => ({ id: Number(l.id), qty: l.qty, rate: l.rate, discount_percent: l.discount_percent })));
    const rates = [...new Set(lines.map((l) => Number(l.gst_rate)))];
    return {
      bill: {
        id: Number(b.id),
        number: b.bill_number,
        date: b.d,
        supplier_id: Number(b.supplier_id),
        supplier_name: b.supplier_name,
        gstin: b.gstin || null,
        tax_type: b.tax_type,
        total: R(P(b.grand_total)),
        paid: R(P(b.paid)),
        credited: R(P(b.credited)),
        balance: R(P(b.grand_total) - P(b.paid) - P(b.credited)),
        gst_rates: rates,
      },
      lines: lines.map((l) => ({
        id: Number(l.id),
        name: l.item_name,
        hsn_code: l.hsn_code,
        unit: l.unit,
        qty: Number(l.qty),
        returned: Number(l.returned),
        left: Math.max(0, Math.round((Number(l.qty) - Number(l.returned)) * 1000) / 1000),
        unit_value: Math.round((units.get(Number(l.id)) || 0) * 100) / 100,
        gst_rate: Number(l.gst_rate),
        product_id: l.product_id ? Number(l.product_id) : null,
      })),
      noted: R(P(b.noted)),
      can_note: R(P(b.grand_total) - P(b.noted)),
      warehouses: await this.warehouses(c),
    };
  }

  /** A debit note to a supplier: input GST reversed; returned goods out of stock; the bill owes less. */
  async createDebitNote(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseNote(body, { today, booksStart, docKey: 'bill_id' });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const gstRate = body?.gst_rate === undefined || body?.gst_rate === null || body?.gst_rate === '' ? null : Number(body.gst_rate);
    if (v.warehouseId && !(await this.db.one(`SELECT id FROM warehouses WHERE id = :id AND company_id = :c AND is_active = 1`, { id: v.warehouseId, c }))) throw bad('Choose one of your warehouses');
    const out = await this.db.tx(async (t) => {
      const b = await this.billHead(c, v.docId, t, true);
      if (v.date < b.d) throw bad("A debit note can't be dated before the bill");
      const lines = await this.billLines(v.docId, t);
      const units = unitValues(b, lines.map((l) => ({ id: Number(l.id), qty: l.qty, rate: l.rate, discount_percent: l.discount_percent })));
      const byId = new Map(lines.map((l) => [Number(l.id), l]));
      let priced: { item_id: number; qty: number; rate: number; taxablePaise: number }[] = [];
      let taxable: number;
      let gst: { cgst: number; sgst: number; igst: number };
      if (v.lines) {
        const r = priceReturn(
          v.lines,
          lines.map((l) => ({ id: Number(l.id), name: l.item_name, qty: Number(l.qty), returned: Number(l.returned), unit: units.get(Number(l.id)) || 0 })),
        );
        if (!r.ok) throw bad(r.message);
        priced = r.lines;
        taxable = r.taxablePaise;
        gst = gstOnLines(priced.map((p) => ({ taxablePaise: p.taxablePaise, gstRate: byId.get(p.item_id).gst_rate })), b.tax_type);
      } else {
        taxable = v.taxablePaise as number;
        const rates = [...new Set(lines.map((l) => Number(l.gst_rate)))];
        const rate = gstRate ?? (rates.length === 1 ? rates[0] : null);
        if (rate === null || !rates.includes(rate)) throw bad(`Choose the GST rate (${rates.join('% or ')}%)`);
        gst = gstOnLines([{ taxablePaise: taxable, gstRate: rate }], b.tax_type);
      }
      const total = taxable + gst.cgst + gst.sgst + gst.igst;
      const room = P(b.grand_total) - P(b.noted);
      if (total > room) throw bad(`That is more than is left on bill ${b.bill_number} (${money(room)})`);
      const number = await this.db.nextNumber(c, voucherPrefix('DN', v.date), 'debit_notes', 'dn_number', t);
      const wh = v.stock ? (v.warehouseId ? { id: v.warehouseId } : await defaultWarehouse(this.seq, t, c)) : null;
      const dueLeft = P(b.grand_total) - P(b.credited) - P(b.paid);
      const applied = Math.max(0, Math.min(total, dueLeft));
      const id = await this.db.insert(
        `INSERT INTO debit_notes (company_id, dn_number, dn_date, bill_id, supplier_id, reason, note, taxable_amount, cgst_amount, sgst_amount, igst_amount, total, applied_amount, unstock, warehouse_id, status, created_by)
         VALUES (:c, :no, :d, :bill, :sup, :reason, :note, :tx, :cg, :sg, :ig, :total, :applied, :unstock, :wh, 'ACTIVE', :u)`,
        {
          c,
          no: number,
          d: v.date,
          bill: b.id,
          sup: b.supplier_id,
          reason: v.reason,
          note: v.note,
          tx: taxable / 100,
          cg: gst.cgst / 100,
          sg: gst.sgst / 100,
          ig: gst.igst / 100,
          total: total / 100,
          applied: applied / 100,
          unstock: wh ? 1 : 0,
          wh: wh?.id ?? null,
          u: u.user_id,
        },
        t,
      );
      for (const p of priced) {
        const l = byId.get(p.item_id);
        await this.db.insert(
          `INSERT INTO debit_note_items (debit_note_id, bill_item_id, product_id, item_name, hsn_code, unit, qty, rate, gst_rate, taxable_amount) VALUES (:n, :bi, :p, :name, :hsn, :unit, :qty, :rate, :g, :tx)`,
          { n: id, bi: p.item_id, p: l.product_id || null, name: l.item_name, hsn: l.hsn_code, unit: l.unit, qty: p.qty, rate: p.rate, g: Number(l.gst_rate), tx: p.taxablePaise / 100 },
          t,
        );
      }
      if (!priced.length) {
        await this.db.insert(`INSERT INTO debit_note_items (debit_note_id, item_name, gst_rate, taxable_amount) VALUES (:n, :name, :g, :tx)`, { n: id, name: NOTE_REASON_WORD[v.reason as NoteReason], g: gstRate ?? 0, tx: taxable / 100 }, t);
      }
      // Goods back to the supplier: out of stock, only what is there.
      let unstocked = 0;
      if (wh) {
        const moves = priced.map((p) => ({ p, product: Number(byId.get(p.item_id).product_id) || 0, name: byId.get(p.item_id).item_name })).filter((m) => m.product && whole(m.p.qty));
        if (moves.length) {
          await lockRows(this.seq, t, moves.map((m) => ({ product_id: m.product, warehouse_id: wh.id })));
          const batch = newBatch();
          const entries: LedgerEntry[] = [];
          for (const m of moves) {
            const have = await levelOf(this.seq, t, m.product, wh.id);
            if (have < Math.round(m.p.qty)) throw bad(`${m.name}: only ${have} in stock there — choose the warehouse the goods go back from`);
            const after = await changeLevel(this.seq, t, m.product, wh.id, -Math.round(m.p.qty));
            entries.push({ company_id: c, product_id: m.product, warehouse_id: wh.id, type: 'RETURN_OUT' as const, quantity: -Math.round(m.p.qty), balance_after: after, reference_type: 'debit_note', reference_id: id, reference_no: number, batch_id: batch, note: `Returned to ${String(b.supplier_name || '').slice(0, 120)}`, created_by: u.user_id });
            unstocked += Math.round(m.p.qty);
          }
          await record(this.seq, t, entries);
          await syncTotals(this.seq, t, moves.map((m) => m.product));
        }
      }
      if (applied > 0) {
        const credited = P(b.credited) + applied;
        const due = P(b.grand_total) - credited;
        await this.db.run(
          `UPDATE purchase_bills SET credited_amount = :cr, balance_amount = :bal, status = :st, updated_by = :u WHERE id = :id`,
          { cr: credited / 100, bal: Math.max(0, due - P(b.paid)) / 100, st: billStatus(due / 100, P(b.paid) / 100), u: u.user_id, id: b.id },
          t,
        );
      }
      return { id, number, total: R(total), applied: R(applied), unstocked, bill: b.bill_number, supplier: b.supplier_name };
    });
    this.books.touch(c);
    const extra = R(P(out.total) - P(out.applied));
    return {
      ...out,
      message: `${out.number}: ${money(P(out.total))} against bill ${out.bill}${extra ? ` — ${money(P(extra))} is owed back by ${out.supplier} (already paid)` : ''}${out.unstocked ? ` · ${out.unstocked} out of stock` : ''}`,
    };
  }

  async cancelDebitNote(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const n = await this.db.tx(async (t) => {
      const note = await this.db.one(`SELECT * FROM debit_notes WHERE id = :id AND company_id = :c FOR UPDATE`, { id, c }, t);
      if (!note) throw notFound('Debit note');
      if (note.status !== 'ACTIVE') throw bad('This debit note is already cancelled');
      if (P(note.applied_amount) > 0) {
        const b = await this.db.one(`SELECT id, grand_total, COALESCE(paid_amount, 0) AS paid, COALESCE(credited_amount, 0) AS credited FROM purchase_bills WHERE id = :id FOR UPDATE`, { id: note.bill_id }, t);
        if (b) {
          const credited = Math.max(0, P(b.credited) - P(note.applied_amount));
          const due = P(b.grand_total) - credited;
          await this.db.run(
            `UPDATE purchase_bills SET credited_amount = :cr, balance_amount = :bal, status = :st, updated_by = :u WHERE id = :id`,
            { cr: credited / 100, bal: Math.max(0, due - P(b.paid)) / 100, st: billStatus(due / 100, P(b.paid) / 100), u: u.user_id, id: b.id },
            t,
          );
        }
      }
      const moved = await this.db.sel(`SELECT product_id, warehouse_id, quantity FROM stock_movements WHERE company_id = :c AND reference_type = 'debit_note' AND reference_id = :id AND type = 'RETURN_OUT'`, { c, id }, t);
      if (moved.length) {
        await lockRows(this.seq, t, moved.map((m) => ({ product_id: Number(m.product_id), warehouse_id: Number(m.warehouse_id) })));
        const entries: LedgerEntry[] = [];
        const batch = newBatch();
        for (const m of moved) {
          const qty = -Number(m.quantity);
          const after = await changeLevel(this.seq, t, Number(m.product_id), Number(m.warehouse_id), qty);
          entries.push({ company_id: c, product_id: Number(m.product_id), warehouse_id: Number(m.warehouse_id), type: 'RETURN_OUT_CANCELLED' as const, quantity: qty, balance_after: after, reference_type: 'debit_note', reference_id: id, reference_no: note.dn_number, batch_id: batch, note: `Debit note cancelled: ${reason.slice(0, 120)}`, created_by: u.user_id });
        }
        await record(this.seq, t, entries);
        await syncTotals(this.seq, t, moved.map((m) => Number(m.product_id)));
      }
      await this.db.run(`UPDATE debit_notes SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`, { id, r: reason.slice(0, 300), u: u.user_id }, t);
      return note;
    });
    this.books.touch(c);
    return { id, message: `${n.dn_number} cancelled` };
  }

  // ── Lists and one note (for its page and PDF) ──────────────────────────────

  async notes(u: LedgerUser, query: any) {
    const c = u.company_id;
    const kind = query?.kind === 'debit' ? 'debit' : 'credit';
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchText(query?.q);
    const params = { c, like: `%${q}%`, limit, offset };
    if (kind === 'credit') {
      const where = `n.company_id = :c ${q ? 'AND (n.cn_number LIKE :like OR i.invoice_number LIKE :like OR i.customer_name LIKE :like)' : ''}`;
      const [rows, total] = await Promise.all([
        this.db.sel(
          `SELECT n.id, n.cn_number AS number, DATE_FORMAT(n.cn_date, '%Y-%m-%d') AS d, n.reason, n.total, n.status, n.restock, i.invoice_number AS doc_number, i.id AS doc_id, i.customer_name AS party_name, n.customer_id AS party_id
             FROM credit_notes n LEFT JOIN invoices i ON i.id = n.invoice_id WHERE ${where} ORDER BY n.cn_date DESC, n.id DESC LIMIT :limit OFFSET :offset`,
          params,
        ),
        this.db.one(`SELECT COUNT(*) AS n FROM credit_notes n LEFT JOIN invoices i ON i.id = n.invoice_id WHERE ${where}`, params),
      ]);
      return { kind, rows: rows.map((r) => this.row(r)), total: Number(total?.n || 0), page, limit };
    }
    const where = `n.company_id = :c ${q ? 'AND (n.dn_number LIKE :like OR b.bill_number LIKE :like OR s.name LIKE :like)' : ''}`;
    const [rows, total] = await Promise.all([
      this.db.sel(
        `SELECT n.id, n.dn_number AS number, DATE_FORMAT(n.dn_date, '%Y-%m-%d') AS d, n.reason, n.total, n.status, n.unstock AS restock, b.bill_number AS doc_number, b.id AS doc_id, s.name AS party_name, n.supplier_id AS party_id
           FROM debit_notes n LEFT JOIN purchase_bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = n.supplier_id WHERE ${where} ORDER BY n.dn_date DESC, n.id DESC LIMIT :limit OFFSET :offset`,
        params,
      ),
      this.db.one(`SELECT COUNT(*) AS n FROM debit_notes n LEFT JOIN purchase_bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = n.supplier_id WHERE ${where}`, params),
    ]);
    return { kind, rows: rows.map((r) => this.row(r)), total: Number(total?.n || 0), page, limit };
  }

  private row(r: any) {
    return {
      id: Number(r.id),
      number: r.number,
      date: r.d,
      reason: r.reason,
      reason_word: NOTE_REASON_WORD[r.reason as NoteReason] || r.reason,
      total: R(P(r.total)),
      status: r.status,
      stock: Number(r.restock) === 1,
      doc_number: r.doc_number,
      doc_id: r.doc_id ? Number(r.doc_id) : null,
      party_name: r.party_name || '—',
      party_id: r.party_id ? Number(r.party_id) : null,
    };
  }

  /** One credit or debit note with its lines, parties and the letterhead (for the PDF). */
  async note(u: LedgerUser, kind: string, id: number) {
    const c = u.company_id;
    const co = await this.db.one(`SELECT name, legal_name, gst_no, gst_state_code, primary_email, primary_phone FROM companies WHERE id = :c`, { c });
    const a = await this.db.one(
      `SELECT line_1, line_2, city, state, postal_code FROM company_addresses WHERE company_id = :c AND COALESCE(is_active, 1) = 1 ORDER BY (LOWER(type) = 'office') DESC, is_default DESC, id LIMIT 1`,
      { c },
    );
    const company = {
      name: co?.name || 'Your company',
      gstin: co?.gst_no || null,
      phone: co?.primary_phone || null,
      email: co?.primary_email || null,
      address_lines: a ? [a.line_1, a.line_2, [a.city, a.state, a.postal_code].filter(Boolean).join(', ')].filter(Boolean) : [],
    };
    if (kind === 'debit') {
      const n = await this.db.one(
        `SELECT n.*, DATE_FORMAT(n.dn_date, '%Y-%m-%d') AS d, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bd, b.tax_type, s.name AS sname, s.gstin AS sgstin, s.state AS sstate, s.state_code AS scode, w.name AS wname
           FROM debit_notes n LEFT JOIN purchase_bills b ON b.id = n.bill_id LEFT JOIN suppliers s ON s.id = n.supplier_id LEFT JOIN warehouses w ON w.id = n.warehouse_id
          WHERE n.id = :id AND n.company_id = :c`,
        { id, c },
      );
      if (!n) throw notFound('Debit note');
      const items = await this.db.sel(`SELECT item_name, hsn_code, unit, qty, rate, gst_rate, taxable_amount FROM debit_note_items WHERE debit_note_id = :id ORDER BY id`, { id });
      const addr = await this.db.one(`SELECT address_line_1, address_line_2, city, state, postal_code FROM supplier_addresses WHERE supplier_id = :s ORDER BY is_primary DESC, id LIMIT 1`, { s: n.supplier_id });
      return this.noteView('debit', n, company, { name: n.sname, gstin: n.sgstin, lines: addrLines(addr) || (n.sstate ? [n.sstate] : []) }, { number: n.bill_number, date: n.bd, id: Number(n.bill_id) }, items, n.dn_number, n.d, n.wname);
    }
    const n = await this.db.one(
      `SELECT n.*, DATE_FORMAT(n.cn_date, '%Y-%m-%d') AS d, i.invoice_number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS idate, i.customer_name, i.customer_gst_number,
              i.billing_address_snapshot, i.cgst_percent, i.sgst_percent, i.igst_percent, w.name AS wname,
              COALESCE((SELECT SUM(a.amount) FROM credit_note_applications a WHERE a.credit_note_id = n.id), 0) AS applied
         FROM credit_notes n LEFT JOIN invoices i ON i.id = n.invoice_id LEFT JOIN warehouses w ON w.id = n.warehouse_id
        WHERE n.id = :id AND n.company_id = :c`,
      { id, c },
    );
    if (!n) throw notFound('Credit note');
    const items = await this.db.sel(`SELECT item_name, hsn_code, unit, qty, rate, taxable_amount FROM credit_note_items WHERE credit_note_id = :id ORDER BY id`, { id });
    let snap: any = n.billing_address_snapshot;
    try {
      while (typeof snap === 'string') snap = JSON.parse(snap);
    } catch {
      snap = null;
    }
    const lines = snap ? [[snap.address_line_1, snap.address_line_2].filter(Boolean).join(', '), [snap.city, snap.state, snap.postal_code].filter(Boolean).join(', ')].filter(Boolean) : [];
    return {
      ...this.noteView('credit', n, company, { name: n.customer_name, gstin: n.customer_gst_number, lines }, { number: n.invoice_number, date: n.idate, id: Number(n.invoice_id) }, items, n.cn_number, n.d, n.wname),
      rates: { cgst: Number(n.cgst_percent) || 0, sgst: Number(n.sgst_percent) || 0, igst: Number(n.igst_percent) || 0 },
      applied: R(P(n.applied)),
    };
  }

  private noteView(kind: 'credit' | 'debit', n: any, company: any, party: any, against: any, items: any[], number: string, date: string, warehouse: string | null) {
    return {
      kind,
      id: Number(n.id),
      number,
      date,
      status: n.status,
      cancel_reason: n.cancel_reason,
      reason: n.reason,
      reason_word: NOTE_REASON_WORD[n.reason as NoteReason] || n.reason,
      note: n.note,
      company,
      party,
      against,
      lines: items.map((i) => ({
        name: i.item_name,
        hsn_code: i.hsn_code,
        unit: i.unit,
        qty: i.qty === null ? null : Number(i.qty),
        rate: i.rate === null ? null : R(P(i.rate)),
        gst_rate: i.gst_rate === undefined ? null : Number(i.gst_rate),
        taxable: R(P(i.taxable_amount)),
      })),
      taxable: R(P(n.taxable_amount)),
      cgst: R(P(n.cgst_amount)),
      sgst: R(P(n.sgst_amount)),
      igst: R(P(n.igst_amount)),
      total: R(P(n.total)),
      stock: Number(kind === 'credit' ? n.restock : n.unstock) === 1,
      warehouse,
      gst_deadline: kind === 'credit' && against.date ? noteGstDeadline(against.date) : null,
    };
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  /** Pay a customer back from their advance (unused receipts first, then credit notes). */
  async refund(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseRefund(body, { today, booksStart });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const cust = await this.db.one(`SELECT id, COALESCE(NULLIF(display_name, ''), company_name) AS name FROM customers WHERE id = :id AND company_id = :c`, { id: v.customerId, c });
    if (!cust) throw notFound('Customer');
    if (v.bankAccountId && !(await this.db.one(`SELECT id FROM company_bank_accounts WHERE id = :id AND company_id = :c`, { id: v.bankAccountId, c }))) throw bad('Choose one of your bank accounts');
    const out = await this.db.tx(async (t) => {
      const sources = await this.creditSources(c, v.customerId, t, true);
      const have = sources.reduce((s, x) => s + x.leftPaise, 0);
      const take = takeCredits(sources, v.paise);
      if (!take) throw bad(have ? `${cust.name} has only ${money(have)} in advance to pay back` : `${cust.name} has no advance to pay back`);
      const number = await this.db.nextNumber(c, voucherPrefix('RFD', v.date), 'customer_refunds', 'refund_number', t);
      const id = await this.db.insert(
        `INSERT INTO customer_refunds (company_id, customer_id, refund_number, refund_date, amount, mode, bank_account_id, reference, notes, status, created_by)
         VALUES (:c, :cust, :no, :d, :amt, :mode, :bank, :ref, :notes, 'ACTIVE', :u)`,
        { c, cust: v.customerId, no: number, d: v.date, amt: v.paise / 100, mode: v.mode, bank: v.bankAccountId, ref: v.reference, notes: v.notes, u: u.user_id },
        t,
      );
      for (const x of take) {
        await this.db.insert(
          `INSERT INTO customer_refund_sources (refund_id, receipt_id, credit_note_id, amount) VALUES (:r, :rc, :cn, :a)`,
          { r: id, rc: x.source.kind === 'receipt' ? x.source.id : null, cn: x.source.kind === 'note' ? x.source.id : null, a: x.paise / 100 },
          t,
        );
      }
      return { id, number };
    });
    this.books.touch(c);
    return { ...out, message: `${out.number}: ${money(v.paise)} paid back to ${cust.name}` };
  }

  async cancelRefund(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const r = await this.db.one(`SELECT id, refund_number, status FROM customer_refunds WHERE id = :id AND company_id = :c`, { id, c });
    if (!r) throw notFound('Refund');
    if (r.status !== 'ACTIVE') throw bad('This refund is already cancelled');
    await this.db.run(`UPDATE customer_refunds SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`, { id, r: reason.slice(0, 300), u: u.user_id });
    this.books.touch(c);
    return { id, message: `${r.refund_number} cancelled — the money is their advance again` };
  }
}

function addrLines(a: any): string[] | null {
  if (!a) return null;
  return [[a.address_line_1, a.address_line_2].filter(Boolean).join(', '), [a.city, a.state, a.postal_code].filter(Boolean).join(', ')].filter(Boolean);
}
