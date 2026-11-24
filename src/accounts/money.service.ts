import { Injectable } from '@nestjs/common';
import { gstinProblem } from '../purchases/purchase.rules';
import { getStateCodeFromGstin } from '../common/gst-state.util';
import { statusAfterPayment } from '../invoice/invoice-insights.rules';
import { LedgerDb, LedgerError, LedgerUser, bad, notFound } from './ledger-db';
import { LedgerSyncService } from './ledger-sync.service';
import { NotesService } from './notes.service';
import {
  CASH_PAYMENT_LIMIT,
  CASH_RECEIPT_LIMIT,
  ENTRY_WORD,
  EXPENSE_ACCOUNTS,
  EXPENSE_GROUPS,
  EntryType,
  GROUPS,
  GroupCode,
  MoneyPlace,
  P,
  R,
  SYSTEM_ACCOUNTS,
  allocateReceipt,
  bankCode,
  bankLabel,
  drCr,
  fyStartOf,
  journalPosting,
  pageOf,
  parseExpense,
  parseJournal,
  parseNewAccount,
  parseRange,
  parseReceipt,
  parseTransfer,
  searchText,
  transferPosting,
  voucherPrefix,
  withRunningBalance,
} from './ledger.rules';

const LIVE = `COALESCE(i.status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`;
/** Expense heads you can book an expense against. */
const EXPENSE_LIKE: GroupCode[] = [...EXPENSE_GROUPS, 'PURCHASES', 'FIXED_ASSETS'];
const PARTY_NAME = `CASE e.party_type
    WHEN 'CUSTOMER' THEN (SELECT COALESCE(NULLIF(cu.display_name, ''), cu.company_name) FROM customers cu WHERE cu.id = e.party_id)
    WHEN 'SUPPLIER' THEN (SELECT su.name FROM suppliers su WHERE su.id = e.party_id) END`;
