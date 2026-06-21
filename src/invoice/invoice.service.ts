import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { col, fn, Op, WhereOptions } from 'sequelize';
import { AppLogger } from 'src/common/logger/logger.service';
import { InvoiceMapper } from './mapper/invoice.mapper';
import { LogContext } from 'src/common/logger/logger.context';
import { InvoiceListDto } from './dto/invoiceList.dto';
import { invoicesAttributes, users } from 'src/models/init-models';
import { GenrateInvoice } from './dto/genrateInvoice.dto';

@Injectable()
export class InvoiceService {
  private readonly Users: typeof users;
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,

    private logger: AppLogger,
  ) {
    this.Users = this.db.db.users;
  }

  private buildSearchFilters(
    query: InvoiceListDto,
  ): WhereOptions<invoicesAttributes> {
    const conditions: WhereOptions<invoicesAttributes>[] = [];
    if (query.status) {
      conditions.push({
        status: query.status,
      });
    }

    if (query.search?.trim()) {
      conditions.push({
        [Op.or]: [
          {
            invoice_number: {
              [Op.like]: `%${query.search}%`,
            },
          },
          {
            status: {
              [Op.like]: `%${query.search}%`,
            },
          },
          {
            customer_name: {
              [Op.like]: `%${query.search}%`,
            },
          },
          {
            contact_person_name: {
              [Op.like]: `%${query.search}%`,
            },
          },
          {
            contact_person_email: {
              [Op.like]: `%${query.search}%`,
            },
          },
          {
            contact_person_phone: {
              [Op.like]: `%${query.search}%`,
            },
          },
        ],
      });
    }

    return conditions.length > 0 ? { [Op.and]: conditions } : {};
  }

  async generateInvoice(
    quotationId: number,
    body: GenrateInvoice,
    generatedBy: number,
  ) {
    const ctx = new LogContext('InvoiceService', 'generateInvoice', {
      quotationId,
      generatedBy,
    });

    const transaction = await this.db.sequelize.transaction();

    try {
      const quotation = await this.db.db.quotations.findOne({
        where: {
          id: quotationId,
          status: 'APPROVED',
        },
        include: [
          {
            model: this.db.db.quotation_items,
            as: 'items',
          },
        ],
      });

      if (!quotation) {
        throw new BadRequestException('Approved quotation not found');
      }
      if (!this.validateAddress(quotation.billing_address_snapshot)) {
        return {
          success: true,
          message:
            'Billing address is incomplete. Please update the quotation before generating invoice.',
          data: null,
        };
      }

      if (!this.validateAddress(quotation.shipping_address_snapshot)) {
        return {
          success: true,
          message:
            'Shipping address is incomplete. Please update the quotation before generating invoice.',
          data: null,
        };
      }

      const existingInvoice = await this.db.db.invoices.findOne({
        where: {
          quotation_id: quotation.id,
        },
      });

      if (existingInvoice) {
        throw new BadRequestException('Invoice already generated');
      }

      const today = new Date();

      const datePart =
        today.getFullYear().toString() +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');

      const count = await this.db.db.invoices.count();

      const overallSequence = count + 1;

      const dailySequence =
        (await this.db.db.invoices.count({
          where: {
            created_at: {
              [Op.gte]: new Date(today.setHours(0, 0, 0, 0)),
            },
          },
        })) + 1;

      const invoiceNumber = `INV-${datePart}-${String(dailySequence).padStart(
        4,
        '0',
      )}`;
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
        message: 'Invoice generated successfully',
        data: invoice,
      };
    } catch (error) {
      await transaction.rollback();

      this.logger.error(ctx, 'Generate invoice failed', error);

      throw error;
    }
  }

