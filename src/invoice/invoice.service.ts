import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Op, QueryTypes, Transaction, WhereOptions, literal } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { InvoiceMapper } from './mapper/invoice.mapper';
import { LogContext } from '../common/logger/logger.context';
import { invoicesAttributes, users } from 'src/models/init-models';
import { GenrateInvoice } from './dto/genrateInvoice.dto';
import { DocumentSeriesService } from '../document-series/document-series.service';
import { businessDayStart, datePartsIn } from '../document-series/document-series.rules';
import { DEFAULT_TZ_MINUTES, addDays, parseTz, todayIn } from '../dashboard/dashboard.rules';
import {
  AGING_SQL,
  ATTENTION_ITEMS,
  DEAD_STATUSES,
  DUE_SOON_DAYS,
  LIVE_SQL,
  ListFilter,
  STATE_SQL,
  Sort,
  buildSummary,
  dateOnly,
  fromPaise,
  parseInvoiceDates,
  parseListFilter,
  parsePayment,
  parseSort,
  paymentBlocker,
  statusAfterPayment,
  summaryWindow,
  toPaise,
} from './invoice-insights.rules';
import { determineTaxType, getStateCodeFromGstin, getStateCodeFromName } from '../common/gst-state.util';
import { companyTaxesTransport } from '../common/transport-gst';
import {
  BILLABLE_QUOTATION_STATUSES,
  BILLED_QTY_SQL,
  BillLine,
  applyTaxType,
  directTotals,
  parseDirectLines,
  EPS,
  LedgerRow,
  MAX_CHALLANS_PER_INVOICE,
  READY_STATUSES,
  SENT_QTY_SQL,
  balanceOf,
  cancelBlocker,
  fullyBilled,
  invoiceTotals,
  leftToBillSql,
  liveInvoiceSql,
  mergeKey,
  mergeProblem,
  missingAddress,
  orList,
  overBilled,
  parseCancelReason,
  parseDispatch,
  parseQuantities,
  parseTransport,
  priceLine,
  progressOf,
  statusAfterUnbill,
  suggestedTransport,
} from './billing.rules';

/** JSON columns read with raw SQL arrive as strings (sometimes encoded twice). */
const deepJson = (v: unknown): any => {
  let parsed: any = v;
  try {
    while (typeof parsed === 'string') parsed = JSON.parse(parsed);
  } catch {
    return v;
  }
  return parsed;
};

/** Columns searched by the list's search box. */
const SEARCH_FIELDS = [
  'invoice_number',
  'quotation_number',
  'customer_name',
  'contact_person_name',
  'contact_person_email',
  'contact_person_phone',
] as const;

/** Heavy columns the list never shows (the details call returns them). */
const LIST_EXCLUDE = [
  'billing_address_snapshot',
  'shipping_address_snapshot',
  'business_details_snapshot',
  'payment_details_snapshot',
  'notes',
  'terms_conditions',
];

const USER_ATTRS = ['id', 'first_name', 'last_name', 'email'];

@Injectable()
export class InvoiceService {
  private readonly Users: typeof users;
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,

