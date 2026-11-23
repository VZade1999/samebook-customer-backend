import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';

import { AppLogger } from '../common/logger/logger.service';
import { BILLED_QTY_SQL, LedgerRow, SENT_QTY_SQL } from '../invoice/billing.rules';
import {
  ChallanRow,
  DocType,
  InvoiceRow,
  PaymentRow,
  QuotationRow,
  SEARCH_PER_TYPE,
  accessOf,
  buildTrail,
  compact,
  likeEscape,
  matchRank,
  parseDocType,
  parseSearch,
} from './document-links.rules';

export interface LinksRequester {
  companyId: number;
  permissions: string[];
}

export interface LinksResult {
  success: boolean;
  message: string;
  data?: any;
  statusCode?: number;
}

const NOT_FOUND: LinksResult = { success: false, statusCode: 404, message: 'Document not found' };

/** What Find can return: the sales documents, plus purchase orders, goods received (opens its PO) and supplier bills. */
type SearchType = DocType | 'purchase_order' | 'grn' | 'supplier_bill';

// Billing data: never cached server-side (a stale link is worse than a slow one).
@Injectable()
export class DocumentLinksService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {}

  private select<T = any>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
    return this.dbProvider.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  }

  /**
   * Everything linked to one document: its quotation, the quotation's
   * challans and invoices, and payment totals — plus what the document
   * prints in its reference boxes.
   */
  async trail(typeRaw: unknown, idRaw: unknown, req: LinksRequester): Promise<LinksResult> {
    const log = this.appLogger.forContext('DocumentLinksService', 'trail', { type: typeRaw, id: idRaw });
    const type = parseDocType(typeRaw);
    const id = Number(idRaw);
    if (!type || !Number.isInteger(id) || id <= 0) {
      return { success: false, statusCode: 400, message: 'Choose a quotation, challan or invoice' };
    }
    const access = accessOf(req.permissions);
    if (!access[type]) return { success: false, statusCode: 403, message: "You don't have access to this document" };
    const c = req.companyId;

    try {
      // 1. The quotations the document belongs to, the main one first: its
      // quotation — and for an invoice, every quotation its lines bill.
      let quotationIds: number[] = [];
      // A challan made without a quotation: the invoice it is billed on (its siblings show too).
      let standaloneInvoiceId = 0;
      if (type === 'quotation') {
        const [row] = await this.select(
          `SELECT id FROM quotations WHERE id = :id AND company_id = :c AND COALESCE(status, '') <> 'DELETED'`,
          { id, c },
        );
        if (!row) return NOT_FOUND;
        quotationIds = [id];
      } else if (type === 'challan') {
        const [row] = await this.select<{ quotation_id: number | null; invoice_id: number | null }>(
          `SELECT quotation_id, invoice_id FROM delivery_challans WHERE id = :id AND company_id = :c AND is_active = 1`,
          { id, c },
        );
        if (!row) return NOT_FOUND;
        quotationIds = row.quotation_id ? [Number(row.quotation_id)] : [];
        if (!row.quotation_id && row.invoice_id) standaloneInvoiceId = Number(row.invoice_id);
      } else {
        const [row] = await this.select<{ quotation_id: number | null }>(
          `SELECT quotation_id FROM invoices WHERE id = :id AND company_id = :c`,
          { id, c },
        );
        if (!row) return NOT_FOUND;
        const billed = await this.select<{ quotation_id: number }>(
          `SELECT DISTINCT qi.quotation_id FROM invoice_items ii JOIN quotation_items qi ON qi.id = ii.quotation_item_id WHERE ii.invoice_id = :id
           UNION
           SELECT DISTINCT dc.quotation_id FROM delivery_challans dc WHERE dc.invoice_id = :id AND dc.company_id = :c AND dc.quotation_id IS NOT NULL`,
          { id, c },
        );
        quotationIds = [...new Set([Number(row.quotation_id), ...billed.map((b) => Number(b.quotation_id))].filter(Boolean))];
      }
      const qids = quotationIds.length ? quotationIds : [0];

      // 2. The family. Without a quotation it is just the document and its own link.
      const quotationRows = quotationIds.length
        ? await this.select<QuotationRow>(
            `SELECT id, quotation_number, DATE_FORMAT(COALESCE(quotation_date, created_at), '%Y-%m-%d') AS quotation_date,
                    status, has_invoice, customer_name, grand_total, customer_po_number,
                    DATE_FORMAT(customer_po_date, '%Y-%m-%d') AS customer_po_date
               FROM quotations WHERE id IN (:qids) AND company_id = :c`,
            { qids, c },
          )
        : [];
      const quotations = quotationIds.map((qid) => quotationRows.find((r) => Number(r.id) === qid)).filter(Boolean) as QuotationRow[];

      const challanCols = `dc.id, dc.challan_number, DATE_FORMAT(dc.challan_date, '%Y-%m-%d') AS challan_date, dc.status, dc.reason, dc.quotation_id,
             dc.total_quantity, dc.total_value, dc.vehicle_number, dc.transporter_name, dc.eway_bill_number, dc.invoice_id`;
      const challans = await this.select<ChallanRow>(
        `SELECT ${challanCols} FROM delivery_challans dc
          WHERE dc.company_id = :c AND dc.is_active = 1
            AND (dc.quotation_id IN (:qids) ${type === 'challan' ? 'OR dc.id = :id' : ''} ${type === 'invoice' ? 'OR dc.invoice_id = :id' : ''}
                 ${standaloneInvoiceId ? 'OR dc.invoice_id = :sid' : ''})`,
        { c, qids, id, sid: standaloneInvoiceId },
      );

      // Invoices that bill these quotations (by header or by any line), and the documents' own links.
      const linkedInvoiceIds = challans.map((r) => Number(r.invoice_id)).filter(Boolean);
      const invoiceIds = [...new Set([...(type === 'invoice' ? [id] : []), ...linkedInvoiceIds])];
      const invoices = await this.select<InvoiceRow>(
        `SELECT id, invoice_number, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
                status, grand_total, paid_amount, balance_amount, shipping_address_snapshot, billing_address_snapshot, customer_gst_number, quotation_id,
                transporter_name, vehicle_number, lr_number, eway_bill_number
           FROM invoices
          WHERE company_id = :c AND (
                quotation_id IN (:qids)
             OR id IN (SELECT ii.invoice_id FROM invoice_items ii JOIN quotation_items qi ON qi.id = ii.quotation_item_id WHERE qi.quotation_id IN (:qids))
             OR id IN (:ids))`,
        { c, qids, ids: invoiceIds.length ? invoiceIds : [0] },
      );
      if (invoices.length) {
        const billsFrom = await this.select<{ invoice_id: number; quotation_id: number }>(
          `SELECT DISTINCT ii.invoice_id, qi.quotation_id FROM invoice_items ii JOIN quotation_items qi ON qi.id = ii.quotation_item_id
            WHERE ii.invoice_id IN (:ids)`,
          { ids: invoices.map((i) => i.id) },
        );
        invoices.forEach((i) => {
          i.quotation_ids = billsFrom.filter((b) => Number(b.invoice_id) === Number(i.id)).map((b) => Number(b.quotation_id));
        });
      }

      const payments = invoices.length
        ? await this.select<PaymentRow>(
            `SELECT invoice_id, COUNT(*) AS n, COALESCE(SUM(payment_amount), 0) AS amount,
                    DATE_FORMAT(MAX(payment_date), '%Y-%m-%d') AS last_date
               FROM invoice_payments WHERE invoice_id IN (:ids) GROUP BY invoice_id`,
            { ids: invoices.map((i) => i.id) },
          )
        : [];

      // 3. The order balance: ordered / sent / billed for each line.
      const ledger = quotationIds.length
        ? await this.select<LedgerRow>(
            `SELECT qi.id AS quotation_item_id, qi.quotation_id, qi.product_name, qi.unit, qi.qty AS ordered, qi.rate, qi.discount_percent,
                    ${SENT_QTY_SQL} AS sent, ${BILLED_QTY_SQL} AS billed
               FROM quotation_items qi WHERE qi.quotation_id IN (:qids) ORDER BY qi.quotation_id, qi.id`,
            { qids },
          )
        : [];

      const trail = buildTrail({
        focus: { type, id },
        access,
        quotations,
        challans,
        invoices,
        payments,
        ledger,
      });
      return { success: true, message: 'Linked documents', data: trail };
    } catch (error) {
      log.error('Failed to load linked documents', error as Error);
      return { success: false, statusCode: 500, message: "The linked documents couldn't be loaded" };
    }
  }

  /**
   * Finds documents by any number on them: quotation, challan or invoice
   * number, the customer's PO number, a vehicle or an e-way bill number.
   * Only document types the person can open are searched.
   */
  async search(qRaw: unknown, req: LinksRequester): Promise<LinksResult> {
    const log = this.appLogger.forContext('DocumentLinksService', 'search', {});
    const typed = parseSearch(qRaw);
    const access = accessOf(req.permissions);
    // Purchases (add-on): its permissions only exist while the add-on is on.
    const perms = req.permissions || [];
    const buy = {
      po: perms.includes('purchases.view') || perms.includes('purchases.receive'),
      prices: perms.includes('purchases.view'),
      bill: perms.includes('purchases.view') || perms.includes('purchases.bills'),
    };
    if (!typed) return { success: true, message: 'Type at least 2 characters', data: { query: '', results: [] } };
    if (!access.quotation && !access.challan && !access.invoice && !buy.po && !buy.bill) {
      return { success: false, statusCode: 403, message: "You don't have access to quotations, challans or invoices" };
    }

    const c = req.companyId;
    const like = `%${likeEscape(typed)}%`;
    const squeezed = compact(typed);
    const likeCompact = `%${likeEscape(squeezed)}%`;
    const limit = SEARCH_PER_TYPE * 3; // ranked below, then cut per type
    // Spaces, dashes, dots and slashes are ignored too, so "MH12AB1234" finds
    // "MH 12 AB 1234" and "2627/0150" finds "KD/26-27/0150".
    const squeeze = (col: string) =>
      `REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(${col}, '')), ' ', ''), '-', ''), '.', ''), '/', '')`;
    const matches = (...cols: string[]) =>
      `(${cols.map((col) => `${col} LIKE :like${squeezed.length >= 2 ? ` OR ${squeeze(col)} LIKE :likeCompact` : ''}`).join(' OR ')})`;

    try {
      const none = () => [] as any[];
      const [quotations, challans, invoices, pos, grns, bills] = await Promise.all([
        access.quotation
          ? this.select(
              `SELECT id, quotation_number AS number, DATE_FORMAT(COALESCE(quotation_date, created_at), '%Y-%m-%d') AS date,
                      status, has_invoice, customer_name, grand_total AS amount, customer_po_number
                 FROM quotations
                WHERE company_id = :c AND COALESCE(status, '') <> 'DELETED' AND COALESCE(document_type, 'QT') = 'QT'
                  AND ${matches('quotation_number', 'customer_po_number')}
                ORDER BY id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            )
          : [],
        access.challan
          ? this.select(
              `SELECT dc.id, dc.challan_number AS number, DATE_FORMAT(dc.challan_date, '%Y-%m-%d') AS date, dc.status,
                      dc.customer_name, dc.total_value AS amount, dc.vehicle_number, dc.eway_bill_number
                 FROM delivery_challans dc
                WHERE dc.company_id = :c AND dc.is_active = 1
                  AND ${matches('dc.challan_number', 'dc.vehicle_number', 'dc.eway_bill_number')}
                ORDER BY dc.id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            )
          : [],
        access.invoice
          ? this.select(
              `SELECT i.id, i.invoice_number AS number, DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS date, i.status,
                      i.customer_name, i.grand_total AS amount, q.customer_po_number, i.vehicle_number, i.eway_bill_number
                 FROM invoices i
                 LEFT JOIN quotations q ON q.id = i.quotation_id AND q.company_id = i.company_id
                WHERE i.company_id = :c AND ${matches('i.invoice_number', 'q.customer_po_number', 'i.vehicle_number', 'i.eway_bill_number')}
                ORDER BY i.id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            )
          : [],
        buy.po
          ? this.select(
              `SELECT po.id, po.po_number AS number, DATE_FORMAT(po.po_date, '%Y-%m-%d') AS date, po.status, s.name AS customer_name,
                      ${buy.prices ? 'po.grand_total' : 'NULL'} AS amount, po.supplier_ref
                 FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
                WHERE po.company_id = :c AND ${matches('po.po_number', 'po.supplier_ref')}
                ORDER BY po.id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            ).catch(none)
          : [],
        buy.po
          ? this.select(
              `SELECT r.po_id AS id, r.grn_number AS number, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS date, r.status, s.name AS customer_name,
                      NULL AS amount, r.supplier_invoice_no, r.supplier_challan_no, r.vehicle_number, r.eway_bill_number
                 FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id
                WHERE r.company_id = :c AND ${matches('r.grn_number', 'r.supplier_invoice_no', 'r.supplier_challan_no', 'r.vehicle_number', 'r.eway_bill_number')}
                ORDER BY r.id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            ).catch(none)
          : [],
        buy.bill
          ? this.select(
              `SELECT b.id, b.bill_number AS number, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS date, b.status, s.name AS customer_name, b.grand_total AS amount
                 FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
                WHERE b.company_id = :c AND ${matches('b.bill_number')}
                ORDER BY b.id DESC LIMIT ${limit}`,
              { c, like, likeCompact },
            ).catch(none)
          : [],
      ]);

      // Which field matched, so the result can say "PO 4500123" or "Vehicle MH12…".
      const pick = (type: SearchType, row: any) => {
        const fields: [string, string | null][] =
          type === 'purchase_order'
            ? [['number', row.number], ['ref', row.supplier_ref]]
            : type === 'grn'
              ? [['number', row.number], ['bill', row.supplier_invoice_no], ['challan', row.supplier_challan_no], ['vehicle', row.vehicle_number], ['eway', row.eway_bill_number]]
              : type === 'supplier_bill'
                ? [['number', row.number]]
                : type === 'quotation'
            ? [['number', row.number], ['po', row.customer_po_number]]
            : type === 'challan'
              ? [['number', row.number], ['vehicle', row.vehicle_number], ['eway', row.eway_bill_number]]
              : [['number', row.number], ['po', row.customer_po_number], ['vehicle', row.vehicle_number], ['eway', row.eway_bill_number]];
        const ranked = fields
          .map(([field, value]) => ({ field, value, rank: matchRank(value, typed) }))
          .sort((a, b) => a.rank - b.rank)[0];
        return {
          type,
          id: Number(row.id),
          number: row.number,
          date: row.date || null,
          status: type === 'quotation' && (Number(row.has_invoice) === 1 || row.has_invoice === true) ? 'INVOICED' : row.status || null,
          customer_name: row.customer_name || null,
          amount: row.amount === null || row.amount === undefined ? null : Math.round(Number(row.amount) * 100) / 100,
          matched: ranked.rank < 3 ? ranked.field : 'number',
          matched_value: ranked.rank < 3 ? ranked.value : row.number,
          rank: ranked.rank,
        };
      };
      const results = (
        [
          ['quotation', quotations],
          ['challan', challans],
          ['invoice', invoices],
          ['purchase_order', pos],
          ['grn', grns],
          ['supplier_bill', bills],
        ] as [SearchType, any[]][]
      ).flatMap(([type, rows]) =>
        rows
          .map((r) => pick(type, r))
          .sort((a, b) => a.rank - b.rank || b.id - a.id)
          .slice(0, SEARCH_PER_TYPE),
      );
      // Best match first; among equally good matches, the newest document.
      results.sort((a, b) => a.rank - b.rank || String(b.date ?? '').localeCompare(String(a.date ?? '')));
      return {
        success: true,
        message: results.length ? `${results.length} found` : 'Nothing found',
        data: { query: typed, results: results.map(({ rank, ...r }) => r) },
      };
    } catch (error) {
      log.error('Search failed', error as Error);
      return { success: false, statusCode: 500, message: "The search didn't work. Please try again." };
    }
  }
}