const MAX_ROWS = 5000;
const money = (p: number) => `₹${R(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Accounts, step 2 — money in and out: payments received for several
 * invoices (or as an advance), expenses, transfers between cash and banks,
 * journal entries; and the books to read them in: cash and bank books, any
 * account's ledger, the day book and the chart of accounts.
 */
@Injectable()
export class MoneyService {
  constructor(
    private readonly db: LedgerDb,
    private readonly books: LedgerSyncService,
    private readonly notes: NotesService,
  ) {}

  private async ctx(c: number) {
    const s = await this.books.settings(c);
    return { s, today: this.db.today(), booksStart: s.books_start };
  }

  private async ownBank(c: number, id: number | null, t?: any) {
    if (!id) return;
    const b = await this.db.one(`SELECT id FROM company_bank_accounts WHERE id = :id AND company_id = :c`, { id, c }, t);
    if (!b) throw bad('Choose one of your bank accounts');
  }

  private async customerName(c: number, id: number) {
    const row = await this.db.one(`SELECT id, COALESCE(NULLIF(display_name, ''), company_name) AS name FROM customers WHERE id = :id AND company_id = :c`, { id, c });
    if (!row) throw notFound('Customer');
    return row.name || '—';
  }

  // ── Money received from customers ──────────────────────────────────────────

  /** A customer's unpaid invoices (oldest first) and any advance they have with you. */
  async openInvoices(u: LedgerUser, customerId: number) {
    const c = u.company_id;
    const name = await this.customerName(c, customerId);
    const rows = await this.db.sel(
      `SELECT i.id, i.invoice_number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS d, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due, i.grand_total, COALESCE(i.paid_amount, 0) AS paid, COALESCE(i.credited_amount, 0) AS credited
         FROM invoices i
        WHERE i.company_id = :c AND i.customer_id = :id AND ${LIVE} AND i.grand_total - COALESCE(i.paid_amount, 0) - COALESCE(i.credited_amount, 0) > 0.004
        ORDER BY i.invoice_date, i.id`,
      { c, id: customerId },
    );
    return {
      customer: { id: customerId, name },
      invoices: rows.map((r) => ({ id: Number(r.id), number: r.invoice_number, date: r.d, due_date: r.due, total: R(P(r.grand_total)), balance: R(P(r.grand_total) - P(r.paid) - P(r.credited)) })),
      advance: R(await this.advanceOf(c, customerId)),
    };
  }

  /** A customer's advance (paise): receipts not used on invoices and credit notes not applied, less refunds. */
  private async advanceOf(c: number, customerId: number, t?: any) {
    return (await this.notes.creditSources(c, customerId, t)).reduce((s, x) => s + x.leftPaise, 0);
  }

  /** Pay invoices from a receipt: invoice_payments rows (linked to the receipt), invoices updated, history logged. */
  private async settle(t: any, userId: number, receipt: { id: number; number: string; mode: string; bank_account_id: number | null; reference: string | null }, open: any[], lines: { invoice_id: number; paise: number }[], date: string) {
    const settled: { invoice_id: number; number: string; amount: number; status: string }[] = [];
    for (const l of lines) {
      const inv = open.find((o) => Number(o.id) === l.invoice_id);
      const total = P(inv.grand_total);
      const paid = P(inv.paid) + l.paise;
      const status = statusAfterPayment(total, paid);
      // Paid on the receipt's date, or the invoice's when an advance pays a later invoice.
      const payDate = inv.d && inv.d > date ? inv.d : date;
      const ref = [receipt.number, receipt.reference].filter(Boolean).join(' · ');
      const payId = await this.db.insert(
        `INSERT INTO invoice_payments (invoice_id, payment_date, payment_amount, payment_mode, transaction_reference, remarks, received_by, receipt_id, bank_account_id, created_at)
         VALUES (:inv, :d, :amt, :mode, :ref, :remarks, :u, :rid, :bank, NOW())`,
        { inv: l.invoice_id, d: payDate, amt: l.paise / 100, mode: receipt.mode, ref: ref.slice(0, 255), remarks: `Receipt ${receipt.number}`, u: userId, rid: receipt.id, bank: receipt.bank_account_id },
        t,
      );
      await this.db.run(
        `UPDATE invoices SET paid_amount = :paid, balance_amount = :bal, status = :st, updated_at = NOW() WHERE id = :id`,
        { paid: paid / 100, bal: (total - paid) / 100, st: status, id: l.invoice_id },
        t,
      );
      await this.db.run(
        `INSERT INTO invoice_activity_logs (invoice_id, action, changed_by, new_value, created_at) VALUES (:id, :action, :u, :v, NOW())`,
        {
          id: l.invoice_id,
          action: status === 'PAID' ? 'INVOICE_PAID' : 'INVOICE_PARTIAL_PAID',
          u: userId,
          v: JSON.stringify({ payment_id: payId, payment_amount: l.paise / 100, payment_mode: receipt.mode, payment_date: payDate, receipt_number: receipt.number, paid_amount: paid / 100, balance_amount: (total - paid) / 100 }),
        },
        t,
      );
      inv.paid = paid / 100;
      settled.push({ invoice_id: l.invoice_id, number: inv.invoice_number, amount: R(l.paise), status });
    }
    return settled;
  }

  private lockOpen(c: number, customerId: number, t: any) {
    return this.db.sel(
      `SELECT i.id, i.invoice_number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS d, i.grand_total - COALESCE(i.credited_amount, 0) AS grand_total, COALESCE(i.paid_amount, 0) AS paid
         FROM invoices i
        WHERE i.company_id = :c AND i.customer_id = :id AND ${LIVE} AND i.grand_total - COALESCE(i.paid_amount, 0) - COALESCE(i.credited_amount, 0) > 0.004
        ORDER BY i.invoice_date, i.id FOR UPDATE`,
      { c, id: customerId },
      t,
    );
  }

  /** Money received from a customer: settles invoices (oldest first, or as chosen); the rest is an advance. */
  async receive(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseReceipt(body, { today, booksStart });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const name = await this.customerName(c, v.customerId);
    await this.ownBank(c, v.bankAccountId);
    const out = await this.db.tx(async (t) => {
      const open = await this.lockOpen(c, v.customerId, t);
      const alloc = allocateReceipt(
        v.paise,
        open.map((o) => ({ id: Number(o.id), number: o.invoice_number, balancePaise: P(o.grand_total) - P(o.paid) })),
        v.allocations,
      );
      if (!alloc.ok) throw bad(alloc.message);
      const number = await this.db.nextNumber(c, voucherPrefix('RCT', v.date), 'customer_receipts', 'receipt_number', t);
      const id = await this.db.insert(
        `INSERT INTO customer_receipts (company_id, customer_id, receipt_number, receipt_date, amount, mode, bank_account_id, reference, notes, status, created_by)
         VALUES (:c, :cust, :no, :d, :amt, :mode, :bank, :ref, :notes, 'ACTIVE', :u)`,
        { c, cust: v.customerId, no: number, d: v.date, amt: v.paise / 100, mode: v.mode, bank: v.bankAccountId, ref: v.reference, notes: v.notes, u: u.user_id },
        t,
      );
      const settled = await this.settle(t, u.user_id, { id, number, mode: v.mode, bank_account_id: v.bankAccountId, reference: v.reference }, open, alloc.lines, v.date);
      return { id, number, settled, advance: R(alloc.advance) };
    });
    this.books.touch(c);
    const warning =
      v.mode === 'CASH' && v.paise >= CASH_RECEIPT_LIMIT
        ? `${money(v.paise)} received in cash from one person in a day — the limit is ₹2,00,000 (Section 269ST). If it came by bank or UPI, cancel this receipt and enter it again with the right mode.`
        : null;
    const what = out.settled.length ? out.settled.map((s) => `${s.number} ${s.status === 'PAID' ? 'paid' : 'part paid'}`).join(', ') : 'no invoice due';
    return {
      ...out,
      customer: { id: v.customerId, name },
      amount: R(v.paise),
      warning,
      message: `${out.number}: ${money(v.paise)} received from ${name} — ${what}${out.advance ? ` · ${money(P(out.advance))} kept as advance` : ''}`,
    };
  }

  /** Use a customer's advance (unused receipts, unapplied credit notes) on their unpaid invoices, oldest first. */
  async applyAdvance(u: LedgerUser, body: any) {
    const c = u.company_id;
    const customerId = Number(body?.customer_id);
    if (!(Number.isInteger(customerId) && customerId > 0)) throw bad('Choose the customer');
    const name = await this.customerName(c, customerId);
    const done = await this.db.tx(async (t) => {
      const sources = await this.notes.creditSources(c, customerId, t, true);
      const receiptIds = sources.filter((s) => s.kind === 'receipt').map((s) => s.id);
      const receipts = receiptIds.length
        ? new Map((await this.db.sel(`SELECT id, mode, bank_account_id, reference FROM customer_receipts WHERE id IN (:ids)`, { ids: receiptIds }, t)).map((r) => [Number(r.id), r]))
        : new Map<number, any>();
      // open: grand_total here is what is to be paid (less credit notes already applied).
      const open = await this.lockOpen(c, customerId, t);
      const settled: any[] = [];
      for (const s of sources) {
        const stillOpen = open.filter((o) => P(o.grand_total) - P(o.paid) > 0);
        if (!stillOpen.length) break;
        const alloc = allocateReceipt(
          s.leftPaise,
          stillOpen.map((o) => ({ id: Number(o.id), number: o.invoice_number, balancePaise: P(o.grand_total) - P(o.paid) })),
          null,
        );
        if (!alloc.ok || !alloc.lines.length) continue;
        if (s.kind === 'receipt') {
          const r = receipts.get(s.id);
          settled.push(...(await this.settle(t, u.user_id, { id: s.id, number: s.number, mode: r.mode, bank_account_id: r.bank_account_id ? Number(r.bank_account_id) : null, reference: r.reference }, open, alloc.lines, s.date)));
        } else {
          for (const l of alloc.lines) {
            const inv = await this.db.one(
              `SELECT id, invoice_number, grand_total, COALESCE(paid_amount, 0) AS paid, COALESCE(credited_amount, 0) AS credited, status FROM invoices WHERE id = :id FOR UPDATE`,
              { id: l.invoice_id },
              t,
            );
            await this.notes.creditInvoice(t, u.user_id, { id: s.id, number: s.number }, inv, l.paise, c);
            const o = open.find((x) => Number(x.id) === l.invoice_id);
            if (o) o.grand_total = (P(o.grand_total) - l.paise) / 100;
            settled.push({ invoice_id: l.invoice_id, number: inv.invoice_number, amount: R(l.paise), status: inv.status });
          }
        }
      }
      return settled;
    });
    this.books.touch(c);
    if (!done.length) return { settled: [], message: `${name} has no advance to use, or nothing is due` };
    const total = done.reduce((s, x) => s + P(x.amount), 0);
    return { settled: done, message: `${money(total)} of ${name}'s advance used — ${done.map((s) => s.number).join(', ')}` };
  }

  /** Cancel a receipt: the invoices it paid go back to unpaid by that much; the books drop it. */
  async cancelReceipt(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const r = await this.db.tx(async (t) => {
      const rec = await this.db.one(`SELECT * FROM customer_receipts WHERE id = :id AND company_id = :c FOR UPDATE`, { id, c }, t);
      if (!rec) throw notFound('Receipt');
      if (rec.status !== 'ACTIVE') throw bad('This receipt is already cancelled');
      const refunded = await this.db.one(
        `SELECT COUNT(*) AS n FROM customer_refund_sources s JOIN customer_refunds f ON f.id = s.refund_id AND f.status = 'ACTIVE' WHERE s.receipt_id = :id`,
        { id },
        t,
      );
      if (Number(refunded?.n)) throw bad('Part of this receipt was refunded — cancel that refund first');
      const pays = await this.db.sel(`SELECT invoice_id, SUM(payment_amount) AS amt FROM invoice_payments WHERE receipt_id = :id GROUP BY invoice_id`, { id }, t);
      for (const p of pays) {
        const inv = await this.db.one(`SELECT id, grand_total - COALESCE(credited_amount, 0) AS grand_total, COALESCE(paid_amount, 0) AS paid FROM invoices WHERE id = :id AND company_id = :c FOR UPDATE`, { id: p.invoice_id, c }, t);
        if (!inv) continue;
        const total = P(inv.grand_total);
        const paid = Math.max(0, P(inv.paid) - P(p.amt));
        await this.db.run(`UPDATE invoices SET paid_amount = :paid, balance_amount = :bal, status = :st, updated_at = NOW() WHERE id = :id`, { paid: paid / 100, bal: (total - paid) / 100, st: statusAfterPayment(total, paid), id: inv.id }, t);
        await this.db.run(
          `INSERT INTO invoice_activity_logs (invoice_id, action, changed_by, new_value, created_at) VALUES (:id, 'PAYMENT_CANCELLED', :u, :v, NOW())`,
          { id: inv.id, u: u.user_id, v: JSON.stringify({ receipt_number: rec.receipt_number, amount: R(P(p.amt)), reason, paid_amount: paid / 100, balance_amount: (total - paid) / 100 }) },
          t,
        );
      }
      await this.db.run(`DELETE FROM invoice_payments WHERE receipt_id = :id`, { id }, t);
      await this.db.run(
        `UPDATE customer_receipts SET status = 'CANCELLED', cancel_reason = :reason, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`,
        { id, reason: reason.slice(0, 300), u: u.user_id },
        t,
      );
      return rec;
    });
    this.books.touch(c);
    return { id, message: `${r.receipt_number} cancelled — the invoices it paid are due again` };
  }

  /** Receipts, newest first (optionally one customer's). */
  async receipts(u: LedgerUser, query: any) {
    const c = u.company_id;
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchText(query?.q);
    const cust = Number(query?.customer_id) || null;
    const where = `r.company_id = :c ${cust ? 'AND r.customer_id = :cust' : ''} ${q ? `AND (r.receipt_number LIKE :like OR r.reference LIKE :like OR cu.display_name LIKE :like OR cu.company_name LIKE :like)` : ''}`;
    const params = { c, cust, like: `%${q}%`, limit, offset };
    const rows = await this.db.sel(
      `SELECT r.id, r.receipt_number, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS d, r.amount, r.mode, r.reference, r.status, r.customer_id, r.bank_account_id,
              COALESCE(NULLIF(cu.display_name, ''), cu.company_name) AS customer_name,
              COALESCE((SELECT SUM(p.payment_amount) FROM invoice_payments p WHERE p.receipt_id = r.id), 0)
                + COALESCE((SELECT SUM(s.amount) FROM customer_refund_sources s JOIN customer_refunds f ON f.id = s.refund_id AND f.status = 'ACTIVE' WHERE s.receipt_id = r.id), 0) AS used,
              (SELECT GROUP_CONCAT(DISTINCT i.invoice_number ORDER BY i.invoice_number SEPARATOR ', ') FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.receipt_id = r.id) AS invoices
         FROM customer_receipts r LEFT JOIN customers cu ON cu.id = r.customer_id
        WHERE ${where} ORDER BY r.receipt_date DESC, r.id DESC LIMIT :limit OFFSET :offset`,
      params,
    );
    const total = await this.db.one(`SELECT COUNT(*) AS n FROM customer_receipts r LEFT JOIN customers cu ON cu.id = r.customer_id WHERE ${where}`, params);
    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        number: r.receipt_number,
        date: r.d,
        customer_id: Number(r.customer_id),
        customer_name: r.customer_name || '—',
        amount: R(P(r.amount)),
        mode: r.mode,
        reference: r.reference,
        status: r.status,
        invoices: r.invoices || null,
        advance: r.status === 'ACTIVE' ? R(Math.max(0, P(r.amount) - P(r.used))) : 0,
      })),
      total: Number(total?.n || 0),
      page,
      limit,
    };
  }

  // ── Expenses ───────────────────────────────────────────────────────────────

  /** The expense heads (made on first use) with what was spent on each this financial year. */
  async expenseHeads(u: LedgerUser) {
    const c = u.company_id;
    await this.books.accounts(c, new Set(Object.keys(EXPENSE_ACCOUNTS)));
    const fy = fyStartOf(this.db.today());
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code, COALESCE((SELECT SUM(x.total) FROM expenses x WHERE x.account_id = a.id AND x.status = 'ACTIVE' AND x.expense_date >= :fy), 0) AS fy_total
         FROM ledger_accounts a WHERE a.company_id = :c AND a.is_active = 1 AND a.group_code IN (:groups)
        ORDER BY a.group_code = 'INDIRECT_EXPENSES' DESC, a.name`,
      { c, fy, groups: EXPENSE_LIKE },
    );
    return { rows: rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, group: r.group_code, group_name: GROUPS[r.group_code as GroupCode]?.name || r.group_code, fy_total: R(P(r.fy_total)) })) };
  }

  /** Expenses for a period, with totals. */
  async expenses(u: LedgerUser, query: any) {
    const c = u.company_id;
    const { s, today } = await this.ctx(c);
    const range = parseRange(query || {}, { today, booksStart: s.books_start });
    if (!range.ok) throw bad(range.message);
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchText(query?.q);
    const head = Number(query?.account_id) || null;
    const where = `x.company_id = :c AND x.expense_date BETWEEN :from AND :to ${head ? 'AND x.account_id = :head' : ''}
      ${q ? 'AND (x.payee LIKE :like OR x.bill_number LIKE :like OR x.expense_number LIKE :like OR x.notes LIKE :like)' : ''}`;
    const params = { c, from: range.from, to: range.to, head, like: `%${q}%`, limit, offset };
    const [rows, totals, byHead] = await Promise.all([
      this.db.sel(
        `SELECT x.id, x.expense_number, DATE_FORMAT(x.expense_date, '%Y-%m-%d') AS d, x.account_id, a.name AS head, x.payee, x.payee_gstin, x.bill_number,
                x.amount, x.gst_rate, x.cgst_amount, x.sgst_amount, x.igst_amount, x.total, x.mode, x.bank_account_id, x.reference, x.notes, x.status, x.cancel_reason
           FROM expenses x LEFT JOIN ledger_accounts a ON a.id = x.account_id
          WHERE ${where} ORDER BY x.expense_date DESC, x.id DESC LIMIT :limit OFFSET :offset`,
        params,
      ),
      this.db.one(
        `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN x.status = 'ACTIVE' THEN x.total END), 0) AS spent,
                COALESCE(SUM(CASE WHEN x.status = 'ACTIVE' THEN x.cgst_amount + x.sgst_amount + x.igst_amount END), 0) AS gst,
                COALESCE(SUM(CASE WHEN x.status = 'ACTIVE' AND x.mode = 'CASH' THEN x.total END), 0) AS cash
           FROM expenses x WHERE ${where}`,
        params,
      ),
      this.db.sel(
        `SELECT a.name, SUM(x.total) AS t FROM expenses x JOIN ledger_accounts a ON a.id = x.account_id
          WHERE x.company_id = :c AND x.status = 'ACTIVE' AND x.expense_date BETWEEN :from AND :to GROUP BY a.id ORDER BY t DESC LIMIT 5`,
        params,
      ),
    ]);
    return {
      period: { from: range.from, to: range.to, preset: range.preset },
      totals: { count: Number(totals?.n || 0), spent: R(P(totals?.spent)), gst_credit: R(P(totals?.gst)), cash: R(P(totals?.cash)) },
      by_head: byHead.map((b) => ({ name: b.name, total: R(P(b.t)) })),
      rows: rows.map((r) => ({
        id: Number(r.id),
        number: r.expense_number,
        date: r.d,
        account_id: Number(r.account_id),
        head: r.head || '—',
        payee: r.payee,
        payee_gstin: r.payee_gstin,
        bill_number: r.bill_number,
        amount: R(P(r.amount)),
        gst_rate: Number(r.gst_rate),
        gst: R(P(r.cgst_amount) + P(r.sgst_amount) + P(r.igst_amount)),
        total: R(P(r.total)),
        mode: r.mode,
        reference: r.reference,
        notes: r.notes,
        status: r.status,
        cancel_reason: r.cancel_reason,
      })),
      total: Number(totals?.n || 0),
      page,
      limit,
    };
  }

  async addExpense(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const co = await this.db.one(`SELECT gst_no, gst_state_code FROM companies WHERE id = :c`, { c });
    const ourState = co?.gst_state_code || getStateCodeFromGstin(co?.gst_no) || null;
    const parsed = parseExpense(body, { today, booksStart, ourStateCode: ourState, gstinProblem });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const head = await this.db.one(`SELECT id, name, group_code, is_active FROM ledger_accounts WHERE id = :id AND company_id = :c`, { id: v.accountId, c });
    if (!head || !Number(head.is_active)) throw bad('Choose one of your expense heads');
    if (!EXPENSE_LIKE.includes(head.group_code)) throw bad(`${head.name} isn't an expense head`);
    await this.ownBank(c, v.bankAccountId);
    const out = await this.db.tx(async (t) => {
      const number = await this.db.nextNumber(c, voucherPrefix('EXP', v.date), 'expenses', 'expense_number', t);
      const id = await this.db.insert(
        `INSERT INTO expenses (company_id, expense_number, expense_date, account_id, payee, payee_gstin, bill_number, amount, gst_rate, tax_type,
                               cgst_amount, sgst_amount, igst_amount, total, mode, bank_account_id, reference, notes, status, created_by)
         VALUES (:c, :no, :d, :acc, :payee, :gstin, :bill, :amt, :rate, :tax, :cgst, :sgst, :igst, :total, :mode, :bank, :ref, :notes, 'ACTIVE', :u)`,
        {
          c,
          no: number,
          d: v.date,
          acc: v.accountId,
          payee: v.payee,
          gstin: v.payeeGstin,
          bill: v.billNumber,
          amt: v.amountPaise / 100,
          rate: v.gstRate,
          tax: v.taxType,
          cgst: v.cgst / 100,
          sgst: v.sgst / 100,
          igst: v.igst / 100,
          total: v.totalPaise / 100,
          mode: v.mode,
          bank: v.bankAccountId,
          ref: v.reference,
          notes: v.notes,
          u: u.user_id,
        },
        t,
      );
      return { id, number };
    });
    this.books.touch(c);
    let warning: string | null = null;
    if (v.mode === 'CASH' && v.payee) {
      const day = await this.db.one(
        `SELECT COALESCE(SUM(total), 0) AS t FROM expenses WHERE company_id = :c AND status = 'ACTIVE' AND mode = 'CASH' AND expense_date = :d AND LOWER(TRIM(payee)) = LOWER(TRIM(:p))`,
        { c, d: v.date, p: v.payee },
      );
      if (P(day?.t) > CASH_PAYMENT_LIMIT)
        warning = `${money(P(day?.t))} paid in cash to ${v.payee} on this day — above ₹10,000 it isn't tax-deductible (Section 40A(3)). Pay by bank or UPI instead.`;
    }
    return { ...out, total: R(v.totalPaise), gst_credit: R(v.cgst + v.sgst + v.igst), warning, message: `${out.number}: ${money(v.totalPaise)} for ${head.name} saved` };
  }

  async cancelExpense(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const x = await this.db.one(`SELECT id, expense_number, status FROM expenses WHERE id = :id AND company_id = :c`, { id, c });
    if (!x) throw notFound('Expense');
    if (x.status !== 'ACTIVE') throw bad('This expense is already cancelled');
    await this.db.run(`UPDATE expenses SET status = 'CANCELLED', cancel_reason = :r, cancelled_by = :u, cancelled_at = NOW() WHERE id = :id`, { id, r: reason.slice(0, 300), u: u.user_id });
    this.books.touch(c);
    return { id, message: `${x.expense_number} cancelled` };
  }

  // ── Transfers and journals ─────────────────────────────────────────────────

  private async placeName(c: number, p: MoneyPlace) {
    if (p.kind === 'cash') return 'Cash';
    const b = await this.db.one(`SELECT id, bank_name, account_number FROM company_bank_accounts WHERE id = :id AND company_id = :c`, { id: p.id, c });
    if (!b) throw bad('Choose one of your bank accounts');
    return bankLabel(b);
  }

  /** Money moved between cash and banks (a contra entry), e.g. cash deposited in the bank. */
  async transfer(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseTransfer(body, { today, booksStart });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const [fromName, toName] = [await this.placeName(c, v.from), await this.placeName(c, v.to)];
    const out = await this.db.tx(async (t) => {
      const number = await this.db.nextNumber(c, voucherPrefix('CTR', v.date), 'ledger_entries', 'number', t, `AND source_type = 'MANUAL'`);
      const id = await this.books.writeManual(c, transferPosting({ ...v, number, fromName, toName }), u.user_id, t);
      return { id, number };
    });
    this.books.touch(c);
    return { ...out, message: `${out.number}: ${money(v.paise)} moved from ${fromName} to ${toName}` };
  }

  /** A journal entry by the accountant (adjustments, capital, loans…): Dr = Cr. */
  async journal(u: LedgerUser, body: any) {
    const c = u.company_id;
    const { today, booksStart } = await this.ctx(c);
    const parsed = parseJournal(body, { today, booksStart });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const accIds = [...new Set(v.lines.filter((l) => l.account_id).map((l) => l.account_id as number))];
    if (accIds.length) {
      const own = await this.db.sel(`SELECT id, code, name, is_active FROM ledger_accounts WHERE company_id = :c AND id IN (:ids)`, { c, ids: accIds });
      if (own.length !== accIds.length || own.some((a) => !Number(a.is_active))) throw bad('Choose your own, active accounts');
      const control = own.find((a) => a.code === 'DEBTORS' || a.code === 'CREDITORS');
      if (control) throw bad(`Pick the customer or supplier instead of "${control.name}"`);
    }
    const cust = [...new Set(v.lines.filter((l) => l.party?.type === 'CUSTOMER').map((l) => l.party!.id))];
    const sup = [...new Set(v.lines.filter((l) => l.party?.type === 'SUPPLIER').map((l) => l.party!.id))];
    if (cust.length && (await this.db.sel(`SELECT id FROM customers WHERE company_id = :c AND id IN (:ids)`, { c, ids: cust })).length !== cust.length) throw bad('Choose one of your customers');
    if (sup.length && (await this.db.sel(`SELECT id FROM suppliers WHERE company_id = :c AND id IN (:ids)`, { c, ids: sup })).length !== sup.length) throw bad('Choose one of your suppliers');
    const out = await this.db.tx(async (t) => {
      const number = await this.db.nextNumber(c, voucherPrefix('JV', v.date), 'ledger_entries', 'number', t, `AND source_type = 'MANUAL'`);
      const id = await this.books.writeManual(c, journalPosting({ ...v, number }), u.user_id, t);
      return { id, number };
    });
    this.books.touch(c);
    const amount = v.lines.filter((l) => l.side === 'dr').reduce((s, l) => s + l.paise, 0);
    return { ...out, message: `${out.number}: journal for ${money(amount)} saved` };
  }

  /** Cancel a transfer or journal typed in the books (documents are cancelled on their own pages). */
  async cancelEntry(u: LedgerUser, id: number, body: any) {
    const c = u.company_id;
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw bad('Say why (at least 3 letters)');
    const e = await this.db.one(`SELECT id, number, source_type, status, narration FROM ledger_entries WHERE id = :id AND company_id = :c`, { id, c });
    if (!e) throw notFound('Entry');
    if (e.source_type !== 'MANUAL') throw bad('This entry comes from a document — cancel the document instead');
    if (e.status !== 'ACTIVE') throw bad('This entry is already cancelled');
    await this.db.tx(async (t) => {
      await this.db.run(`DELETE FROM ledger_lines WHERE company_id = :c AND entry_id = :id`, { c, id }, t);
      await this.db.run(
        `UPDATE ledger_entries SET status = 'CANCELLED', narration = :n WHERE id = :id`,
        { id, n: `${String(e.narration || '').slice(0, 400)} — cancelled: ${reason.slice(0, 80)}` },
        t,
      );
    });
    this.books.touch(c);
    return { id, message: `${e.number || 'Entry'} cancelled` };
  }

  /** One entry with its lines (account, party, Dr, Cr) — the voucher view. */
  /** The books entry of a receipt, expense or refund (for Find); the books are brought up to date first. */
  async entryOf(u: LedgerUser, kind: string, id: number) {
    const c = u.company_id;
    const source = ({ receipt: 'CUSTOMER_RECEIPT', expense: 'EXPENSE', refund: 'CUSTOMER_REFUND' } as Record<string, string>)[kind];
    if (!source) throw bad('Choose a receipt, expense or refund');
    await this.books.ensure(c);
    const e = await this.db.one(`SELECT id FROM ledger_entries WHERE company_id = :c AND source_type = :s AND source_id = :id`, { c, s: source, id });
    if (!e) throw new LedgerError(404, `That ${kind} isn't in the books (it may be dated before they start)`);
    return { id: Number(e.id) };
  }

  async entry(u: LedgerUser, id: number) {
    const c = u.company_id;
    const e = await this.db.one(
      `SELECT e.id, e.entry_type, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS d, e.number, e.narration, e.amount, e.status, e.source_type, e.source_id, ${PARTY_NAME} AS party_name
         FROM ledger_entries e WHERE e.id = :id AND e.company_id = :c`,
      { id, c },
    );
    if (!e) throw notFound('Entry');
    const lines = await this.db.sel(
      `SELECT a.name AS account, a.group_code, l.party_type, l.party_id, l.debit, l.credit,
              CASE l.party_type WHEN 'CUSTOMER' THEN (SELECT COALESCE(NULLIF(cu.display_name, ''), cu.company_name) FROM customers cu WHERE cu.id = l.party_id)
                                WHEN 'SUPPLIER' THEN (SELECT su.name FROM suppliers su WHERE su.id = l.party_id) END AS party_name
         FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = :id ORDER BY l.line_no`,
      { id },
    );
    return {
      id: Number(e.id),
      type: e.entry_type,
      type_word: ENTRY_WORD[e.entry_type as EntryType] || e.entry_type,
      date: e.d,
      number: e.number,
      narration: e.narration,
      amount: R(P(e.amount)),
      status: e.status,
      source_type: e.source_type,
      source_id: e.source_id === null ? null : Number(e.source_id),
      party_name: e.party_name,
      can_cancel: e.source_type === 'MANUAL' && e.status === 'ACTIVE',
      lines: lines.map((l) => ({ account: l.party_name ? `${l.party_name} (${l.account})` : l.account, debit: R(P(l.debit)), credit: R(P(l.credit)) })),
    };
  }

  // ── Chart of accounts and books ────────────────────────────────────────────

  /** Every ledger account with its group and balance (cash and each active bank always listed). */
  async accounts(u: LedgerUser) {
    const c = u.company_id;
    await this.books.ensure(c);
    const banks = await this.db.sel(`SELECT id FROM company_bank_accounts WHERE company_id = :c AND is_active = 1`, { c });
    await this.books.accounts(c, new Set([...Object.keys(SYSTEM_ACCOUNTS), ...banks.map((b) => bankCode(b.id))]));
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code, a.is_system, a.is_active, a.bank_account_id, COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal, COUNT(l.id) AS n
         FROM ledger_accounts a LEFT JOIN ledger_lines l ON l.account_id = a.id AND l.company_id = a.company_id
        WHERE a.company_id = :c GROUP BY a.id ORDER BY a.group_code, a.name`,
      { c },
    );
    return {
      groups: Object.entries(GROUPS).map(([code, g]) => ({ code, name: g.name, nature: g.nature })),
      rows: rows.map((r) => ({
        id: Number(r.id),
        code: r.code,
        name: r.name,
        group: r.group_code,
        nature: GROUPS[r.group_code as GroupCode]?.nature || null,
        is_system: Number(r.is_system) === 1,
        is_active: Number(r.is_active) === 1,
        bank_account_id: r.bank_account_id ? Number(r.bank_account_id) : null,
        is_party_control: r.code === 'DEBTORS' || r.code === 'CREDITORS',
        entries: Number(r.n),
        balance: { ...drCr(P(r.bal)), value: R(P(r.bal)) },
      })),
    };
  }

  /** A new ledger account (an expense head, capital, a loan…). */
  async addAccount(u: LedgerUser, body: any) {
    const c = u.company_id;
    const parsed = parseNewAccount(body);
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    const dup = await this.db.one(`SELECT id FROM ledger_accounts WHERE company_id = :c AND LOWER(TRIM(name)) = LOWER(:n)`, { c, n: v.name });
    if (dup) throw bad(`There is already an account called "${v.name}"`);
    const id = await this.db.insert(
      `INSERT INTO ledger_accounts (company_id, code, name, group_code, is_system, is_active, notes, created_by) VALUES (:c, NULL, :n, :g, 0, 1, :notes, :u)`,
      { c, n: v.name, g: v.group, notes: v.notes, u: u.user_id },
    );
    return { id, name: v.name, group: v.group, message: `"${v.name}" added under ${GROUPS[v.group].name}` };
  }

  /** Any account's ledger for a period (the cash book and bank books are these). */
  async accountStatement(u: LedgerUser, accountId: number, query: any) {
    const c = u.company_id;
    const s = await this.books.ensure(c);
    const today = this.db.today();
    const range = parseRange(query || {}, { today, booksStart: s.books_start });
    if (!range.ok) throw bad(range.message);
    const a = await this.db.one(`SELECT id, code, name, group_code, bank_account_id FROM ledger_accounts WHERE id = :id AND company_id = :c`, { id: accountId, c });
    if (!a) throw notFound('Account');
    const params = { c, a: accountId, from: range.from, to: range.to };
    const [opening, rows] = await Promise.all([
      this.db.one(
        `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
          WHERE l.company_id = :c AND l.account_id = :a AND (l.entry_date < :from OR e.entry_type = 'OPENING')`,
        params,
      ),
      this.db.sel(
        `SELECT e.id AS entry_id, DATE_FORMAT(l.entry_date, '%Y-%m-%d') AS d, e.entry_type, e.number, e.narration, e.source_type,
                CASE WHEN e.source_type = 'INVOICE_PAYMENT' THEN (SELECT p.invoice_id FROM invoice_payments p WHERE p.id = e.source_id) ELSE e.source_id END AS doc_id,
                ${PARTY_NAME} AS party_name, l.debit, l.credit
           FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
          WHERE l.company_id = :c AND l.account_id = :a AND l.entry_date BETWEEN :from AND :to AND e.entry_type <> 'OPENING'
          ORDER BY l.entry_date, e.created_at, e.id, l.id
          LIMIT ${MAX_ROWS + 1}`,
        params,
      ),
    ]);
    if (rows.length > MAX_ROWS) throw bad(`More than ${MAX_ROWS.toLocaleString('en-IN')} entries — choose a shorter period`);
    const run = withRunningBalance(
      P(opening?.bal),
      rows.map((r) => ({
        entry_id: Number(r.entry_id),
        entry_date: r.d,
        entry_type: r.entry_type,
        number: r.number,
        narration: r.narration,
        source_type: r.source_type,
        source_id: r.doc_id === null ? null : Number(r.doc_id),
        debit: P(r.debit),
        credit: P(r.credit),
      })),
    );
    const names = new Map(rows.map((r) => [Number(r.entry_id), r.party_name]));
    const bal = (p: number) => ({ ...drCr(p), value: R(p) });
    return {
      account: { id: Number(a.id), code: a.code, name: a.name, group: a.group_code, group_name: GROUPS[a.group_code as GroupCode]?.name || a.group_code, nature: GROUPS[a.group_code as GroupCode]?.nature || null },
      period: { from: range.from, to: range.to, preset: range.preset },
      books_start: s.books_start,
      opening: bal(run.opening),
      rows: run.rows.map((r) => ({
        entry_id: r.entry_id,
        date: r.entry_date,
        type: r.entry_type,
        type_word: ENTRY_WORD[r.entry_type] || r.entry_type,
        number: r.number,
        narration: r.narration,
        party_name: names.get(r.entry_id) || null,
        source_type: r.source_type,
        doc_id: r.source_id,
        debit: R(r.debit),
        credit: R(r.credit),
        balance: bal(r.balance),
      })),
      totals: { debit: R(run.debit), credit: R(run.credit) },
      closing: bal(run.closing),
    };
  }

  /** The day book: every entry in a period, newest first, with totals by kind. */
  async dayBook(u: LedgerUser, query: any) {
    const c = u.company_id;
    const s = await this.books.ensure(c);
    const today = this.db.today();
    const range = parseRange(query?.range || query?.from || query?.to ? query : { range: 'month' }, { today, booksStart: s.books_start });
    if (!range.ok) throw bad(range.message);
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const type = typeof query?.type === 'string' && /^[A-Z_]{3,14}$/.test(query.type) ? query.type : null;
    const q = searchText(query?.q);
    const where = `e.company_id = :c AND e.status = 'ACTIVE' AND e.entry_type <> 'OPENING' AND e.entry_date BETWEEN :from AND :to ${type ? 'AND e.entry_type = :type' : ''}
      ${q ? 'AND (e.number LIKE :like OR e.narration LIKE :like)' : ''}`;
    const params = { c, from: range.from, to: range.to, type, like: `%${q}%`, limit, offset };
    const [rows, kinds] = await Promise.all([
      this.db.sel(
        `SELECT e.id, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS d, e.entry_type, e.number, e.narration, e.amount, e.source_type,
                CASE WHEN e.source_type = 'INVOICE_PAYMENT' THEN (SELECT p.invoice_id FROM invoice_payments p WHERE p.id = e.source_id) ELSE e.source_id END AS doc_id,
                ${PARTY_NAME} AS party_name
           FROM ledger_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT :limit OFFSET :offset`,
        params,
      ),
      this.db.sel(`SELECT e.entry_type, COUNT(*) AS n, SUM(e.amount) AS t FROM ledger_entries e WHERE ${where} GROUP BY e.entry_type`, params),
    ]);
    return {
      period: { from: range.from, to: range.to, preset: range.preset },
      kinds: kinds.map((k) => ({ type: k.entry_type, word: ENTRY_WORD[k.entry_type as EntryType] || k.entry_type, count: Number(k.n), total: R(P(k.t)) })),
      rows: rows.map((r) => ({
        id: Number(r.id),
        date: r.d,
        type: r.entry_type,
        type_word: ENTRY_WORD[r.entry_type as EntryType] || r.entry_type,
        number: r.number,
        narration: r.narration,
        party_name: r.party_name || null,
        amount: R(P(r.amount)),
        source_type: r.source_type,
        doc_id: r.doc_id === null ? null : Number(r.doc_id),
      })),
      total: kinds.reduce((s2, k) => s2 + Number(k.n), 0),
      page,
      limit,
    };
  }
}