    private logger: AppLogger,
    private readonly documentSeries: DocumentSeriesService,
  ) {
    this.Users = this.db.db.users;
  }

  /** The business's "today" (India time): invoice and payment dates are business dates. */
  private businessToday() {
    return todayIn(new Date(), DEFAULT_TZ_MINUTES);
  }

  /**
   * Number for a new invoice, inside the caller's transaction. The company row
   * is locked first so concurrent invoices of one company are numbered one
   * after the other (the unique key company_id + invoice_number is the backstop).
   * Uses the company's numbering series when it has one, else the standard
   * INV-YYYYMMDD-NNNN (per company, India date).
   */
  private async nextInvoiceNumber(companyId: number, transaction: Transaction, seriesId?: number) {
    await this.db.db.companies.findByPk(companyId, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const now = new Date();
    const dayStart = businessDayStart(now);
    const [counts]: any[] = await this.db.sequelize.query(
      `SELECT
         SUM(created_at >= :dayStart) AS daily_count,
         COALESCE(MAX(overall_sequence), 0) AS max_overall
       FROM invoices WHERE company_id = :companyId`,
      { replacements: { companyId, dayStart }, type: QueryTypes.SELECT, transaction },
    );
    const dailySequence = Number(counts?.daily_count || 0) + 1;
    const overallSequence = Number(counts?.max_overall || 0) + 1;

    const issued = await this.documentSeries.issue(companyId, 'INVOICE', transaction, seriesId);
    if (issued) return { invoiceNumber: issued.number, dailySequence, overallSequence };

    const p = datePartsIn(now);
    const datePart = `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
    // Skip numbers that already exist (e.g. invoices deleted and re-made the same day).
    for (let seq = dailySequence; seq < dailySequence + 1000; seq++) {
      const invoiceNumber = `INV-${datePart}-${String(seq).padStart(4, '0')}`;
      const taken = await this.db.db.invoices.findOne({
        where: { company_id: companyId, invoice_number: invoiceNumber },
        attributes: ['id'],
        transaction,
      });
      if (!taken) return { invoiceNumber, dailySequence: seq, overallSequence };
    }
    throw new BadRequestException('Could not find a free invoice number for today');
  }

  // ── Invoice page list: live rows, state filters, sort ────────────────────

  /** Mirrors STATE_SQL in invoice-insights.rules.ts. */
  private stateConditions(filter: ListFilter | null, today: string): WhereOptions<invoicesAttributes>[] {
    const live: any = { [Op.or]: [{ status: { [Op.notIn]: DEAD_STATUSES } }, { status: null }] };
    const settled: any = { [Op.or]: [{ status: 'PAID' }, { balance_amount: { [Op.lte]: 0 } }, { balance_amount: null }] };
    const open: any = {
      [Op.and]: [{ [Op.or]: [{ status: { [Op.ne]: 'PAID' } }, { status: null }] }, { balance_amount: { [Op.gt]: 0 } }],
    };
    switch (filter) {
      case 'UNPAID':
        return [live, open, { [Op.or]: [{ paid_amount: { [Op.lte]: 0 } }, { paid_amount: null }] } as any];
      case 'PARTIAL':
        return [live, open, { paid_amount: { [Op.gt]: 0 } } as any];
      case 'PAID':
        return [live, settled];
      case 'OVERDUE':
        return [live, open, { due_date: { [Op.lt]: today } } as any];
      case 'DUE_SOON':
        return [live, open, { due_date: { [Op.between]: [today, addDays(today, DUE_SOON_DAYS - 1)] } } as any];
      case 'NO_DUE':
        return [live, open, { due_date: null } as any];
      case 'CANCELLED':
        return [{ status: { [Op.in]: DEAD_STATUSES } } as any];
      default:
        return [live];
    }
  }

  private listOrder(sort: Sort, filter: ListFilter | null): any[] {
    // The attention views read best by due date unless a sort was picked.
    if (sort === 'newest' && (filter === 'OVERDUE' || filter === 'DUE_SOON')) {
      return [['due_date', 'ASC'], ['balance_amount', 'DESC'], ['id', 'DESC']];
    }
    switch (sort) {
      case 'oldest':
        return [['invoice_date', 'ASC'], ['id', 'ASC']];
      case 'due_soonest':
        return [[literal('`invoices`.`due_date` IS NULL'), 'ASC'], ['due_date', 'ASC'], ['id', 'DESC']];
      case 'balance_high':
        return [['balance_amount', 'DESC'], ['id', 'DESC']];
      case 'amount_high':
        return [['grand_total', 'DESC'], ['id', 'DESC']];
      default:
        return [['invoice_date', 'DESC'], ['id', 'DESC']];
    }
  }

  async listInvoices(query: any, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'listInvoices', { companyId });
    try {
      const page = Math.max(1, Math.floor(Number(query?.page) || 1));
      const limit = Math.min(100, Math.max(1, Math.floor(Number(query?.limit) || 10)));
      const offset = (page - 1) * limit;
      const filter = parseListFilter(query?.status);
      const sort = parseSort(query?.sort);
      const today = todayIn(new Date(), parseTz(query?.tz));

      const conditions: any[] = [{ company_id: companyId }, ...this.stateConditions(filter, today)];
      const search = typeof query?.search === 'string' ? query.search.trim().slice(0, 100) : '';
      if (search) {
        conditions.push({ [Op.or]: SEARCH_FIELDS.map((f) => ({ [f]: { [Op.like]: `%${search}%` } })) });
      }

      const { rows, count } = await this.db.db.invoices.findAndCountAll({
        where: { [Op.and]: conditions },
        attributes: {
          exclude: LIST_EXCLUDE,
          include: [
            [
              literal(`(SELECT MAX(l.created_at) FROM invoice_activity_logs l WHERE l.invoice_id = \`invoices\`.\`id\` AND l.action = 'INVOICE_SENT')`),
              'last_sent_at',
            ],
            [
              literal(`(SELECT DATE_FORMAT(MAX(p.payment_date), '%Y-%m-%d') FROM invoice_payments p WHERE p.invoice_id = \`invoices\`.\`id\`)`),
              'last_paid_on',
            ],
            [literal(`(SELECT COUNT(*) FROM invoice_payments p WHERE p.invoice_id = \`invoices\`.\`id\`)`), 'payments_count'],
          ],
        },
        order: this.listOrder(sort, filter),
        limit,
        offset,
      });

      return {
        success: true,
        message: 'Invoices fetched successfully',
        data: {
          rows,
          pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
        },
      };
    } catch (error) {
      this.logger.error(ctx, 'List invoice failed', error);
      throw error;
    }
  }

  /**
   * Figures for the invoice page: payment states, what is owed and how late,
   * the last six months billed and collected, who owes the most. Computed live
   * in SQL (billing data is never cached), in the caller's time zone.
   */
  async getSummary(companyId: number, tzRaw: unknown) {
    const ctx = new LogContext('InvoiceService', 'getSummary', { companyId });
    try {
      const tz = parseTz(tzRaw);
      const today = todayIn(new Date(), tz);
      const { from, soon, prevFrom, prevTo } = summaryWindow(today);
      const replacements = { c: companyId, today, soon, from, prevFrom, prevTo };
      const rows = (sql: string): Promise<any[]> =>
        this.db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
      const open = `${STATE_SQL} IN ('unpaid', 'partial')`;

      const [stateRows, billedRows, collectedRows, prevRows, attentionRows, agingRows, debtorRows, speedRows, modeRows] = await Promise.all([
        rows(`
          SELECT state, COUNT(*) AS n, COALESCE(SUM(v), 0) AS v, COALESCE(SUM(p), 0) AS p, COALESCE(SUM(b), 0) AS b,
                 COALESCE(SUM(is_open AND dd < :today), 0) AS od_n,
                 COALESCE(SUM(CASE WHEN is_open AND dd < :today THEN b END), 0) AS od_v,
                 COALESCE(SUM(is_open AND dd BETWEEN :today AND :soon), 0) AS soon_n,
                 COALESCE(SUM(CASE WHEN is_open AND dd BETWEEN :today AND :soon THEN b END), 0) AS soon_v,
                 COALESCE(SUM(is_open AND dd IS NULL), 0) AS nodue_n,
                 COALESCE(SUM(CASE WHEN is_open AND dd IS NULL THEN b END), 0) AS nodue_v
          FROM (
            SELECT ${STATE_SQL} AS state, COALESCE(i.grand_total, 0) AS v, COALESCE(i.paid_amount, 0) AS p,
                   COALESCE(i.balance_amount, 0) AS b, i.due_date AS dd, ${open} AS is_open
            FROM invoices i
            WHERE i.company_id = :c
          ) x
          GROUP BY state`),
        rows(`
          SELECT DATE_FORMAT(i.invoice_date, '%Y-%m') AS m, COUNT(*) AS n, COALESCE(SUM(i.grand_total), 0) AS v
          FROM invoices i
          WHERE i.company_id = :c AND ${LIVE_SQL} AND i.invoice_date BETWEEN :from AND :today
          GROUP BY m`),
        rows(`
          SELECT DATE_FORMAT(p.payment_date, '%Y-%m') AS m, COUNT(*) AS n, COALESCE(SUM(p.payment_amount), 0) AS v
          FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE i.company_id = :c AND ${LIVE_SQL} AND p.payment_date BETWEEN :from AND :today
          GROUP BY m`),
        rows(`
          SELECT
            (SELECT COUNT(*) FROM invoices i WHERE i.company_id = :c AND ${LIVE_SQL} AND i.invoice_date BETWEEN :prevFrom AND :prevTo) AS bn,
            (SELECT COALESCE(SUM(i.grand_total), 0) FROM invoices i WHERE i.company_id = :c AND ${LIVE_SQL} AND i.invoice_date BETWEEN :prevFrom AND :prevTo) AS bv,
            (SELECT COUNT(*) FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
              WHERE i.company_id = :c AND ${LIVE_SQL} AND p.payment_date BETWEEN :prevFrom AND :prevTo) AS cn,
            (SELECT COALESCE(SUM(p.payment_amount), 0) FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
              WHERE i.company_id = :c AND ${LIVE_SQL} AND p.payment_date BETWEEN :prevFrom AND :prevTo) AS cv`),
        rows(`
          SELECT i.id, i.invoice_number, i.customer_name, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
                 i.grand_total, i.paid_amount, i.balance_amount, ${STATE_SQL} AS state
          FROM invoices i
          WHERE i.company_id = :c AND ${open} AND i.due_date IS NOT NULL AND i.due_date <= :soon
          ORDER BY i.due_date ASC, i.balance_amount DESC
          LIMIT ${ATTENTION_ITEMS}`),
        rows(`
          SELECT ${AGING_SQL} AS bucket, COUNT(*) AS n, COALESCE(SUM(i.balance_amount), 0) AS v
          FROM invoices i
          WHERE i.company_id = :c AND ${open}
          GROUP BY bucket`),
        rows(`
          SELECT MAX(i.customer_id) AS id, MAX(i.customer_name) AS name, COUNT(*) AS n,
                 COALESCE(SUM(i.balance_amount), 0) AS due,
                 COALESCE(SUM(CASE WHEN i.due_date < :today THEN i.balance_amount END), 0) AS late,
                 DATE_FORMAT(MIN(i.due_date), '%Y-%m-%d') AS oldest
          FROM invoices i
          WHERE i.company_id = :c AND ${open}
          GROUP BY COALESCE(CAST(i.customer_id AS CHAR), i.customer_name)
          ORDER BY due DESC
          LIMIT 5`),
        // Days from invoice date to the payment that settled it, for invoices settled in the window.
        rows(`
          SELECT AVG(DATEDIFF(lp.last_paid, i.invoice_date)) AS avg_days, COUNT(*) AS n
          FROM invoices i
          JOIN (SELECT p.invoice_id, MAX(p.payment_date) AS last_paid
                FROM invoice_payments p JOIN invoices i2 ON i2.id = p.invoice_id
                WHERE i2.company_id = :c GROUP BY p.invoice_id) lp ON lp.invoice_id = i.id
          WHERE i.company_id = :c AND ${LIVE_SQL} AND ${STATE_SQL} = 'paid' AND lp.last_paid BETWEEN :from AND :today`),
        rows(`
          SELECT p.payment_mode AS mode, COUNT(*) AS n, COALESCE(SUM(p.payment_amount), 0) AS v
          FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE i.company_id = :c AND ${LIVE_SQL} AND p.payment_date BETWEEN :from AND :today
          GROUP BY p.payment_mode`),
      ]);

      return {
        success: true,
        message: 'Invoice summary',
        data: buildSummary({
          today,
          stateRows,
          billedRows,
          collectedRows,
          prev: prevRows[0],
          attentionRows,
          agingRows,
          debtorRows,
          speed: speedRows[0],
          modeRows,
        }),
      };
    } catch (error) {
      this.logger.error(ctx, 'Invoice summary failed', error);
      return { success: false, message: 'Failed to load the invoice summary', data: null };
    }
  }

  /**
   * Approved quotations that still have something to bill (a quotation can
   * have several invoices), newest first, with how much is left and how many
   * of its challans are waiting to be billed. Says up front whether the
   * addresses are complete, because an invoice can't be made without them.
   */
  async eligibleQuotations(companyId: number, searchRaw: unknown) {
    const ctx = new LogContext('InvoiceService', 'eligibleQuotations', { companyId });
    try {
      const search = typeof searchRaw === 'string' ? searchRaw.trim().slice(0, 100) : '';
      const where = `q.company_id = :c AND q.status IN (:st)
        AND COALESCE(q.document_type, 'QT') = 'QT'
        AND ${leftToBillSql('q.id')}
        ${search ? 'AND (q.quotation_number LIKE :s OR q.customer_name LIKE :s OR q.contact_person_name LIKE :s OR q.customer_po_number LIKE :s)' : ''}`;
      const replacements = { c: companyId, s: `%${search}%`, st: BILLABLE_QUOTATION_STATUSES };
      const [list, totalRows] = await Promise.all([
        this.db.sequelize.query(
          `SELECT q.id, q.quotation_number, q.customer_id, q.customer_name, q.contact_person_name,
                  DATE_FORMAT(COALESCE(q.quotation_date, DATE(q.created_at)), '%Y-%m-%d') AS quotation_date,
                  DATE_FORMAT(q.validity_date, '%Y-%m-%d') AS validity_date,
                  q.grand_total, q.cgst_amount, q.sgst_amount, q.igst_amount, q.has_invoice, q.customer_po_number,
                  q.billing_address_snapshot, q.shipping_address_snapshot,
                  (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS items_count,
                  (SELECT COALESCE(SUM(GREATEST(qi.qty - ${BILLED_QTY_SQL}, 0) * qi.rate * (1 - COALESCE(qi.discount_percent, 0) / 100)), 0)
                     FROM quotation_items qi WHERE qi.quotation_id = q.id) AS to_bill_value,
                  (SELECT COUNT(*) FROM delivery_challans dc
                    WHERE dc.company_id = q.company_id AND dc.quotation_id = q.id AND dc.is_active = 1
                      AND dc.status IN ('DISPATCHED', 'DELIVERED') AND dc.invoice_id IS NULL) AS ready_challans
           FROM quotations q
           WHERE ${where}
           ORDER BY q.updated_at DESC, q.id DESC
           LIMIT 50`,
          { replacements, type: QueryTypes.SELECT },
        ),
        this.db.sequelize.query(`SELECT COUNT(*) AS n FROM quotations q WHERE ${where}`, {
          replacements,
          type: QueryTypes.SELECT,
        }),
      ]);
      const rows = (list as any[]).map((q) => {
        const { billing_address_snapshot, shipping_address_snapshot, ...rest } = q;
        return {
          ...rest,
          id: Number(q.id),
          grand_total: Number(q.grand_total || 0),
          gst: Number(q.cgst_amount || 0) + Number(q.sgst_amount || 0) + Number(q.igst_amount || 0),
          items_count: Number(q.items_count || 0),
          has_invoice: Number(q.has_invoice) === 1 || q.has_invoice === true,
          to_bill_value: Math.round(Number(q.to_bill_value || 0) * 100) / 100,
          ready_challans: Number(q.ready_challans || 0),
          billing_ok: this.validateAddress(billing_address_snapshot),
          shipping_ok: this.validateAddress(shipping_address_snapshot),
        };
      });
      return {
        success: true,
        message: 'Quotations ready to invoice',
        data: { rows, total: Number((totalRows as any[])[0]?.n || 0) },
      };
    } catch (error) {
      this.logger.error(ctx, 'Eligible quotations failed', error);
      throw error;
    }
  }

  // ── Step 2 of the linking plan: bill what was delivered ──────────────────
  // An invoice bills delivery challans (exactly what they carried) or chosen
  // quantities of one quotation. A quotation can have several invoices, and
  // nothing can be billed beyond what was ordered. The maths and the checks
  // live in billing.rules.ts; this part reads and writes the rows.

  private sel<T = any>(sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<T[]> {
    return this.db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  }

  /** Ordered / sent / billed for every line of these quotations. */
  private async ledgerFor(quotationIds: number[], transaction?: Transaction): Promise<LedgerRow[]> {
    const ids = [...new Set(quotationIds.filter(Boolean))];
    if (!ids.length) return [];
    return this.sel<LedgerRow>(
      `SELECT qi.id AS quotation_item_id, qi.quotation_id, qi.product_name, qi.description, qi.hsn_code, qi.unit,
              qi.qty AS ordered, qi.rate, qi.discount_percent, ${SENT_QTY_SQL} AS sent, ${BILLED_QTY_SQL} AS billed
         FROM quotation_items qi
        WHERE qi.quotation_id IN (:ids)
        ORDER BY qi.quotation_id, qi.id`,
      { ids },
      transaction,
    );
  }

  /** Approved quotations an invoice can bill from, with what the totals and the header need. */
  private async billingQuotations(ids: number[], companyId: number, transaction?: Transaction) {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map<number, any>();
    if (!unique.length) return map;
    const rows = await this.sel(
      `SELECT q.*, DATE_FORMAT(COALESCE(q.quotation_date, q.created_at), '%Y-%m-%d') AS q_date,
              (SELECT COALESCE(SUM(qi.discount_amount), 0) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS items_discount_total,
              EXISTS (SELECT 1 FROM invoices li
                       WHERE li.company_id = q.company_id AND ${liveInvoiceSql('li')}
                         AND (li.quotation_id = q.id OR EXISTS (
                               SELECT 1 FROM invoice_items lii JOIN quotation_items lqi ON lqi.id = lii.quotation_item_id
                                WHERE lii.invoice_id = li.id AND lqi.quotation_id = q.id))) AS has_live_invoice
         FROM quotations q
        WHERE q.id IN (:ids) AND q.company_id = :c AND q.status IN (:st) AND COALESCE(q.document_type, 'QT') = 'QT'`,
      { ids: unique, c: companyId, st: BILLABLE_QUOTATION_STATUSES },
      transaction,
    );
    for (const r of rows) {
      ['billing_address_snapshot', 'shipping_address_snapshot', 'business_details_snapshot', 'payment_details_snapshot'].forEach(
        (k) => (r[k] = deepJson(r[k])),
      );
      map.set(Number(r.id), { ...r, id: Number(r.id), has_live_invoice: Number(r.has_live_invoice) === 1 });
    }
    return map;
  }

  /** Delivery challans with their lines (locked FOR UPDATE inside a transaction when asked). */
  private async billingChallans(ids: number[], companyId: number, transaction?: Transaction, lock = false) {
    const unique = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!unique.length) return [];
    if (lock && transaction) {
      await this.sel(`SELECT id FROM delivery_challans WHERE id IN (:ids) AND company_id = :c FOR UPDATE`, { ids: unique, c: companyId }, transaction);
    }
    const challans = await this.sel(
      `SELECT dc.id, dc.challan_number, DATE_FORMAT(dc.challan_date, '%Y-%m-%d') AS challan_date, dc.status, dc.quotation_id,
              dc.invoice_id, dc.customer_id, dc.customer_name, dc.shipping_address_snapshot, dc.delivered_at,
              dc.total_quantity, dc.total_value
         FROM delivery_challans dc
        WHERE dc.id IN (:ids) AND dc.company_id = :c AND dc.is_active = 1
        ORDER BY dc.challan_date, dc.id`,
      { ids: unique, c: companyId },
      transaction,
    );
    const items = challans.length
      ? await this.sel(
          `SELECT id, delivery_challan_id, quotation_item_id, item_name, description, hsn_code, quantity, unit, rate
             FROM delivery_challan_items WHERE delivery_challan_id IN (:ids) ORDER BY delivery_challan_id, id`,
          { ids: challans.map((c: any) => c.id) },
          transaction,
        )
      : [];
    return challans.map((c: any) => ({
      ...c,
      id: Number(c.id),
      shipping_address_snapshot: deepJson(c.shipping_address_snapshot),
      items: items.filter((i: any) => Number(i.delivery_challan_id) === Number(c.id)),
    }));
  }

  private billInput(body: any) {
    return {
      challanIds: Array.isArray(body?.challan_ids) ? body.challan_ids.map(Number) : undefined,
      quotationId: Number(body?.quotation_id) || undefined,
      lines: body?.lines,
      transport: body?.transport_charges,
    };
  }

  /**
   * Works an invoice out without saving it: from delivery challans, or from
   * chosen quantities of one quotation. A plain BadRequest says why when it
   * can't be billed. `lock` (inside a transaction) holds the challans and
   * quotations so two invoices can't bill the same goods.
   */
  private async buildBill(
    input: { challanIds?: number[]; quotationId?: number; lines?: unknown; transport?: unknown },
    companyId: number,
    transaction?: Transaction,
    lock = false,
  ) {
    let challans: any[] = [];
    let quotationIds: number[];
    if (input.challanIds?.length) {
      if (input.challanIds.length > MAX_CHALLANS_PER_INVOICE) {
        throw new BadRequestException(`Bill at most ${MAX_CHALLANS_PER_INVOICE} challans on one invoice`);
      }
      challans = await this.billingChallans(input.challanIds, companyId, transaction, lock);
      if (challans.length !== new Set(input.challanIds.map(Number)).size) {
        throw new BadRequestException('Some of these challans no longer exist — reopen the dialog and try again');
      }
      for (const c of challans) {
        if (Number(c.invoice_id)) throw new BadRequestException(`${c.challan_number} is already billed`);
        if (!READY_STATUSES.includes(c.status)) {
          throw new BadRequestException(`${c.challan_number} is ${String(c.status).toLowerCase()} — only dispatched or delivered challans can be billed`);
        }
      }
      quotationIds = challans.map((c) => Number(c.quotation_id)).filter(Boolean);
    } else if (input.quotationId) {
      quotationIds = [input.quotationId];
    } else {
      throw new BadRequestException('Choose what to bill');
    }

    if (lock && transaction && quotationIds.length) {
      await this.sel(`SELECT id FROM quotations WHERE id IN (:ids) AND company_id = :c FOR UPDATE`, { ids: [...new Set(quotationIds)], c: companyId }, transaction);
    }
    const quotations = await this.billingQuotations(quotationIds, companyId, transaction);
    if (input.quotationId && !challans.length && !quotations.get(input.quotationId)) {
      throw new BadRequestException('Approved quotation not found');
    }
    const ledger = await this.ledgerFor([...quotations.keys()], transaction);

    let lines: BillLine[];
    if (challans.length) {
      const problem = mergeProblem(challans, quotations);
      if (problem) throw new BadRequestException(problem);
      const byItem = new Map(ledger.map((r) => [Number(r.quotation_item_id), r]));
      lines = challans
        .flatMap((c) =>
          c.items.map((it: any): BillLine => {
            const qi = it.quotation_item_id ? byItem.get(Number(it.quotation_item_id)) : undefined;
            return {
              quotation_item_id: qi ? Number(qi.quotation_item_id) : null,
              quotation_id: Number(c.quotation_id),
              delivery_challan_id: c.id,
              delivery_challan_item_id: Number(it.id),
              product_name: qi?.product_name || it.item_name,
              description: qi?.description ?? it.description ?? null,
              hsn_code: qi?.hsn_code ?? it.hsn_code ?? null,
              unit: qi?.unit ?? it.unit ?? null,
              qty: Number(it.quantity),
              // The agreed price is the quotation's; a line that isn't on the quotation keeps the challan's rate.
              rate: qi ? Number(qi.rate) : Number(it.rate || 0),
              discount_percent: qi ? Number(qi.discount_percent || 0) : 0,
            };
          }),
        )
        .filter((l) => l.qty > EPS);
      if (!lines.length) throw new BadRequestException('These challans have no quantities to bill');
      const over = overBilled(lines, ledger);
      if (over) throw new BadRequestException(`${over}. If its goods were billed already, link the challan to that invoice instead.`);
    } else {
      const parsed = parseQuantities(input.lines, ledger.filter((r) => Number(r.quotation_id) === input.quotationId));
      if (!parsed.ok) throw new BadRequestException(parsed.message);
      lines = parsed.lines;
    }

    const transportDefault = suggestedTransport([...quotations.values()]);
    const transport = parseTransport(input.transport, transportDefault);
    if (!transport.ok) throw new BadRequestException(transport.message);
    // The invoice follows the company's setting today (the GST rule), even
    // when its quotation was worked out the older way.
    const transportGst = await companyTaxesTransport(this.db.sequelize, companyId, transaction);

    const primary = quotations.get(Number(challans[0]?.quotation_id ?? input.quotationId));
    if (!primary) throw new BadRequestException('Approved quotation not found');

    // An invoice needs complete addresses (checked here so the preview says so
    // too). Delivery goes to where the challan says; a challan that didn't
    // record its address falls back to the quotation's ship-to.
    const noBilling = missingAddress(primary.billing_address_snapshot);
    if (noBilling.length) {
      throw new BadRequestException(`${primary.quotation_number}'s billing address has no ${orList(noBilling)} — update the quotation before invoicing`);
    }
    let shipping = challans.length ? challans[0].shipping_address_snapshot : primary.shipping_address_snapshot;
    if (challans.length && missingAddress(shipping).length) shipping = primary.shipping_address_snapshot;
    const noShipping = missingAddress(shipping);
    if (noShipping.length) {
      throw new BadRequestException(`${primary.quotation_number}'s shipping address has no ${orList(noShipping)} — update the quotation before invoicing`);
    }

    return {
      challans,
      quotations,
      primary,
      shipping,
      ledger,
      lines: lines.map(priceLine),
      totals: invoiceTotals(lines, quotations, transport.value, transportGst),
      transportDefault,
    };
  }

  private billView(bill: Awaited<ReturnType<InvoiceService['buildBill']>>) {
    return {
      lines: bill.lines.map((l) => ({
        quotation_item_id: l.quotation_item_id,
        delivery_challan_id: l.delivery_challan_id ?? null,
        product_name: l.product_name,
        hsn_code: l.hsn_code,
        unit: l.unit,
        qty: l.qty,
        rate: l.rate,
        discount_percent: l.discount_percent,
        total: l.total,
      })),
      totals: bill.totals,
      transport_suggested: bill.transportDefault,
      quotations: [...bill.quotations.values()].map((q) => ({ id: q.id, quotation_number: q.quotation_number, quotation_date: q.q_date })),
      challans: bill.challans.map((c) => ({ id: c.id, challan_number: c.challan_number, challan_date: c.challan_date })),
    };
  }

  /** The invoice a "Make invoice" would create — the same maths, nothing saved. */
  async previewBill(body: any, companyId: number) {
    const bill = await this.buildBill(this.billInput(body), companyId);
    return { success: true, message: 'Invoice preview', data: this.billView(bill) };
  }

  /**
   * What can be billed for a quotation or a challan: the quotation's lines
   * (ordered / sent / billed / left), and the customer's dispatched or
   * delivered challans that aren't billed yet, with which ones can share an
   * invoice with the starting point.
   */
  async billable(query: { quotation_id?: unknown; challan_id?: unknown }, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'billable', { companyId });
    try {
      const challanId = Number(query?.challan_id) || null;
      let quotationId = Number(query?.quotation_id) || null;
      let focus: any = null;
      if (challanId) {
        [focus] = await this.billingChallans([challanId], companyId);
        if (!focus) throw new BadRequestException('Delivery challan not found');
        if (!focus.quotation_id) throw new BadRequestException('Challans made without a quotation are billed in a later step');
        quotationId = Number(focus.quotation_id);
      }
      if (!quotationId) throw new BadRequestException('Choose a quotation or a challan to bill');
      const base = await this.billingQuotations([quotationId], companyId);
      const quotation = base.get(quotationId);
      if (!quotation) throw new BadRequestException('Approved quotation not found');
      const customerId = Number(focus?.customer_id ?? quotation.customer_id);

      const ready = await this.sel(
        `SELECT dc.id FROM delivery_challans dc
          WHERE dc.company_id = :c AND dc.is_active = 1 AND dc.customer_id = :cust AND dc.quotation_id IS NOT NULL
            AND dc.status IN ('DISPATCHED', 'DELIVERED') AND dc.invoice_id IS NULL
          ORDER BY dc.challan_date, dc.id LIMIT 200`,
        { c: companyId, cust: customerId },
      );
      const challans = await this.billingChallans(ready.map((r: any) => Number(r.id)), companyId);
      const quotations = await this.billingQuotations([quotationId, ...challans.map((c) => Number(c.quotation_id))], companyId);
      const ledger = await this.ledgerFor([...quotations.keys()]);
      const balance = ledger.filter((r) => Number(r.quotation_id) === quotationId).map(balanceOf);

      return {
        success: true,
        message: 'What can be billed',
        data: {
          customer: { id: customerId, name: quotation.customer_name },
          quotation: {
            id: quotation.id,
            quotation_number: quotation.quotation_number,
            quotation_date: quotation.q_date,
            grand_total: Number(quotation.grand_total || 0),
            transport_charges: Number(quotation.transport_charges || 0),
            has_live_invoice: quotation.has_live_invoice,
            billing_ok: this.validateAddress(quotation.billing_address_snapshot),
            shipping_ok: this.validateAddress(quotation.shipping_address_snapshot),
          },
          lines: balance,
          fully_billed: fullyBilled(balance),
          progress: progressOf(balance),
          focus_challan_id: focus ? focus.id : null,
          focus_key: focus ? mergeKey(focus, quotations.get(quotationId)) : null,
          ready_challans: challans.map((c) => {
            const q = quotations.get(Number(c.quotation_id));
            const lines = c.items.map((it: any) => ({
              quotation_item_id: Number(it.quotation_item_id) || null,
              quotation_id: Number(c.quotation_id),
              product_name: it.item_name,
              qty: Number(it.quantity),
              rate: 0,
              discount_percent: 0,
            }));
            const problem = q ? overBilled(lines, ledger) : 'Its quotation is not approved';
            return {
              id: c.id,
              challan_number: c.challan_number,
              challan_date: c.challan_date,
              status: c.status,
              quotation_id: Number(c.quotation_id),
              quotation_number: q?.quotation_number || null,
              total_quantity: Number(c.total_quantity || 0),
              total_value: Number(c.total_value || 0),
              items_count: c.items.length,
              billable: !problem,
              note: problem,
              merge_key: mergeKey(c, q),
            };
          }),
        },
      };
    } catch (error) {
      if (!(error instanceof BadRequestException)) this.logger.error(ctx, 'Billable lookup failed', error);
      throw error;
    }
  }

  /** Invoice from one or more delivery challans of one customer. */
  async createFromChallans(body: any, userId: number, companyId: number) {
    const input = this.billInput(body);
    if (!input.challanIds?.length) throw new BadRequestException('Choose the challans to bill');
    return this.createBill({ ...input, quotationId: undefined, lines: undefined }, body, userId, companyId);
  }

  /**
   * CGST + SGST or IGST, from the seller's GST state (the company, or the
   * branch the invoice is issued under) and the buyer's state. Same rule as
   * QuotationService.resolveTaxType.
   */
  private async taxTypeFor(companyId: number, locationId: number | null, buyerStateName: string | null, transaction?: Transaction) {
    let sellerStateCode: string | null = null;
    if (locationId) {
      const location: any = await this.db.db.company_locations.findOne({ where: { id: locationId, company_id: companyId }, transaction });
      if (!location) throw new BadRequestException('That branch is not one of yours');
      sellerStateCode = location.gst_state_code || getStateCodeFromGstin(location.gst_no) || getStateCodeFromName(location.address_state) || null;
    }
    if (!sellerStateCode) {
      const company: any = await this.db.db.companies.findByPk(companyId, { attributes: ['id', 'gst_state_code', 'gst_no'], transaction });
      sellerStateCode = company?.gst_state_code || getStateCodeFromGstin(company?.gst_no) || null;
    }
    return determineTaxType(sellerStateCode, getStateCodeFromName(buyerStateName));
  }

  /**
   * An invoice without a quotation: a walk-in sale, or billing challans made
   * without one. Customer, contact and addresses come from the customer's own
   * records; GST is split by the seller's and buyer's states; the totals use
   * the quotation's formula. Challans passed in (made without a quotation,
   * dispatched or delivered, same customer) are linked to it.
   */
  async createDirectInvoice(body: any, userId: number, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'createDirectInvoice', { companyId, userId });
    const parsedLines = parseDirectLines(body?.items);
    if (!parsedLines.ok) throw new BadRequestException(parsedLines.message);
    const transport = parseTransport(body?.transport_charges, 0);
    if (!transport.ok) throw new BadRequestException(transport.message);
    const dispatch = parseDispatch(body || {});
    if (!dispatch.ok) throw new BadRequestException(dispatch.message);
    const overall = Number(body?.discount_amount || 0);
    if (!Number.isFinite(overall) || overall < 0) throw new BadRequestException('The discount must be zero or more');
    const challanIds: number[] = Array.isArray(body?.challan_ids) ? [...new Set<number>(body.challan_ids.map(Number))].filter((n) => n > 0) : [];

    const transaction = await this.db.sequelize.transaction();
    try {
      const customer: any = await this.db.db.customers.findOne({
        where: { id: Number(body?.customer_id) || 0, company_id: companyId },
        include: [
          { model: this.db.db.customer_contacts, as: 'contacts' },
          { model: this.db.db.customer_addresses, as: 'addresses' },
        ],
        transaction,
      });
      if (!customer) throw new BadRequestException('Choose the customer');
      const contact = body?.contact_person_id ? (customer.contacts || []).find((x: any) => Number(x.id) === Number(body.contact_person_id)) : null;
      if (body?.contact_person_id && !contact) throw new BadRequestException("That contact isn't one of this customer's");
      const billingRow = (customer.addresses || []).find((a: any) => Number(a.id) === Number(body?.billing_address_id));
      if (!billingRow) throw new BadRequestException("Choose the customer's billing address");
      const shippingRow = body?.shipping_address_id
        ? (customer.addresses || []).find((a: any) => Number(a.id) === Number(body.shipping_address_id))
        : billingRow;
      if (!shippingRow) throw new BadRequestException("That shipping address isn't one of this customer's");
      const billing = billingRow.toJSON();
      const shipping = shippingRow.toJSON();
      const noBilling = missingAddress(billing);
      if (noBilling.length) throw new BadRequestException(`The billing address has no ${orList(noBilling)} — complete it in the customer first`);
      const noShipping = missingAddress(shipping);
      if (noShipping.length) throw new BadRequestException(`The shipping address has no ${orList(noShipping)} — complete it in the customer first`);

      const taxType = await this.taxTypeFor(companyId, Number(body?.issuing_location_id) || null, billing.state || shipping.state || null, transaction);
      const rates = applyTaxType(taxType, { cgst: body?.cgst_percent, sgst: body?.sgst_percent, igst: body?.igst_percent });
      if ([rates.cgst, rates.sgst, rates.igst].some((r) => r < 0 || r > 50)) throw new BadRequestException('Enter a valid GST rate');

      // Challans made without a quotation, billed on this invoice.
      let challans: any[] = [];
      if (challanIds.length) {
        challans = await this.billingChallans(challanIds, companyId, transaction, true);
        if (challans.length !== challanIds.length) throw new BadRequestException('Some of these challans no longer exist — reopen and try again');
        for (const c of challans) {
          if (c.quotation_id) throw new BadRequestException(`${c.challan_number} was made from a quotation — bill it from there`);
          if (Number(c.invoice_id)) throw new BadRequestException(`${c.challan_number} is already billed`);
          if (!READY_STATUSES.includes(c.status)) throw new BadRequestException(`${c.challan_number} hasn't been dispatched yet`);
          if (Number(c.customer_id) !== Number(customer.id)) throw new BadRequestException(`${c.challan_number} is for a different customer`);
        }
      }

      const dates = parseInvoiceDates(body || {}, { today: this.businessToday(), quotationDate: null });
      if (!dates.ok) throw new BadRequestException(dates.message);
      const lastChallan = challans.map((c) => c.challan_date).filter(Boolean).sort().pop();
      if (lastChallan && dates.invoiceDate < lastChallan) {
        throw new BadRequestException(`The invoice date can't be before the challan date (${lastChallan})`);
      }

      const lines = parsedLines.lines.map(priceLine);
      const transportGst = await companyTaxesTransport(this.db.sequelize, companyId, transaction);
      const t = directTotals(parsedLines.lines, overall, transport.value, rates, transportGst);
      if (t.items_taxable < 0) throw new BadRequestException("The discount is more than the items' value");

      const { invoiceNumber, dailySequence, overallSequence } = await this.nextInvoiceNumber(companyId, transaction, body?.series_id);
      const contactName = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : null;
      const invoice = await this.db.db.invoices.create(
        {
          quotation_id: null,
          company_id: companyId,
          customer_id: customer.id,
          invoice_number: invoiceNumber,
          quotation_number: null,
          document_type: 'INV',
          daily_sequence: dailySequence,
          overall_sequence: overallSequence,
          invoice_date: dates.invoiceDate as any,
          due_date: dates.dueDate as any,
          status: 'GENERATED',
          customer_name: customer.display_name,
          customer_type: customer.customer_type,
          customer_gst_number: customer.gst_number || null,
          contact_person_name: contactName || null,
          contact_person_email: contact?.email || null,
          contact_person_phone: contact?.phone || null,
          billing_address_snapshot: billing,
          shipping_address_snapshot: shipping,
          business_details_snapshot: deepJson(body?.business_details_snapshot) || null,
          payment_details_snapshot: deepJson(body?.payment_details_snapshot) || null,
          notes: typeof body?.notes === 'string' ? body.notes.slice(0, 5000) : null,
          terms_conditions: typeof body?.terms_conditions === 'string' ? body.terms_conditions.slice(0, 5000) : null,
          sub_total: t.sub_total,
          discount_percent: t.discount_percent,
          discount_amount: t.discount_amount,
          cgst_percent: t.cgst_percent,
          cgst_amount: t.cgst_amount,
          sgst_percent: t.sgst_percent,
          sgst_amount: t.sgst_amount,
          igst_percent: t.igst_percent,
          igst_amount: t.igst_amount,
          transport_charges: t.transport_charges,
          transport_gst: t.transport_gst,
          grand_total: t.grand_total,
          paid_amount: 0,
          balance_amount: t.grand_total,
          generated_by: userId,
          ...dispatch.values,
        } as any,
        { transaction },
      );
      await this.db.db.invoice_items.bulkCreate(
        lines.map((l) => ({
          invoice_id: invoice.id,
          quotation_item_id: null,
          delivery_challan_id: null,
          delivery_challan_item_id: null,
          product_name: l.product_name,
          description: l.description,
          hsn_code: l.hsn_code,
          qty: l.qty,
          unit: l.unit,
          rate: l.rate,
          discount_percent: l.discount_percent,
          discount_amount: l.discount_amount,
          discounted_rate: l.discounted_rate,
          total: l.total,
        })),
        { transaction },
      );
      for (const c of challans) {
        await this.db.db.delivery_challans.update({ status: 'INVOICED', invoice_id: invoice.id, updated_by: userId }, { where: { id: c.id }, transaction });
        await this.db.db.delivery_challan_activity_logs.create(
          {
            delivery_challan_id: c.id,
            action: 'INVOICED',
            old_value: { status: c.status, challan_number: c.challan_number, invoice_id: null },
            new_value: { status: 'INVOICED', invoice_id: invoice.id, invoice_number: invoiceNumber, invoice_generated: true },
            changed_by: userId,
          },
          { transaction },
        );
      }
      await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: 'INVOICE_GENERATED',
          changed_by: userId,
          new_value: {
            direct: true,
            challan_numbers: challans.map((c) => c.challan_number),
            invoice_date: dates.invoiceDate,
            due_date: dates.dueDate,
            grand_total: t.grand_total,
          },
        },
        { transaction },
      );
      await transaction.commit();
      return {
        success: true,
        message: `Invoice ${invoiceNumber} created${challans.length ? ` for ${challans.length === 1 ? challans[0].challan_number : `${challans.length} challans`}` : ''}`,
        data: { ...invoice.toJSON(), invoice: { id: invoice.id, invoice_number: invoiceNumber }, invoice_generated: true, converted_challan_ids: challans.map((c) => c.id) },
      };
    } catch (error) {
      await transaction.rollback();
      if (!(error instanceof BadRequestException)) this.logger.error(ctx, 'Direct invoice failed', error);
      throw error;
    }
  }

  /**
   * Invoice from a quotation: the chosen quantities of its lines, or (no
   * lines given) everything not billed yet. A quotation can have several.
   */
  async generateInvoice(quotationId: number, body: any, generatedBy: number, companyId: number) {
    return this.createBill({ quotationId, lines: body?.lines, transport: body?.transport_charges }, body, generatedBy, companyId);
  }

  private async createBill(
    input: { challanIds?: number[]; quotationId?: number; lines?: unknown; transport?: unknown },
    body: any,
    userId: number,
    companyId: number,
  ) {
    const ctx = new LogContext('InvoiceService', 'createBill', { companyId, userId });
    const transaction = await this.db.sequelize.transaction();
    try {
      const bill = await this.buildBill(input, companyId, transaction, true);
      const q = bill.primary;
      const shipping = bill.shipping;

      const latestQuotation = [...bill.quotations.values()].map((x) => x.q_date).filter(Boolean).sort().pop() || null;
      const dates = parseInvoiceDates(body || {}, { today: this.businessToday(), quotationDate: latestQuotation });
      if (!dates.ok) throw new BadRequestException(dates.message);
      const lastChallan = bill.challans.map((c) => c.challan_date).filter(Boolean).sort().pop();
      if (lastChallan && dates.invoiceDate < lastChallan) {
        throw new BadRequestException(`The invoice date can't be before the challan date (${lastChallan})`);
      }

      // Dispatch details when the invoice travels with the goods (optional).
      const dispatch = parseDispatch(body || {});
      if (!dispatch.ok) throw new BadRequestException(dispatch.message);

      const { invoiceNumber, dailySequence, overallSequence } = await this.nextInvoiceNumber(companyId, transaction, body?.series_id);
      const t = bill.totals;
      const invoice = await this.db.db.invoices.create(
        {
          ...InvoiceMapper.buildInvoicePayload(q, invoiceNumber, { dailySequence, overallSequence }, userId, body || {}),
          ...dispatch.values,
          shipping_address_snapshot: shipping,
          invoice_date: dates.invoiceDate,
          due_date: dates.dueDate,
          sub_total: t.sub_total,
          discount_percent: t.discount_percent,
          discount_amount: t.discount_amount,
          cgst_percent: t.cgst_percent,
          cgst_amount: t.cgst_amount,
          sgst_percent: t.sgst_percent,
          sgst_amount: t.sgst_amount,
          igst_percent: t.igst_percent,
          igst_amount: t.igst_amount,
          transport_charges: t.transport_charges,
          transport_gst: t.transport_gst,
          grand_total: t.grand_total,
          paid_amount: 0,
          balance_amount: t.grand_total,
        },
        { transaction },
      );

      await this.db.db.invoice_items.bulkCreate(
        bill.lines.map((l) => ({
          invoice_id: invoice.id,
          quotation_item_id: l.quotation_item_id,
          delivery_challan_id: l.delivery_challan_id ?? null,
          delivery_challan_item_id: l.delivery_challan_item_id ?? null,
          product_name: l.product_name,
          description: l.description,
          hsn_code: l.hsn_code,
          qty: l.qty,
          unit: l.unit,
          rate: l.rate,
          discount_percent: l.discount_percent,
          discount_amount: l.discount_amount,
          discounted_rate: l.discounted_rate,
          total: l.total,
        })),
        { transaction },
      );

      // The challans billed — and any other sent challan of a quotation this
      // invoice bills in full: its goods are on an invoice now, too.
      const billedIds = bill.challans.map((c) => c.id);
      const after = await this.ledgerFor([...bill.quotations.keys()], transaction);
      const completed = [...bill.quotations.keys()].filter((qid) => fullyBilled(after.filter((r) => Number(r.quotation_id) === qid)));
      const covered: any[] = completed.length
        ? await this.sel(
            `SELECT id FROM delivery_challans
              WHERE company_id = :c AND is_active = 1 AND quotation_id IN (:q) AND status IN ('DISPATCHED', 'DELIVERED')
                AND invoice_id IS NULL AND id NOT IN (:b)
              FOR UPDATE`,
            { c: companyId, q: completed, b: billedIds.length ? billedIds : [0] },
            transaction,
          )
        : [];
      const toLink = [...billedIds.map((id) => ({ id, covered: false })), ...covered.map((r: any) => ({ id: Number(r.id), covered: true }))];
      for (const link of toLink) {
        const [row] = await this.sel(`SELECT status, challan_number FROM delivery_challans WHERE id = :id`, { id: link.id }, transaction);
        await this.db.db.delivery_challans.update({ status: 'INVOICED', invoice_id: invoice.id, updated_by: userId }, { where: { id: link.id }, transaction });
        await this.db.db.delivery_challan_activity_logs.create(
          {
            delivery_challan_id: link.id,
            action: 'INVOICED',
            old_value: { status: row?.status, challan_number: row?.challan_number, invoice_id: null },
            new_value: { status: 'INVOICED', invoice_id: invoice.id, invoice_number: invoiceNumber, invoice_generated: true, ...(link.covered ? { covered_by_invoice: true } : {}) },
            changed_by: userId,
          },
          { transaction },
        );
      }

      await this.db.db.quotations.update(
        { has_invoice: true },
        { where: { id: { [Op.in]: [...bill.quotations.keys()] }, company_id: companyId }, transaction },
      );

      await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: 'INVOICE_GENERATED',
          changed_by: userId,
          new_value: {
            quotation_id: q.id,
            quotation_number: q.quotation_number,
            quotation_numbers: [...bill.quotations.values()].map((x) => x.quotation_number),
            challan_numbers: bill.challans.map((c) => c.challan_number),
            covered_challan_ids: covered.map((r: any) => Number(r.id)),
            invoice_date: dates.invoiceDate,
            due_date: dates.dueDate,
            grand_total: t.grand_total,
          },
        },
        { transaction },
      );

      await transaction.commit();

      const n = bill.challans.length;
      const what = n === 1 ? ` for ${bill.challans[0].challan_number}` : n > 1 ? ` for ${n} challans` : '';
      const also = covered.length ? ` — ${covered.length} more challan${covered.length === 1 ? ' is' : 's are'} covered by it` : '';
      return {
        success: true,
        message: `Invoice ${invoiceNumber} created${what}${also}`,
        data: {
          ...invoice.toJSON(),
          invoice: { id: invoice.id, invoice_number: invoiceNumber },
          invoice_generated: true,
          converted_challan_ids: toLink.map((l) => l.id),
        },
      };
    } catch (error) {
      await transaction.rollback();
      if (!(error instanceof BadRequestException)) this.logger.error(ctx, 'Create invoice failed', error);
      throw error;
    }
  }

  /**
   * Adds or changes the dispatch details of an invoice that travels with the
   * goods (vehicle, transporter, LR and e-way bill numbers) — they print in
   * its dispatch box.
   */
  async updateDispatch(invoiceId: number, body: any, userId: number, companyId: number) {
    const parsed = parseDispatch(body || {});
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    if (!Object.keys(parsed.values).length) throw new BadRequestException('Nothing to save');
    const transaction = await this.db.sequelize.transaction();
    try {
      const invoice = await this.db.db.invoices.findOne({
        where: { id: invoiceId, company_id: companyId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!invoice) throw new BadRequestException('Invoice not found');
      if (DEAD_STATUSES.includes(invoice.status)) throw new BadRequestException('A cancelled invoice cannot be changed');
      const before = {
        transporter_name: invoice.transporter_name ?? null,
        vehicle_number: invoice.vehicle_number ?? null,
        lr_number: invoice.lr_number ?? null,
        eway_bill_number: invoice.eway_bill_number ?? null,
      };
      await invoice.update(parsed.values, { transaction });
      await this.db.db.invoice_activity_logs.create(
        { invoice_id: invoice.id, action: 'DISPATCH_UPDATED', changed_by: userId, old_value: before, new_value: parsed.values },
        { transaction },
      );
      await transaction.commit();
      return {
        success: true,
        message: `Dispatch details saved on ${invoice.invoice_number}`,
        data: { id: invoice.id, ...before, ...parsed.values },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Cancels a live invoice that has no payments. Its challans go back to
   * "ready to invoice" and the quotations it billed have those quantities
   * free again. The number stays used — a cancelled invoice is kept.
   */
  async cancelInvoice(invoiceId: number, body: any, userId: number, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'cancelInvoice', { invoiceId, companyId });
    const reason = parseCancelReason(body?.reason);
    if (!reason.ok) throw new BadRequestException(reason.message);
    const transaction = await this.db.sequelize.transaction();
    try {
      const invoice = await this.db.db.invoices.findOne({
        where: { id: invoiceId, company_id: companyId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!invoice) throw new BadRequestException('Invoice not found');
      const blocked = cancelBlocker(invoice);
      if (blocked) throw new BadRequestException(blocked);

      const before = { status: invoice.status };
      await invoice.update({ status: 'CANCELLED' }, { transaction });

      const challans = await this.sel(
        `SELECT id, challan_number, status, delivered_at FROM delivery_challans
          WHERE company_id = :c AND invoice_id = :id AND is_active = 1 FOR UPDATE`,
        { c: companyId, id: invoiceId },
        transaction,
      );
      for (const c of challans) {
        const status = statusAfterUnbill(c);
        await this.db.db.delivery_challans.update({ status, invoice_id: null, updated_by: userId }, { where: { id: c.id }, transaction });
        await this.db.db.delivery_challan_activity_logs.create(
          {
            delivery_challan_id: c.id,
            action: 'INVOICE_CANCELLED',
            old_value: { status: c.status, challan_number: c.challan_number, invoice_id: invoiceId },
            new_value: { status, invoice_id: null, cancelled_invoice_number: invoice.invoice_number, reason: reason.reason },
            changed_by: userId,
          },
          { transaction },
        );
      }

      // The quotations it billed stay "invoiced" only while another live invoice bills them.
      const billedFrom = await this.sel(
        `SELECT DISTINCT qi.quotation_id FROM invoice_items ii JOIN quotation_items qi ON qi.id = ii.quotation_item_id WHERE ii.invoice_id = :id`,
        { id: invoiceId },
        transaction,
      );
      const quotationIds = [...new Set([Number(invoice.quotation_id), ...billedFrom.map((r: any) => Number(r.quotation_id))].filter(Boolean))];
      if (quotationIds.length) {
        await this.db.sequelize.query(
          `UPDATE quotations q
              SET q.has_invoice = EXISTS (
                    SELECT 1 FROM invoices li
                     WHERE li.company_id = q.company_id AND ${liveInvoiceSql('li')}
                       AND (li.quotation_id = q.id OR EXISTS (
                             SELECT 1 FROM invoice_items lii JOIN quotation_items lqi ON lqi.id = lii.quotation_item_id
                              WHERE lii.invoice_id = li.id AND lqi.quotation_id = q.id)))
            WHERE q.id IN (:ids) AND q.company_id = :c`,
          { replacements: { ids: quotationIds, c: companyId }, transaction },
        );
      }

      await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: 'INVOICE_CANCELLED',
          changed_by: userId,
          old_value: before,
          new_value: { status: 'CANCELLED', reason: reason.reason, freed_challans: challans.map((c: any) => c.challan_number) },
        },
        { transaction },
      );
      await transaction.commit();

      const n = challans.length;
      return {
        success: true,
        message: `${invoice.invoice_number} cancelled${n ? ` — ${n === 1 ? challans[0].challan_number + ' is' : n + ' challans are'} ready to invoice again` : ''}`,
        data: { id: invoice.id, status: 'CANCELLED', freed_challan_ids: challans.map((c: any) => Number(c.id)) },
      };
    } catch (error) {
      await transaction.rollback();
      if (!(error instanceof BadRequestException)) this.logger.error(ctx, 'Cancel invoice failed', error);
      throw error;
    }
  }

  async getInvoiceDetails(invoiceId: number, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'getInvoiceDetails', {
      invoiceId,
      companyId,
    });

    try {
      const invoice = await this.db.db.invoices.findOne({
        where: {
          id: invoiceId,
          company_id: companyId,
        },

        include: [
          {
            model: this.db.db.invoice_items,
            as: 'items',
            required: false,
          },
          {
            model: this.db.db.invoice_payments,
            as: 'payments',
            required: false,
            include: [{ model: this.Users, as: 'received_by_user', attributes: USER_ATTRS, required: false }],
          },
          {
            model: this.Users,
            as: 'generated_by_user',
            attributes: USER_ATTRS,
            required: false,
          },
        ],
        order: [
          [{ model: this.db.db.invoice_items, as: 'items' }, 'id', 'ASC'],
          [{ model: this.db.db.invoice_payments, as: 'payments' }, 'payment_date', 'DESC'],
          [{ model: this.db.db.invoice_payments, as: 'payments' }, 'id', 'DESC'],
        ],
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const [sent]: any[] = await this.db.sequelize.query(
        `SELECT MAX(created_at) AS last_sent_at FROM invoice_activity_logs WHERE invoice_id = :id AND action = 'INVOICE_SENT'`,
        { replacements: { id: invoiceId }, type: QueryTypes.SELECT },
      );

      return {
        success: true,
        message: 'Invoice details fetched successfully',
        data: { ...invoice.toJSON(), last_sent_at: sent?.last_sent_at || null },
      };
    } catch (error) {
      this.logger.error(ctx, 'Get invoice details failed', error);

      throw error;
    }
  }

  /**
   * Records a payment. The invoice row is locked so two payments recorded at
   * the same moment can't both fit into the same balance; all money maths is
   * done in paise.
   */
  async addPayment(
    invoiceId: number,
    payload: any,
    companyId: number,
    receivedBy: number,
  ) {
    const ctx = new LogContext('InvoiceService', 'addPayment', {
      invoiceId,
      companyId,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      const invoice = await this.db.db.invoices.findOne({
        where: {
          id: invoiceId,
          company_id: companyId,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const blocked = paymentBlocker(invoice);
      if (blocked) throw new BadRequestException(blocked);

      const totalPaise = toPaise(invoice.grand_total);
      const alreadyPaidPaise = toPaise(invoice.paid_amount);
      const parsed = parsePayment(payload || {}, {
        balancePaise: totalPaise - alreadyPaidPaise,
        today: this.businessToday(),
      });
      if (!parsed.ok) throw new BadRequestException(parsed.message);

      const newPaidPaise = alreadyPaidPaise + parsed.amountPaise;
      const status = statusAfterPayment(totalPaise, newPaidPaise);

      const payment = await this.db.db.invoice_payments.create(
        {
          invoice_id: invoice.id,
          payment_date: parsed.date,
          payment_amount: fromPaise(parsed.amountPaise),
          payment_mode: parsed.mode,
          transaction_reference: parsed.reference,
          remarks: parsed.notes,
          received_by: receivedBy,
        },
        {
          transaction,
        },
      );

      await invoice.update(
        {
          paid_amount: fromPaise(newPaidPaise),
          balance_amount: fromPaise(totalPaise - newPaidPaise),
          status,
        },
        {
          transaction,
        },
      );

      await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: status === 'PAID' ? 'INVOICE_PAID' : 'INVOICE_PARTIAL_PAID',
          changed_by: receivedBy,
          new_value: {
            payment_id: payment.id,
            payment_amount: fromPaise(parsed.amountPaise),
            payment_mode: parsed.mode,
            payment_date: parsed.date,
            transaction_reference: parsed.reference,
            paid_amount: fromPaise(newPaidPaise),
            balance_amount: fromPaise(totalPaise - newPaidPaise),
          },
        },
        {
          transaction,
        },
      );

      await transaction.commit();

      return {
        success: true,
        message: status === 'PAID' ? 'Payment recorded — the invoice is now paid in full' : 'Payment recorded',
        data: {
          invoice_id: invoice.id,
          payment_id: payment.id,
          paid_amount: fromPaise(newPaidPaise),
          balance_amount: fromPaise(totalPaise - newPaidPaise),
          status,
        },
      };
    } catch (error) {
      await transaction.rollback();

      this.logger.error(ctx, 'Add payment failed', error);

      throw error;
    }
  }

  async getInvoiceTimeline(invoiceId: number, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'getInvoiceTimeline', {
      invoiceId,
      companyId,
    });

    try {
      const invoice = await this.db.db.invoices.findOne({
        where: {
          id: invoiceId,
          company_id: companyId,
        },
        attributes: ['id'],
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const logs = await this.db.db.invoice_activity_logs.findAll({
        where: {
          invoice_id: invoiceId,
        },
        include: [
          {
            model: this.Users,
            as: 'changed_by_user',
            attributes: USER_ATTRS,
          },
        ],
        order: [
          ['created_at', 'DESC'],
          ['id', 'DESC'],
        ],
      });

      const timeline = logs.map((log: any) => ({
        id: log.id,
        invoice_id: log.invoice_id,
        action: log.action,
        old_value: log.old_value,
        new_value: log.new_value,
        changed_by: log.changed_by_user,
        created_at: log.created_at,
      }));

      return {
        success: true,
        message: 'Invoice timeline fetched successfully',
        data: timeline,
      };
    } catch (error) {
      this.logger.error(ctx, 'Get timeline failed', error);

      throw error;
    }
  }

  /**
   * Notes that the invoice was shared with the customer (by email, WhatsApp,
   * in person…). Nothing is emailed from here.
   */
  async sendInvoice(invoiceId: number, userId: number, companyId: number) {
    const ctx = new LogContext('InvoiceService', 'sendInvoice', {
      invoiceId,
      userId,
      companyId,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      const invoice = await this.db.db.invoices.findOne({
        where: {
          id: invoiceId,
          company_id: companyId,
        },
        transaction,
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      if (DEAD_STATUSES.includes(invoice.status)) {
        throw new BadRequestException('A cancelled invoice cannot be sent');
      }

      if (invoice.status === 'DRAFT') {
        await invoice.update(
          {
            status: 'SENT',
          },
          { transaction },
        );
      }

      const log = await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: 'INVOICE_SENT',
          changed_by: userId,
          new_value: {
            invoice_number: invoice.invoice_number,
          },
        },
        { transaction },
      );

      await transaction.commit();

      return {
        success: true,
        message: `${invoice.invoice_number} marked as sent`,
        data: { id: invoice.id, last_sent_at: log.created_at || new Date() },
      };
    } catch (error) {
      await transaction.rollback();

      this.logger.error(ctx, 'Send invoice failed', error);

      throw error;
    }
  }

  private validateAddress = (address: any) => {
    if (!address) {
      return false;
    }

    let parsed: any = address;
    try {
      while (typeof parsed === 'string') parsed = JSON.parse(parsed);
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object') return false;

    const requiredFields = [
      'address_line_1',
      'city',
      'state',
      'country',
      'postal_code',
    ];

    return requiredFields.every(
      (field) =>
        parsed[field] !== null &&
        parsed[field] !== undefined &&
        String(parsed[field]).trim() !== '',
    );
  };
}