async listInvoices(query: any, companyId: number) {
  const ctx = new LogContext(
    'InvoiceService',
    'listInvoices',
    {
      companyId,
      query,
    },
  );

  try {
    const page = Number(query.page || 1);
    const limit = Number(query.limit || 10);
    const offset = (page - 1) * limit;

    const where: any = {
      company_id: companyId,
      ...this.buildSearchFilters(query),
    };

    // Invoice Dashboard Summary
    const invoiceSummary =
      await this.db.db.invoices.findAll({
        attributes: [
          'status',
          [
            fn('SUM', col('grand_total')),
            'grandTotal',
          ],
          [
            fn('SUM', col('paid_amount')),
            'paidAmount',
          ],
          [
            fn('SUM', col('balance_amount')),
            'balanceAmount',
          ],
          [fn('COUNT', col('id')), 'count'],
        ],
        where: {
          ...where,
          status: {
            [Op.in]: [
              'GENERATED',
              'PARTIAL_PAID',
              'PAID',
            ],
          },
        },
        group: ['status'],
        raw: true,
      });

    const paymentDetails = {
      GENERATED: {
        count: 0,
        grandTotal: 0,
        paidAmount: 0,
        balanceAmount: 0,
      },
      PARTIAL_PAID: {
        count: 0,
        grandTotal: 0,
        paidAmount: 0,
        balanceAmount: 0,
      },
      PAID: {
        count: 0,
        grandTotal: 0,
        paidAmount: 0,
        balanceAmount: 0,
      },
    };

    invoiceSummary.forEach((item: any) => {
      paymentDetails[item.status] = {
        count: Number(item.count || 0),
        grandTotal: Number(
          item.grandTotal || 0,
        ),
        paidAmount: Number(
          item.paidAmount || 0,
        ),
        balanceAmount: Number(
          item.balanceAmount || 0,
        ),
      };
    });

    const { rows, count } =
      await this.db.db.invoices.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
      });

    return {
      success: true,
      message:
        'Invoices fetched successfully',
      data: {
        rows,

        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(count / limit),
        },

        paymentDetails,
      },
    };
  } catch (error) {
    this.logger.error(
      ctx,
      'List invoice failed',
      error,
    );

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
          },

          {
            model: this.db.db.invoice_activity_logs,
            as: 'activity_logs',
            required: false,
          },
        ],
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      return {
        success: true,
        message: 'Invoice details fetched successfully',

        data: invoice,
      };
    } catch (error) {
      this.logger.error(ctx, 'Get invoice details failed', error);

      throw error;
    }
  }

  async addPayment(invoiceId: number, payload: any, companyId: number) {
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
      });

      if (!invoice) {
        throw new BadRequestException('Invoice not found');
      }

      const invoiceTotal = Number(invoice.grand_total || 0);

      const alreadyPaid = Number(invoice.paid_amount || 0);

      const paymentAmount = Number(payload.amount || 0);

      if (paymentAmount <= 0) {
        throw new BadRequestException(
          'Payment amount must be greater than zero',
        );
      }

      const newTotalPaid = alreadyPaid + paymentAmount;

      if (newTotalPaid > invoiceTotal) {
        return {
          success: true,
          message: `Payment exceeds invoice amount. Remaining balance is ₹${invoiceTotal - alreadyPaid}`,
          data: null,
        };
      }

      await this.db.db.invoice_payments.create(
        {
          invoice_id: invoice.id,

          payment_date: payload.payment_date || new Date(),

          payment_amount: paymentAmount,

          payment_mode: payload.payment_mode,

          transaction_reference: payload.transaction_reference,

          remarks: payload.notes,

          received_by: payload.received_by,
        },
        {
          transaction,
        },
      );

      let status = invoice.status || 'GENERATED';

      if (newTotalPaid > 0 && newTotalPaid < invoiceTotal) {
        status = 'PARTIAL_PAID';
      }

      if (newTotalPaid >= invoiceTotal) {
        status = 'PAID';
      }

      await invoice.update(
        {
          paid_amount: newTotalPaid,

          balance_amount: invoiceTotal - newTotalPaid,

          status,
        },
        {
          transaction,
        },
      );

      if (status === 'PARTIAL_PAID') {
        await this.db.db.invoice_activity_logs.create(
          {
            invoice_id: invoice.id,

            action: 'INVOICE_PARTIAL_PAID',

            changed_by: payload.received_by,

            new_value: {
              payment_amount: paymentAmount,

              payment_mode: payload.payment_mode,

              transaction_reference: payload.transaction_reference,
            },
          },
          {
            transaction,
          },
        );
      }

      if (status === 'PAID') {
        await this.db.db.invoice_activity_logs.create(
          {
            invoice_id: invoice.id,

            action: 'INVOICE_PAID',

            changed_by: payload.received_by,

            new_value: {
              payment_amount: paymentAmount,

              payment_mode: payload.payment_mode,

              transaction_reference: payload.transaction_reference,
            },
          },
          {
            transaction,
          },
        );
      }

      await transaction.commit();

      return {
        success: true,
        message: 'Payment recorded successfully',
        data: {
          invoice_id: invoice.id,
          paid_amount: newTotalPaid,
          balance_amount: invoiceTotal - newTotalPaid,
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
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
        order: [['created_at', 'DESC']],
      });

      const timeline = logs.map((log: any) => ({
        id: log.id,

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

      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException('Cancelled invoice cannot be sent');
      }

      if (invoice.status === 'DRAFT') {
        await invoice.update(
          {
            status: 'SENT',
          },
          { transaction },
        );
      }

      await this.db.db.invoice_activity_logs.create(
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
        message: 'Invoice sent successfully',
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

    const parsed = typeof address === 'string' ? JSON.parse(address) : address;

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
