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
   * Approved quotations that can become invoices: approved, not invoiced yet,
   * newest first. Says up front whether the addresses are complete, because
   * an invoice can't be made without them.
   */
  async eligibleQuotations(companyId: number, searchRaw: unknown) {
    const ctx = new LogContext('InvoiceService', 'eligibleQuotations', { companyId });
    try {
      const search = typeof searchRaw === 'string' ? searchRaw.trim().slice(0, 100) : '';
      const where = `q.company_id = :c AND q.status = 'APPROVED' AND COALESCE(q.has_invoice, 0) = 0
        AND COALESCE(q.document_type, 'QT') = 'QT'
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id)
        ${search ? 'AND (q.quotation_number LIKE :s OR q.customer_name LIKE :s OR q.contact_person_name LIKE :s)' : ''}`;
      const replacements = { c: companyId, s: `%${search}%` };
      const [list, totalRows] = await Promise.all([
        this.db.sequelize.query(
          `SELECT q.id, q.quotation_number, q.customer_id, q.customer_name, q.contact_person_name,
                  DATE_FORMAT(COALESCE(q.quotation_date, DATE(q.created_at)), '%Y-%m-%d') AS quotation_date,
                  DATE_FORMAT(q.validity_date, '%Y-%m-%d') AS validity_date,
                  q.grand_total, q.cgst_amount, q.sgst_amount, q.igst_amount,
                  q.billing_address_snapshot, q.shipping_address_snapshot,
                  (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS items_count
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

  async generateInvoice(
    quotationId: number,
    body: GenrateInvoice,
    generatedBy: number,
    companyId: number,
  ) {
    const ctx = new LogContext('InvoiceService', 'generateInvoice', {
      quotationId,
      generatedBy,
      companyId,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      // Lock the quotation first: two clicks (or two people) must not make two
      // invoices from it.
      const locked = await this.db.db.quotations.findOne({
        where: { id: quotationId, company_id: companyId },
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const quotation = locked
        ? await this.db.db.quotations.findOne({
            where: {
              id: quotationId,
              company_id: companyId,
              status: 'APPROVED',
            },
            include: [
              {
                model: this.db.db.quotation_items,
                as: 'items',
              },
            ],
            transaction,
          })
        : null;

      if (!quotation) {
        throw new BadRequestException('Approved quotation not found');
      }
      if (!this.validateAddress(quotation.billing_address_snapshot)) {
        throw new BadRequestException(
          'Billing address is incomplete. Please update the quotation before generating invoice.',
        );
      }

      if (!this.validateAddress(quotation.shipping_address_snapshot)) {
        throw new BadRequestException(
          'Shipping address is incomplete. Please update the quotation before generating invoice.',
        );
      }

      const existingInvoice = await this.db.db.invoices.findOne({
        where: {
          quotation_id: quotation.id,
        },
        attributes: ['id'],
        transaction,
      });

      if (existingInvoice) {
        throw new BadRequestException('Invoice already generated');
      }

      const quotationDay =
        dateOnly(quotation.quotation_date) ||
        (quotation.created_at ? todayIn(new Date(quotation.created_at), DEFAULT_TZ_MINUTES) : null);
      const dates = parseInvoiceDates(body || {}, { today: this.businessToday(), quotationDate: quotationDay });
      if (!dates.ok) throw new BadRequestException(dates.message);

      const { invoiceNumber, dailySequence, overallSequence } =
        await this.nextInvoiceNumber(companyId, transaction, body?.series_id);

      const normalizeJson = (value: any) => {
        try {
          return typeof value === 'string' ? JSON.parse(value) : value;
        } catch {
          return value;
        }
      };

      quotation.billing_address_snapshot = normalizeJson(
        quotation.billing_address_snapshot,
      );

      quotation.shipping_address_snapshot = normalizeJson(
        quotation.shipping_address_snapshot,
      );

      quotation.business_details_snapshot = normalizeJson(
        quotation.business_details_snapshot,
      );

      quotation.payment_details_snapshot = normalizeJson(
        quotation.payment_details_snapshot,
      );

      const invoicePayload = InvoiceMapper.buildInvoicePayload(
        quotation,
        invoiceNumber,
        {
          dailySequence,
          overallSequence,
        },
        generatedBy,
        body,
      );
      invoicePayload.invoice_date = dates.invoiceDate as any;
      invoicePayload.due_date = dates.dueDate as any;

      const invoice = await this.db.db.invoices.create(invoicePayload, {
        transaction,
      });

      if (quotation.items && quotation.items.length) {
        const items = quotation.items.map((item: any) => ({
          invoice_id: invoice.id,
          quotation_item_id: item.id,
          product_name: item.product_name,
          description: item.description,
          hsn_code: item.hsn_code,
          qty: item.qty,
          unit: item.unit,
          rate: item.rate,
          discount_percent: item.discount_percent,
          discount_amount: item.discount_amount,
          discounted_rate: item.discounted_rate,
          total: item.total,
        }));

        await this.db.db.invoice_items.bulkCreate(items, {
          transaction,
        });
      }

      await this.db.db.invoice_activity_logs.create(
        {
          invoice_id: invoice.id,
          action: 'INVOICE_GENERATED',
          changed_by: generatedBy,
          new_value: {
            quotation_id: quotation.id,
            quotation_number: quotation.quotation_number,
            invoice_date: dates.invoiceDate,
            due_date: dates.dueDate,
          },
        },
        {
          transaction,
        },
      );

      await quotation.update(
        {
          has_invoice: true,
        },
        {
          transaction,
        },
      );

      await transaction.commit();

      return {
        success: true,
        message: `Invoice ${invoiceNumber} created`,
        data: invoice,
      };
    } catch (error) {
      await transaction.rollback();

      this.logger.error(ctx, 'Generate invoice failed', error);

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
