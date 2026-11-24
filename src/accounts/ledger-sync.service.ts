import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { LedgerDb, isoDate } from './ledger-db';
import {
  EntryType,
  OPENING_SOURCES,
  Posting,
  SYSTEM_ACCOUNTS,
  SourceType,
  bankIdOf,
  bankLabel,
  billPosting,
  creditNotePosting,
  debitNotePosting,
  defaultBooksStart,
  expensePosting,
  refundPosting,
  invoicePaymentPosting,
  invoicePosting,
  receiptPosting,
  supplierPaymentPosting,
} from './ledger.rules';

export interface BooksSettings {
  books_start: string;
  /** The bank chosen in Accounts settings (null = use the company's default bank). */
  default_bank_account_id: number | null;
  /** The bank that payments not naming one go to right now (null = none saved). */
  bank_id: number | null;
}

/** One entry to write: what it came from, its fingerprint, and its posting (null = not in the books). */
export interface EntryWrite {
  source: SourceType;
  sourceId: number;
  fingerprint: string | null;
  posting: Posting | null;
  /** For an entry not in the books (cancelled, before the books start): its type and date. */
  tombstone?: { entry_type: EntryType; date: string; party_type?: string | null; party_id?: number | null };
  createdBy?: number | null;
  /** When the document was made (orders entries of the same day); now when not given. */
  at?: unknown;
}

interface SourceDef {
  type: SourceType;
  entryType: EntryType;
  /** Documents with no entry yet, or whose entry was made from something different. */
  stale: string;
  /** Entries whose document no longer exists. */
  orphans: string;
  post: (row: any, s: BooksSettings) => Posting | null;
  date: (row: any) => string;
  party: (row: any) => { type: string; id: number } | null;
}

const BATCH = 200;
/** Reads within this long of a check reuse it (one screen asks for several things at once). */
const FRESH_MS = 1500;

// What each entry is made from. A change to any of these re-records it; status
// changes that don't matter to the books (unpaid → paid) don't.
const FP_INVOICE = `MD5(CONCAT_WS('|', COALESCE(i.status, '') IN ('CANCELLED', 'SUPERSEDED'), COALESCE(i.invoice_date, DATE(i.created_at)),
  COALESCE(i.customer_id, 0), COALESCE(i.invoice_number, ''), COALESCE(i.sub_total, 0), COALESCE(i.discount_amount, 0),
  COALESCE(i.transport_charges, 0), COALESCE(i.cgst_amount, 0), COALESCE(i.sgst_amount, 0), COALESCE(i.igst_amount, 0),
  COALESCE(i.grand_total, 0), COALESCE(i.invoice_date, DATE(i.created_at)) >= :start))`;
const FP_PAYMENT = `MD5(CONCAT_WS('|', p.payment_date, p.payment_amount, COALESCE(p.payment_mode, ''), COALESCE(p.transaction_reference, ''),
  COALESCE(i.customer_id, 0), COALESCE(i.invoice_number, ''), COALESCE(p.bank_account_id, 0), p.payment_date >= :start))`;
const FP_RECEIPT = `MD5(CONCAT_WS('|', r.status = 'CANCELLED', r.receipt_date, r.amount, r.mode, COALESCE(r.reference, ''),
  r.customer_id, r.receipt_number, COALESCE(r.bank_account_id, 0), r.receipt_date >= :start))`;
const FP_EXPENSE = `MD5(CONCAT_WS('|', x.status = 'CANCELLED', x.expense_date, x.account_id, x.amount, x.cgst_amount, x.sgst_amount, x.igst_amount,
  x.total, x.mode, COALESCE(x.bank_account_id, 0), COALESCE(x.payee, ''), COALESCE(x.bill_number, ''), x.expense_number, x.expense_date >= :start))`;
const FP_BILL = `MD5(CONCAT_WS('|', b.status = 'CANCELLED', b.bill_date, b.supplier_id, b.bill_number, b.sub_total, b.discount_amount,
  b.freight_charges, b.cgst_amount, b.sgst_amount, b.igst_amount, b.round_off, b.grand_total, b.bill_date >= :start))`;
const FP_SUPPLIER_PAYMENT = `MD5(CONCAT_WS('|', s.status = 'CANCELLED', s.payment_date, s.amount, s.mode, COALESCE(s.reference, ''),
  s.supplier_id, COALESCE(s.bank_account_id, 0), s.payment_date >= :start))`;

const FP_CREDIT_NOTE = `MD5(CONCAT_WS('|', n.status = 'CANCELLED', n.cn_date, n.customer_id, n.cn_number, n.taxable_amount, n.cgst_amount, n.sgst_amount,
  n.igst_amount, n.total, n.reason, COALESCE(i.invoice_number, ''), n.cn_date >= :start))`;
const FP_DEBIT_NOTE = `MD5(CONCAT_WS('|', n.status = 'CANCELLED', n.dn_date, n.supplier_id, n.dn_number, n.taxable_amount, n.cgst_amount, n.sgst_amount,
  n.igst_amount, n.total, n.reason, COALESCE(b.bill_number, ''), n.dn_date >= :start))`;
const FP_REFUND = `MD5(CONCAT_WS('|', f.status = 'CANCELLED', f.refund_date, f.amount, f.mode, COALESCE(f.reference, ''), f.customer_id, f.refund_number,
  COALESCE(f.bank_account_id, 0), f.refund_date >= :start))`;

const SOURCES: SourceDef[] = [
  {
    type: 'INVOICE',
    entryType: 'SALES',
    stale: `SELECT i.id, i.invoice_number, DATE_FORMAT(COALESCE(i.invoice_date, DATE(i.created_at)), '%Y-%m-%d') AS d, i.customer_id,
                   i.sub_total, i.discount_amount, i.transport_charges, i.cgst_amount, i.sgst_amount, i.igst_amount, i.grand_total,
                   COALESCE(i.status, '') IN ('CANCELLED', 'SUPERSEDED') AS dead, DATE_FORMAT(i.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_INVOICE} AS fp
              FROM invoices i
              LEFT JOIN ledger_entries e ON e.company_id = i.company_id AND e.source_type = 'INVOICE' AND e.source_id = i.id
             WHERE i.company_id = :c AND NOT (e.fingerprint <=> ${FP_INVOICE})
             ORDER BY i.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN invoices i ON i.id = e.source_id AND i.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'INVOICE' AND i.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : invoicePosting({ ...r, invoice_date: r.d })),
    date: (r) => r.d,
    party: (r) => (Number(r.customer_id) > 0 ? { type: 'CUSTOMER', id: Number(r.customer_id) } : null),
  },
  {
    type: 'INVOICE_PAYMENT',
    entryType: 'RECEIPT',
    // A payment that is part of a customer receipt is recorded with the receipt, not again here.
    stale: `SELECT p.id, DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS d, p.payment_amount, p.payment_mode, p.transaction_reference, p.bank_account_id,
                   i.invoice_number, i.customer_id, DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_PAYMENT} AS fp
              FROM invoice_payments p
              JOIN invoices i ON i.id = p.invoice_id
              LEFT JOIN ledger_entries e ON e.company_id = i.company_id AND e.source_type = 'INVOICE_PAYMENT' AND e.source_id = p.id
             WHERE i.company_id = :c AND p.receipt_id IS NULL AND NOT (e.fingerprint <=> ${FP_PAYMENT})
             ORDER BY p.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e
                LEFT JOIN invoice_payments p ON p.id = e.source_id
                LEFT JOIN invoices i ON i.id = p.invoice_id AND i.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'INVOICE_PAYMENT' AND (i.id IS NULL OR p.receipt_id IS NOT NULL)`,
    post: (r, s) => (r.d < s.books_start ? null : invoicePaymentPosting({ ...r, payment_date: r.d }, s.bank_id)),
    date: (r) => r.d,
    party: (r) => (Number(r.customer_id) > 0 ? { type: 'CUSTOMER', id: Number(r.customer_id) } : null),
  },
  {
    type: 'CUSTOMER_RECEIPT',
    entryType: 'RECEIPT',
    stale: `SELECT r.id, r.receipt_number, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS d, r.amount, r.mode, r.reference, r.bank_account_id, r.customer_id,
                   r.status = 'CANCELLED' AS dead, DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_RECEIPT} AS fp
              FROM customer_receipts r
              LEFT JOIN ledger_entries e ON e.company_id = r.company_id AND e.source_type = 'CUSTOMER_RECEIPT' AND e.source_id = r.id
             WHERE r.company_id = :c AND NOT (e.fingerprint <=> ${FP_RECEIPT})
             ORDER BY r.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN customer_receipts r ON r.id = e.source_id AND r.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'CUSTOMER_RECEIPT' AND r.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : receiptPosting({ ...r, receipt_date: r.d }, s.bank_id)),
    date: (r) => r.d,
    party: (r) => ({ type: 'CUSTOMER', id: Number(r.customer_id) }),
  },
  {
    type: 'EXPENSE',
    entryType: 'EXPENSE',
    stale: `SELECT x.id, x.expense_number, DATE_FORMAT(x.expense_date, '%Y-%m-%d') AS d, x.account_id, x.amount, x.cgst_amount, x.sgst_amount, x.igst_amount,
                   x.total, x.mode, x.bank_account_id, x.payee, x.bill_number, x.status = 'CANCELLED' AS dead, DATE_FORMAT(x.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_EXPENSE} AS fp
              FROM expenses x
              LEFT JOIN ledger_entries e ON e.company_id = x.company_id AND e.source_type = 'EXPENSE' AND e.source_id = x.id
             WHERE x.company_id = :c AND NOT (e.fingerprint <=> ${FP_EXPENSE})
             ORDER BY x.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN expenses x ON x.id = e.source_id AND x.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'EXPENSE' AND x.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : expensePosting({ ...r, expense_date: r.d }, s.bank_id)),
    date: (r) => r.d,
    party: () => null,
  },
  {
    type: 'CREDIT_NOTE',
    entryType: 'CREDIT_NOTE',
    stale: `SELECT n.id, n.cn_number, DATE_FORMAT(n.cn_date, '%Y-%m-%d') AS d, n.customer_id, n.taxable_amount, n.cgst_amount, n.sgst_amount, n.igst_amount,
                   n.total, n.reason, i.invoice_number, n.status = 'CANCELLED' AS dead, DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_CREDIT_NOTE} AS fp
              FROM credit_notes n
              LEFT JOIN invoices i ON i.id = n.invoice_id
              LEFT JOIN ledger_entries e ON e.company_id = n.company_id AND e.source_type = 'CREDIT_NOTE' AND e.source_id = n.id
             WHERE n.company_id = :c AND NOT (e.fingerprint <=> ${FP_CREDIT_NOTE})
             ORDER BY n.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN credit_notes n ON n.id = e.source_id AND n.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'CREDIT_NOTE' AND n.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : creditNotePosting({ ...r, cn_date: r.d })),
    date: (r) => r.d,
    party: (r) => ({ type: 'CUSTOMER', id: Number(r.customer_id) }),
  },
  {
    type: 'DEBIT_NOTE',
    entryType: 'DEBIT_NOTE',
    stale: `SELECT n.id, n.dn_number, DATE_FORMAT(n.dn_date, '%Y-%m-%d') AS d, n.supplier_id, n.taxable_amount, n.cgst_amount, n.sgst_amount, n.igst_amount,
                   n.total, n.reason, b.bill_number, n.status = 'CANCELLED' AS dead, DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_DEBIT_NOTE} AS fp
              FROM debit_notes n
              LEFT JOIN purchase_bills b ON b.id = n.bill_id
              LEFT JOIN ledger_entries e ON e.company_id = n.company_id AND e.source_type = 'DEBIT_NOTE' AND e.source_id = n.id
             WHERE n.company_id = :c AND NOT (e.fingerprint <=> ${FP_DEBIT_NOTE})
             ORDER BY n.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN debit_notes n ON n.id = e.source_id AND n.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'DEBIT_NOTE' AND n.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : debitNotePosting({ ...r, dn_date: r.d })),
    date: (r) => r.d,
    party: (r) => ({ type: 'SUPPLIER', id: Number(r.supplier_id) }),
  },
  {
    type: 'CUSTOMER_REFUND',
    entryType: 'PAYMENT',
    stale: `SELECT f.id, f.refund_number, DATE_FORMAT(f.refund_date, '%Y-%m-%d') AS d, f.amount, f.mode, f.reference, f.bank_account_id, f.customer_id,
                   f.status = 'CANCELLED' AS dead, DATE_FORMAT(f.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_REFUND} AS fp
              FROM customer_refunds f
              LEFT JOIN ledger_entries e ON e.company_id = f.company_id AND e.source_type = 'CUSTOMER_REFUND' AND e.source_id = f.id
             WHERE f.company_id = :c AND NOT (e.fingerprint <=> ${FP_REFUND})
             ORDER BY f.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN customer_refunds f ON f.id = e.source_id AND f.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'CUSTOMER_REFUND' AND f.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : refundPosting({ ...r, refund_date: r.d }, s.bank_id)),
    date: (r) => r.d,
    party: (r) => ({ type: 'CUSTOMER', id: Number(r.customer_id) }),
  },
  {
    type: 'PURCHASE_BILL',
    entryType: 'PURCHASE',
    stale: `SELECT b.id, b.bill_number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS d, b.supplier_id, b.sub_total, b.discount_amount,
                   b.freight_charges, b.cgst_amount, b.sgst_amount, b.igst_amount, b.round_off, b.grand_total,
                   b.status = 'CANCELLED' AS dead, DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_BILL} AS fp
              FROM purchase_bills b
              LEFT JOIN ledger_entries e ON e.company_id = b.company_id AND e.source_type = 'PURCHASE_BILL' AND e.source_id = b.id
             WHERE b.company_id = :c AND NOT (e.fingerprint <=> ${FP_BILL})
             ORDER BY b.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN purchase_bills b ON b.id = e.source_id AND b.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'PURCHASE_BILL' AND b.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : billPosting({ ...r, bill_date: r.d })),
    date: (r) => r.d,
    party: (r) => ({ type: 'SUPPLIER', id: Number(r.supplier_id) }),
  },
  {
    type: 'SUPPLIER_PAYMENT',
    entryType: 'PAYMENT',
    stale: `SELECT s.id, DATE_FORMAT(s.payment_date, '%Y-%m-%d') AS d, s.amount, s.mode, s.reference, s.bank_account_id, s.supplier_id,
                   s.status = 'CANCELLED' AS dead, DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS at, ${FP_SUPPLIER_PAYMENT} AS fp
              FROM supplier_payments s
              LEFT JOIN ledger_entries e ON e.company_id = s.company_id AND e.source_type = 'SUPPLIER_PAYMENT' AND e.source_id = s.id
             WHERE s.company_id = :c AND NOT (e.fingerprint <=> ${FP_SUPPLIER_PAYMENT})
             ORDER BY s.id LIMIT :limit`,
    orphans: `SELECT e.id FROM ledger_entries e LEFT JOIN supplier_payments s ON s.id = e.source_id AND s.company_id = e.company_id
               WHERE e.company_id = :c AND e.source_type = 'SUPPLIER_PAYMENT' AND s.id IS NULL`,
    post: (r, s) => (Number(r.dead) || r.d < s.books_start ? null : supplierPaymentPosting({ ...r, payment_date: r.d }, s.bank_id)),
    date: (r) => r.d,
    party: (r) => ({ type: 'SUPPLIER', id: Number(r.supplier_id) }),
  },
];

const missingTable = (e: any) => e?.original?.code === 'ER_NO_SUCH_TABLE' || e?.parent?.code === 'ER_NO_SUCH_TABLE';

/**
 * Keeps the books in step with the documents. Before the books are read, any
 * invoice, payment, supplier bill or supplier payment that is new, changed,
 * cancelled or deleted since it was last recorded is (re-)recorded — so the
 * other modules need no changes, and the books heal themselves. One company
 * at a time (its settings row is locked while it is recorded).
 */
@Injectable()
export class LedgerSyncService {
  private readonly inflight = new Map<number, Promise<BooksSettings>>();
  private readonly fresh = new Map<number, number>();

  constructor(
    private readonly db: LedgerDb,
    private readonly appLogger: AppLogger,
  ) {}

  /** Forget that the company's books were just checked (after a change made here). */
  touch(companyId: number) {
    this.fresh.delete(companyId);
  }

  /** The company's books settings, made on first use (books start = 1 April of the first document's year). */
  async settings(companyId: number, t?: any): Promise<BooksSettings> {
    let row = await this.db.one(
      `SELECT DATE_FORMAT(books_start, '%Y-%m-%d') AS books_start, default_bank_account_id FROM ledger_settings WHERE company_id = :c`,
      { c: companyId },
      t,
    );
    if (!row) {
      const start = defaultBooksStart(await this.earliestDocument(companyId, t), this.db.today());
      await this.db.run(`INSERT IGNORE INTO ledger_settings (company_id, books_start) VALUES (:c, :start)`, { c: companyId, start }, t);
      row = { books_start: start, default_bank_account_id: null };
      const again = await this.db.one(
        `SELECT DATE_FORMAT(books_start, '%Y-%m-%d') AS books_start, default_bank_account_id FROM ledger_settings WHERE company_id = :c`,
        { c: companyId },
        t,
      );
      if (again) row = again;
    }
    const chosen = Number(row.default_bank_account_id) > 0 ? Number(row.default_bank_account_id) : null;
    const bank = await this.db.one(
      `SELECT id FROM company_bank_accounts WHERE company_id = :c AND (id = :chosen OR is_active = 1)
        ORDER BY id = :chosen DESC, is_default DESC, id LIMIT 1`,
      { c: companyId, chosen: chosen ?? 0 },
      t,
    );
    return { books_start: row.books_start, default_bank_account_id: chosen, bank_id: bank ? Number(bank.id) : null };
  }

  private async earliestDocument(companyId: number, t?: any): Promise<string | null> {
    const parts = [
      `SELECT MIN(invoice_date) AS d FROM invoices WHERE company_id = :c AND COALESCE(status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`,
      `SELECT MIN(p.payment_date) AS d FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.company_id = :c`,
      `SELECT MIN(bill_date) AS d FROM purchase_bills WHERE company_id = :c AND status <> 'CANCELLED'`,
      `SELECT MIN(payment_date) AS d FROM supplier_payments WHERE company_id = :c AND status <> 'CANCELLED'`,
    ];
    let first: string | null = null;
    for (const sql of parts) {
      try {
        const d = isoDate((await this.db.one(sql, { c: companyId }, t))?.d);
        if (d && (!first || d < first)) first = d;
      } catch (e) {
        if (!missingTable(e)) throw e;
      }
    }
    return first;
  }

  /**
   * Bring the company's books up to date, then return its settings. Several
   * calls at once share one run; a run within the last few seconds counts.
   */
  ensure(companyId: number): Promise<BooksSettings> {
    const recent = this.fresh.get(companyId);
    if (recent && Date.now() - recent < FRESH_MS) return this.settings(companyId);
    let p = this.inflight.get(companyId);
    if (!p) {
      p = this.run(companyId).finally(() => this.inflight.delete(companyId));
      this.inflight.set(companyId, p);
    }
    return p;
  }

  private async run(c: number): Promise<BooksSettings> {
    const s = await this.settings(c);
    let written = 0;
    for (const def of SOURCES) {
      try {
        for (let round = 0; round < 500; round++) {
          const n = await this.db.tx(async (t) => {
            await this.db.one(`SELECT company_id FROM ledger_settings WHERE company_id = :c FOR UPDATE`, { c }, t);
            const rows = await this.db.sel(def.stale, { c, start: s.books_start, limit: BATCH }, t);
            if (!rows.length) return 0;
            await this.write(
              c,
              rows.map((r) => {
                const posting = def.post(r, s);
                const party = def.party(r);
                return {
                  source: def.type,
                  sourceId: Number(r.id),
                  fingerprint: r.fp,
                  at: r.at ?? null,
                  posting,
                  tombstone: { entry_type: def.entryType, date: def.date(r) || s.books_start, party_type: party?.type ?? null, party_id: party?.id ?? null },
                };
              }),
              t,
            );
            return rows.length;
          });
          written += n;
          if (n < BATCH) break;
        }
        const gone = (await this.db.sel(def.orphans, { c })).map((r) => Number(r.id));
        if (gone.length) await this.db.tx((t) => this.remove(c, gone, t));
      } catch (e) {
        if (missingTable(e)) continue;
        throw e;
      }
    }
    await this.db.run(`UPDATE ledger_settings SET synced_at = NOW() WHERE company_id = :c`, { c });
    if (written) this.appLogger.forContext('LedgerSyncService', 'run').info(`Books of company ${c}: ${written} entries recorded`);
    this.fresh.set(c, Date.now());
    return s;
  }

  /** Delete entries and their lines (their documents are gone). */
  async remove(c: number, entryIds: number[], t: any) {
    if (!entryIds.length) return;
    await this.db.run(`DELETE FROM ledger_lines WHERE company_id = :c AND entry_id IN (:ids)`, { c, ids: entryIds }, t);
    await this.db.run(`DELETE FROM ledger_entries WHERE company_id = :c AND id IN (:ids)`, { c, ids: entryIds }, t);
  }

  /**
   * Write entries (insert or replace) with their lines, in the caller's
   * transaction: one upsert for the entries, then their lines replaced.
   */
  async write(c: number, items: EntryWrite[], t: any) {
    if (!items.length) return;
    const resolve = await this.accounts(c, new Set(items.flatMap((i) => i.posting?.lines.map((l) => l.code) || [])), t);
    const values: unknown[] = [];
    const rows = items.map((it) => {
      const p = it.posting;
      const tb = it.tombstone;
      values.push(
        c,
        p ? p.entry_type : tb?.entry_type || 'JOURNAL',
        p ? p.date : tb?.date,
        p?.number ? p.number.slice(0, 60) : null,
        it.source,
        it.sourceId,
        it.fingerprint,
        p ? (p.party?.type ?? null) : (tb?.party_type ?? null),
        p ? (p.party?.id ?? null) : (tb?.party_id ?? null),
        p ? p.amount / 100 : 0,
        p ? p.narration.slice(0, 500) : null,
        p ? 'ACTIVE' : 'CANCELLED',
        it.createdBy ?? null,
        // The document's time as the database wrote it (text, so no time-zone shift); now when none.
        typeof it.at === 'string' && it.at ? it.at : null,
      );
      return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))';
    });
    await this.db.run(
      `INSERT INTO ledger_entries (company_id, entry_type, entry_date, number, source_type, source_id, fingerprint, party_type, party_id, amount, narration, status, created_by, created_at)
       VALUES ${rows.join(', ')}
       ON DUPLICATE KEY UPDATE entry_type = VALUES(entry_type), entry_date = VALUES(entry_date), number = VALUES(number),
         fingerprint = VALUES(fingerprint), party_type = VALUES(party_type), party_id = VALUES(party_id), amount = VALUES(amount),
         narration = VALUES(narration), status = VALUES(status), updated_at = NOW()`,
      values as any,
      t,
    );
    // The entries' ids, by what they came from.
    const idOf = new Map<string, number>();
    const bySource = new Map<string, number[]>();
    items.forEach((it) => bySource.set(it.source, [...(bySource.get(it.source) || []), it.sourceId]));
    for (const [source, ids] of bySource) {
      const got = await this.db.sel(`SELECT id, source_id FROM ledger_entries WHERE company_id = :c AND source_type = :s AND source_id IN (:ids)`, { c, s: source, ids }, t);
      got.forEach((g) => idOf.set(`${source}:${Number(g.source_id)}`, Number(g.id)));
    }
    const entryIds = items.map((it) => idOf.get(`${it.source}:${it.sourceId}`)).filter((x): x is number => !!x);
    if (entryIds.length) await this.db.run(`DELETE FROM ledger_lines WHERE company_id = :c AND entry_id IN (:ids)`, { c, ids: entryIds }, t);
    const lineValues: unknown[] = [];
    const lineRows: string[] = [];
    for (const it of items) {
      const entryId = idOf.get(`${it.source}:${it.sourceId}`);
      if (!entryId || !it.posting) continue;
      it.posting.lines.forEach((l, i) => {
        lineValues.push(entryId, c, it.posting!.date, resolve(l.code), l.party?.type ?? null, l.party?.id ?? null, l.dr / 100, l.cr / 100, i + 1);
        lineRows.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      });
    }
    for (let i = 0; i < lineRows.length; i += 1000) {
      await this.db.run(
        `INSERT INTO ledger_lines (entry_id, company_id, entry_date, account_id, party_type, party_id, debit, credit, line_no) VALUES ${lineRows.slice(i, i + 1000).join(', ')}`,
        lineValues.slice(i * 9, (i + 1000) * 9) as any,
        t,
      );
    }
  }

  /**
   * Account ids for these codes, making any the company doesn't have yet:
   * system accounts (SALES, CASH…), a bank account's ledger (BANK:5), or an
   * account by id (ID:12, checked to be the company's). A bank that isn't the
   * company's falls back to the general "Bank" ledger.
   */
  async accounts(c: number, codes: Set<string>, t?: any): Promise<(code: string) => number> {
    const load = async () => {
      const rows = await this.db.sel(`SELECT id, code FROM ledger_accounts WHERE company_id = :c AND code IS NOT NULL`, { c }, t);
      return new Map(rows.map((r) => [String(r.code), Number(r.id)]));
    };
    let map = await load();
    const wanted = [...codes];
    const missing = wanted.filter((k) => !k.startsWith('ID:') && !map.has(k));
    const banks = missing.map(bankIdOf).filter((x): x is number => x !== null && x > 0);
    const bankRows = banks.length
      ? await this.db.sel(`SELECT id, bank_name, account_number FROM company_bank_accounts WHERE company_id = :c AND id IN (:ids)`, { c, ids: banks }, t)
      : [];
    const known = new Map(bankRows.map((b) => [Number(b.id), b]));
    const add: { code: string; name: string; group: string; bank: number | null }[] = [];
    for (const k of missing) {
      const sys = SYSTEM_ACCOUNTS[k];
      if (sys) add.push({ code: k, name: sys.name, group: sys.group, bank: null });
      const b = bankIdOf(k);
      if (b !== null) {
        const row = b > 0 ? known.get(b) : null;
        if (row) add.push({ code: k, name: bankLabel(row), group: 'BANK_ACCOUNTS', bank: b });
        else if (!map.has('BANK:0')) add.push({ code: 'BANK:0', name: 'Bank', group: 'BANK_ACCOUNTS', bank: null });
      }
    }
    if (!map.has('ROUND_OFF') && wanted.length) add.push({ code: 'ROUND_OFF', name: SYSTEM_ACCOUNTS.ROUND_OFF.name, group: SYSTEM_ACCOUNTS.ROUND_OFF.group, bank: null });
    const uniq = [...new Map(add.map((a) => [a.code, a])).values()];
    if (uniq.length) {
      const vals: unknown[] = [];
      uniq.forEach((a) => vals.push(c, a.code, a.name, a.group, a.bank));
      await this.db.run(
        `INSERT IGNORE INTO ledger_accounts (company_id, code, name, group_code, bank_account_id, is_system) VALUES ${uniq.map(() => '(?, ?, ?, ?, ?, 1)').join(', ')}`,
        vals as any,
        t,
      );
      map = await load();
    }
    const byId = wanted.filter((k) => k.startsWith('ID:')).map((k) => Number(k.slice(3)));
    const own = byId.length ? new Set((await this.db.sel(`SELECT id FROM ledger_accounts WHERE company_id = :c AND id IN (:ids)`, { c, ids: byId }, t)).map((r) => Number(r.id))) : new Set<number>();
    return (code: string) => {
      if (code.startsWith('ID:')) {
        const id = Number(code.slice(3));
        if (own.has(id)) return id;
        throw new Error(`Account ${id} is not company ${c}'s`);
      }
      const id = map.get(code) ?? (bankIdOf(code) !== null ? map.get('BANK:0') : undefined);
      if (!id) throw new Error(`No ledger account for ${code}`);
      return id;
    };
  }

  /** An entry typed in the books themselves (a transfer or a journal): written as is, returns its id. */
  async writeManual(c: number, p: Posting, userId: number, t: any): Promise<number> {
    const resolve = await this.accounts(c, new Set(p.lines.map((l) => l.code)), t);
    const id = await this.db.insert(
      `INSERT INTO ledger_entries (company_id, entry_type, entry_date, number, source_type, source_id, fingerprint, party_type, party_id, amount, narration, status, created_by)
       VALUES (:c, :type, :date, :number, 'MANUAL', NULL, NULL, :pt, :pid, :amount, :narration, 'ACTIVE', :u)`,
      { c, type: p.entry_type, date: p.date, number: p.number, pt: p.party?.type ?? null, pid: p.party?.id ?? null, amount: p.amount / 100, narration: p.narration.slice(0, 500), u: userId },
      t,
    );
    const vals: unknown[] = [];
    p.lines.forEach((l, i) => vals.push(id, c, p.date, resolve(l.code), l.party?.type ?? null, l.party?.id ?? null, l.dr / 100, l.cr / 100, i + 1));
    await this.db.run(
      `INSERT INTO ledger_lines (entry_id, company_id, entry_date, account_id, party_type, party_id, debit, credit, line_no) VALUES ${p.lines.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      vals as any,
      t,
    );
    return id;
  }

  /** Move opening balances to a new books start date. */
  async moveOpenings(c: number, start: string, t: any) {
    await this.db.run(`UPDATE ledger_entries SET entry_date = :start WHERE company_id = :c AND source_type IN (:src)`, { c, start, src: OPENING_SOURCES }, t);
    await this.db.run(
      `UPDATE ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id SET l.entry_date = :start WHERE e.company_id = :c AND e.source_type IN (:src)`,
      { c, start, src: OPENING_SOURCES },
      t,
    );
  }
}
