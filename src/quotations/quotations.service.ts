import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  Op,
  QueryTypes,
  Transaction,
  WhereOptions,
  Includeable,
} from 'sequelize';

import { AppLogger } from '../common/logger/logger.service';
import { DocumentType } from '../common/enums/document-type.enum';
import { generateDocumentNumber } from '../common/utils/document-number.util';
import {
  quotations,
  quotationsAttributes,
  quotationsCreationAttributes,
} from '../models/quotations';
import { quotation_items } from '../models/quotation-items';
import { quotation_versions } from '../models/quotation-versions';
import { customers } from '../models/customers';
import { companies } from '../models/companies';
import { users } from '../models/users';

import { CreateQuotationDto } from './dto/createQuotation.dto';
import { UpdateQuotationDto } from './dto/updateQuotation.dto';
import { QuotationsListDto } from './dto/quotationsList.dto';
import { QuotationItemDto } from './dto/quotationItems.dto';
import { QuotationMapper } from './quotation.mapper';
import { IServiceResponse } from './api-response.interface';
import { quotation_activity_logs } from '../models/quotation-activity-logs';
import { customer_contacts } from '../models/customer_contacts';
import { customer_addresses } from '../models/customer_addresses';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';

@Injectable()
export class QuotationService {
  private readonly Quotations: typeof quotations;
  private readonly QuotationItems: typeof quotation_items;
  private readonly QuotationVersions: typeof quotation_versions;
  private readonly QuotationActivityLogs: typeof quotation_activity_logs;
  private readonly Customers: typeof customers;
  private readonly Companies: typeof companies;
  private readonly Users: typeof users;
  private readonly CustomerContacts: typeof customer_contacts;
  private readonly CustomerAddresses: typeof customer_addresses;

  constructor(
    @Inject('DATABASE_CONNECTION')
    private dbProvider: any,

    private readonly appLogger: AppLogger,
  ) {
    this.Quotations = this.dbProvider.db.quotations;
    this.QuotationItems = this.dbProvider.db.quotation_items;
    this.QuotationVersions = this.dbProvider.db.quotation_versions;
    this.QuotationActivityLogs = this.dbProvider.db.quotation_activity_logs;
    this.Customers = this.dbProvider.db.customers;
    this.Companies = this.dbProvider.db.companies;
    this.Users = this.dbProvider.db.users;
    this.CustomerContacts = this.dbProvider.db.customer_contacts;
    this.CustomerAddresses = this.dbProvider.db.customer_addresses;
  }

  private getLog(operation: string, meta: Record<string, unknown> = {}) {
    return this.appLogger.forContext('QuotationService', operation, meta);
  }

  private buildSearchFilters(
    query: QuotationsListDto,
  ): WhereOptions<quotationsAttributes> {
    const conditions: WhereOptions<quotationsAttributes>[] = [];
    if (query.status) {
      conditions.push({
        status: query.status,
        has_invoice: false,
      });
    }

    if (query.search?.trim()) {
      conditions.push({
        [Op.or]: [
          {
            quotation_number: {
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

  private buildQuotationIncludeRelations(): Includeable[] {
    return [
      {
        model: this.QuotationItems,
        as: 'items',
      },

      {
        model: this.Customers,
        as: 'customer',

        attributes: [
          'id',
          'customer_type',
          'display_name',
          'company_name',
          'gst_number',
          'website',
          'industry',
          'notes',
        ],

        include: [
          {
            model: this.CustomerContacts,
            as: 'contacts',

            where: {
              is_active: 1,
            },

            required: false,

            attributes: [
              'id',
              'first_name',
              'last_name',
              'email',
              'phone',
              'department',
              'designation',
              'is_primary',
            ],
          },

          {
            model: this.CustomerAddresses,
            as: 'addresses',

            where: {
              is_active: 1,
            },

            required: false,

            attributes: [
              'id',
              'address_type',
              'label',
              'gst_number',
              'address_line_1',
              'address_line_2',
              'city',
              'state',
              'country',
              'postal_code',
              'is_primary',
            ],
          },
        ],
      },

      {
        model: this.Users,
        as: 'created_by_user',

        attributes: ['id', 'first_name', 'last_name', 'email'],
      },

      {
        model: this.Users,
        as: 'updated_by_user',

        attributes: ['id', 'first_name', 'last_name', 'email'],
      },
    ];
  }

  private buildQuotationDetailIncludes(): Includeable[] {
    return [
      ...this.buildQuotationIncludeRelations(),
      {
        model: this.QuotationVersions,
        as: 'versions',
        include: [
          {
            model: this.Users,
            as: 'changed_by_user',
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
      },
    ];
  }

  private buildItemPayloads(
    items: QuotationItemDto[],
    quotationId: number,
  ): Array<{
    quotation_id: number;
    product_name: string;
    description?: string;
    hsn_code?: string;
    unit?: string;
    qty?: number;
    rate?: number;
    discount_percent?: number;
    discount_amount?: number;
    discounted_rate?: number;
    total: number;
  }> {
    return items.map((item) => {
      const lineSubtotal = Number((item.qty || 0) * (item.rate || 0));
      const lineDiscount = Number(
        ((item.discount_percent ?? 0) / 100) * lineSubtotal,
      );
      const discountedLineTotal = Number(lineSubtotal - lineDiscount);
      const discountedRate =
        item.qty && item.qty > 0 ? discountedLineTotal / item.qty : 0;

      return {
        quotation_id: quotationId,
        product_name: item.product_name,
        description: item.description,
        hsn_code: item.hsn_code,
        unit: item.unit,
        qty: item.qty,
        rate: item.rate,
        discount_percent: item.discount_percent,
        discount_amount: Number(lineDiscount.toFixed(2)),
        discounted_rate: Number(discountedRate.toFixed(2)),
        total: Number(discountedLineTotal.toFixed(2)),
      };
    });
  }

  // Compute totals for a quotation from its items and overall adjustments.
  private computeTotalsFromItems(
    items: QuotationItemDto[],
    overallDiscount: number | undefined,
    transportCharges: number | undefined,
    cgstPercent?: number,
    sgstPercent?: number,
    igstPercent?: number,
  ) {
    const subTotal = items.reduce((sum, item) => {
      return sum + (item.qty || 0) * (item.rate || 0);
    }, 0);

    const itemDiscountTotal = items.reduce((sum, item) => {
      const lineSubtotal = (item.qty || 0) * (item.rate || 0);
      return sum + ((item.discount_percent ?? 0) / 100) * lineSubtotal;
    }, 0);

    const overallDisc = Number(overallDiscount ?? 0);
    const transport = Number(transportCharges ?? 0);
    const cgstPct = Number(cgstPercent ?? 0);
    const sgstPct = Number(sgstPercent ?? 0);
    const igstPct = Number(igstPercent ?? 0);

    const totalDiscount = Number((itemDiscountTotal + overallDisc).toFixed(2));
    const discountPercent = subTotal > 0 ? (totalDiscount / subTotal) * 100 : 0;
    const taxableAmount = Number((subTotal - totalDiscount).toFixed(2));

    const cgstAmount = Number(((taxableAmount * cgstPct) / 100).toFixed(2));
    const sgstAmount = Number(((taxableAmount * sgstPct) / 100).toFixed(2));
    const igstAmount = Number(((taxableAmount * igstPct) / 100).toFixed(2));
    const taxTotal = Number((cgstAmount + sgstAmount + igstAmount).toFixed(2));

    const grandTotal = Number(
      (taxableAmount + taxTotal + transport).toFixed(2),
    );

    return {
      sub_total: Number(subTotal.toFixed(2)),
      discount_percent: Number(discountPercent.toFixed(2)),
      discount_amount: totalDiscount,
      cgst_percent: cgstPct,
      cgst_amount: cgstAmount,
      sgst_percent: sgstPct,
      sgst_amount: sgstAmount,
      igst_percent: igstPct,
      igst_amount: igstAmount,
      transport_charges: transport,
      grand_total: grandTotal,
    };
  }

  private buildCreateQuotationPayload(
    data: CreateQuotationDto,
  ): quotationsCreationAttributes {
    // compute totals from items to avoid trusting client calculations
    const totals = this.computeTotalsFromItems(
      data.items || [],
      data.discount_amount,
      data.transport_charges,
      data.cgst_percent,
      data.sgst_percent,
      data.igst_percent,
    );

    return {
      company_id: data.company_id,
      quotation_number: data.quotation_number || '',
      document_type: data.document_type || DocumentType.QUOTATION,
      daily_sequence: data.daily_sequence,
      overall_sequence: data.overall_sequence,
      customer_id: data.customer_id,
      quotation_date: data.quotation_date
        ? new Date(data.quotation_date)
        : undefined,
      validity_date: data.validity_date
        ? new Date(data.validity_date)
        : undefined,
      status: 'DRAFT',
      sub_total: totals.sub_total,
      discount_percent: totals.discount_percent,
      discount_amount: totals.discount_amount,
      cgst_percent: totals.cgst_percent,
      cgst_amount: totals.cgst_amount,
      sgst_percent: totals.sgst_percent,
      sgst_amount: totals.sgst_amount,
      igst_percent: totals.igst_percent,
      igst_amount: totals.igst_amount,
      transport_charges: totals.transport_charges,
      grand_total: totals.grand_total,
      notes: data.notes,
      terms_conditions: data.terms_conditions,
      place_of_supply_state_id: data.place_of_supply_state_id,
      created_by: data.user_id,
      updated_by: data.user_id,
      contact_person_id: data.contact_person_id,
      billing_address_id: data.billing_address_id,
      shipping_address_id: data.shipping_address_id,
      customer_name: data.customer_name,
      customer_type: data.customer_type as 'INDIVIDUAL' | 'BUSINESS',
      customer_gst_number: data.customer_gst_number,
      contact_person_name: data.contact_person_name,
      contact_person_email: data.contact_person_email,
      contact_person_phone: data.contact_person_phone,
      billing_address_snapshot: data.billing_address_snapshot,
      shipping_address_snapshot: data.shipping_address_snapshot,
      business_details_snapshot: data.business_details_snapshot,
      payment_details_snapshot: (() => {
        if (
          data.payment_details_snapshot === undefined ||
          data.payment_details_snapshot === null
        ) {
          return undefined;
        }

        if (typeof data.payment_details_snapshot === 'string') {
          try {
            return JSON.parse(data.payment_details_snapshot);
          } catch {
            return data.payment_details_snapshot;
          }
        }

        return data.payment_details_snapshot;
      })(),
    };
  }

  private async generateQuotationNumber(
    companyId: number,
    transaction?: Transaction,
  ): Promise<{
    quotationNumber: string;
    dailySequence: number;
    overallSequence: number;
  }> {
    const company = await this.Companies.findByPk(companyId, {
      transaction,
      lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });

    if (!company) {
      throw new Error(`Company not found for id=${companyId}`);
    }

    const companyPrefix =
      company.company_prefix?.trim().toUpperCase() ||
      company.name?.trim().substring(0, 4).toUpperCase() ||
      'COMP';

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [dailyResult] = await this.dbProvider.sequelize.query(
      `SELECT COUNT(*) AS daily_count
       FROM quotations
       WHERE company_id = :companyId
         AND document_type = :documentType
         AND created_at >= :todayStart
         AND created_at < :tomorrowStart
       FOR UPDATE`,
      {
        replacements: {
          companyId,
          documentType: DocumentType.QUOTATION,
          todayStart,
          tomorrowStart,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    const dailySequence = Number((dailyResult as any).daily_count || 0) + 1;

    const [overallResult] = await this.dbProvider.sequelize.query(
      `SELECT COALESCE(MAX(overall_sequence), 0) AS max_overall
       FROM quotations
       WHERE company_id = :companyId
         AND document_type = :documentType
       FOR UPDATE`,
      {
        replacements: {
          companyId,
          documentType: DocumentType.QUOTATION,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    const overallSequence = Number((overallResult as any).max_overall || 0) + 1;
    const quotationNumber = generateDocumentNumber(
      DocumentType.QUOTATION,
      companyPrefix,
      dailySequence,
      overallSequence,
    );

    return {
      quotationNumber,
      dailySequence,
      overallSequence,
    };
  }

  private async createVersionSnapshot(
    quotation: quotations,
    actionType: string,
    changedBy: number | undefined,
    transaction: Transaction,
  ) {
    const quotationItems = await this.QuotationItems.findAll({
      where: { quotation_id: quotation.id },
      transaction,
    });

    return this.QuotationVersions.create(
      {
        quotation_id: quotation.id,
        version_number: quotation.version_number || 1,
        quotation_snapshot: {
          quotation: quotation.toJSON(),
          items: quotationItems.map((item) => item.toJSON()),
        },
        action_type: actionType,
        changed_by: changedBy,
      },
      { transaction },
    );
  }

  private async createActivityLog(
    quotationId: number,
    action: string,
    oldValue: object | null | undefined,
    newValue: object | null | undefined,
    changedBy: number | undefined,
    transaction: Transaction,
  ) {
    return this.QuotationActivityLogs.create(
      {
        quotation_id: quotationId,
        action,
        old_value: oldValue ?? undefined,
        new_value: newValue ?? undefined,
        changed_by: changedBy,
      },
      { transaction },
    );
  }

  private async fetchQuotationById(
    id: number,
    transaction?: Transaction,
  ): Promise<quotations | null> {
    return this.Quotations.findByPk(id, {
      include: this.buildQuotationDetailIncludes(),
      transaction,
    });
  }

  async getQuotations(
    query: QuotationsListDto,
    currentUser: {
      company_id: number;
      user_id: number;
    },
  ): Promise<IServiceResponse> {
    const log = this.getLog('getQuotations');

    log.info('Fetching quotations list', {
      companyId: currentUser.company_id,
      filters: query,
    });

    try {
      // =========================================
      // PAGINATION
      // =========================================

      const page = Number(query.page) > 0 ? Number(query.page) : 1;

      const limit =
        Number(query.limit) > 0 && Number(query.limit) <= 100
          ? Number(query.limit)
          : 10;

      const offset = (page - 1) * limit;

      // =========================================
      // SEARCH FILTERS
      // =========================================

      const whereClause: any = {
        company_id: currentUser.company_id,

        ...this.buildSearchFilters(query),
      };

      log.debug('Executing quotation query', {
        page,
        limit,
        offset,
        whereClause,
      });

      // =========================================
      // QUERY
      // =========================================

      // Keep customer include only for display purposes; filtering is snapshot-driven on quotations.
      const includeRelations = this.buildQuotationIncludeRelations();

      const [statusCounts, result] = await Promise.all([
        this.Quotations.findAll({
          attributes: [
            'status',
            [
              this.dbProvider.sequelize.fn(
                'COUNT',
                this.dbProvider.sequelize.col('id'),
              ),
              'count',
            ],
          ],

          where: {
            company_id: currentUser.company_id,
          },

          group: ['status'],

          raw: true,
        }),
        this.Quotations.findAndCountAll({
          where: whereClause,

          include: includeRelations,

          distinct: true,

          order: [['created_at', 'DESC']],

          limit,

          offset,
        }),
      ]);

      const statusSummary = {
        DRAFT: 0,
        SENT: 0,
        APPROVED: 0,
        REJECTED: 0,
        EXPIRED: 0,
        INVOICED: 0,
      };

      statusCounts.forEach((item: any) => {
        statusSummary[item.status] = Number(item.count);
      });

      const total = Number(result.count) || 0;

      const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

      log.info('Quotations fetched successfully', {
        total,
        fetched: result.rows.length,
        page,
        totalPages,
      });

      return {
        success: true,

        message: 'Quotations fetched successfully',

        data: {
          rows: result.rows,
          statusCounts: statusSummary,
          pagination: {
            total,

            page,

            limit,

            totalPages,

            hasNextPage: page < totalPages,

            hasPrevPage: page > 1,
          },
        },
      };
    } catch (error) {
      log.error('Failed to fetch quotations', error as Error);

      return {
        success: false,

        message: 'Failed to fetch quotations',

        data: {
          rows: [],

          pagination: {
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        },
      };
    }
  }

  async getQuotationsListForInvoice(
    query: QuotationsListDto,
    currentUser: {
      company_id: number;
      user_id: number;
    },
  ): Promise<IServiceResponse> {
    const log = this.getLog('getQuotationsListForInvoice');

    log.info('Fetching quotations list', {
      companyId: currentUser.company_id,
      filters: query,
    });

    try {
      // =========================================
      // PAGINATION
      // =========================================

      const page = Number(query.page) > 0 ? Number(query.page) : 1;

      const limit =
        Number(query.limit) > 0 && Number(query.limit) <= 100
          ? Number(query.limit)
          : 10;

      const offset = (page - 1) * limit;

      // =========================================
      // SEARCH FILTERS
      // =========================================

      const whereClause: any = {
        company_id: currentUser.company_id,

        ...this.buildSearchFilters(query),
      };

      log.debug('Executing quotation query', {
        page,
        limit,
        offset,
        whereClause,
      });

      // =========================================
      // QUERY
      // =========================================

      // Keep customer include only for display purposes; filtering is snapshot-driven on quotations.
      const includeRelations = this.buildQuotationIncludeRelations();

      const result = await this.Quotations.findAndCountAll({
        where: whereClause,

        include: includeRelations,

        distinct: true,

        order: [['created_at', 'DESC']],

        limit,

        offset,
      });

      const total = Number(result.count) || 0;

      const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

      log.info('Quotations fetched successfully', {
        total,
        fetched: result.rows.length,
        page,
        totalPages,
      });

      return {
        success: true,

        message: 'Quotations fetched successfully',

        data: {
          rows: result.rows,

          pagination: {
            total,

            page,

            limit,

            totalPages,

            hasNextPage: page < totalPages,

            hasPrevPage: page > 1,
          },
        },
      };
    } catch (error) {
      log.error('Failed to fetch quotations', error as Error);

      return {
        success: false,

        message: 'Failed to fetch quotations',

        data: {
          rows: [],

          pagination: {
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        },
      };
    }
  }

  async createQuotation(data: CreateQuotationDto): Promise<IServiceResponse> {
    const log = this.getLog('createQuotation', {
      customerId: data.customer_id,
      companyId: data.company_id,
    });
    log.info('Creating quotation');

    const transaction = await this.dbProvider.sequelize.transaction();

    try {
      const customer = await this.Customers.findByPk(data.customer_id, {
        include: [
          {
            model: this.CustomerContacts,
            as: 'contacts',
          },
          {
            model: this.CustomerAddresses,
            as: 'addresses',
          },
        ],
      });

      if (!customer) {
        await transaction.rollback();
        return {
          success: false,
          message: `Customer with id ${data.customer_id} not found`,
          data: null,
        };
      }
      const selectedContact = (customer as any).contacts.find(
        (c) => c.id === data.contact_person_id,
      );

      const billingAddress = (customer as any).addresses.find(
        (a) => a.id === data.billing_address_id,
      );

      const shippingAddress = (customer as any).addresses.find(
        (a) => a.id === data.shipping_address_id,
      );

      data.customer_name = customer.display_name;

      data.customer_type = customer.customer_type;

      data.customer_gst_number = customer.gst_number;

      data.contact_person_name = selectedContact
        ? `${selectedContact.first_name} ${selectedContact.last_name}`
        : undefined;

      data.contact_person_email = selectedContact?.email;

      data.contact_person_phone = selectedContact?.phone;

      data.billing_address_snapshot = billingAddress;

      data.shipping_address_snapshot = shippingAddress;

      const numberInfo = await this.generateQuotationNumber(
        data.company_id,
        transaction,
      );

      data.quotation_number = numberInfo.quotationNumber;
      data.document_type = DocumentType.QUOTATION;
      data.daily_sequence = numberInfo.dailySequence;
      data.overall_sequence = numberInfo.overallSequence;

      const quotationPayload = this.buildCreateQuotationPayload(data);
      const quotation = await this.Quotations.create(quotationPayload, {
        transaction,
      });

      if (data.items?.length) {
        const itemsPayload = this.buildItemPayloads(data.items, quotation.id);

        await this.QuotationItems.bulkCreate(itemsPayload, {
          transaction,
        });
      }

      await this.createVersionSnapshot(
        quotation,
        'CREATED',
        data.user_id,
        transaction,
      );

      const createdQuotation = await this.fetchQuotationById(
        quotation.id,
        transaction,
      );

      await this.createActivityLog(
        quotation.id,
        'CREATED',
        null,
        createdQuotation ? createdQuotation.toJSON() : null,
        data.user_id,
        transaction,
      );

      await transaction.commit();

      log.info('Quotation created successfully', {
        quotationId: quotation.id,
      });

      return {
        success: true,
        message: 'Quotation created successfully',
        data: createdQuotation,
      };
    } catch (error: unknown) {
      await transaction.rollback();
      log.error('Failed to create quotation', error as Error);

      return {
        success: false,
        message: 'Failed to create quotation',
        data: null,
      };
    }
  }

  async updateQuotation(
    id: number,
    data: UpdateQuotationDto,
  ): Promise<IServiceResponse> {
    const log = this.getLog('updateQuotation', {
      quotationId: id,
    });
    log.info('Updating quotation');

    const transaction = await this.dbProvider.sequelize.transaction();

    if (
      data.validity_date &&
      new Date(data.validity_date) < new Date(new Date().setHours(0, 0, 0, 0))
    ) {
      return {
        success: true,
        message: 'Validity date must be a future date',
        data: null,
      };
    }

    try {
      const quotation = await this.Quotations.findByPk(id, {
        include: [
          {
            model: this.QuotationItems,
            as: 'items',
          },
        ],
        transaction,
      });

      if (!quotation) {
        await transaction.rollback();
        log.warn('Quotation not found', { quotationId: id });

        return {
          success: false,
          message: 'Quotation not found',
          data: null,
        };
      }

      const currentVersion = Number(quotation.version_number || 1);
      const changedBy = data.user_id ?? quotation.updated_by;
      const oldSnapshot = quotation.toJSON();

      await this.QuotationVersions.create(
        {
          quotation_id: quotation.id,
          version_number: currentVersion,
          quotation_snapshot: oldSnapshot,
          action_type: 'UPDATED',
          changed_by: changedBy,
        },
        { transaction },
      );

      const updatePayload = QuotationMapper.buildUpdatePayload(
        data,
        currentVersion,
      );

      const shouldRecalcTotals = Boolean(
        (data.items && data.items.length > 0) ||
        data.discount_amount !== undefined ||
        data.transport_charges !== undefined ||
        data.cgst_percent !== undefined ||
        data.sgst_percent !== undefined ||
        data.igst_percent !== undefined,
      );

      if (shouldRecalcTotals) {
        const itemsToRecalc =
          data.items && data.items.length > 0
            ? data.items
            : ((quotation as any).items || []).map((item: any) => ({
                product_name: item.product_name,
                qty: item.qty,
                rate: item.rate,
                discount_percent: item.discount_percent,
              }));

        const totals = this.computeTotalsFromItems(
          itemsToRecalc,
          data.discount_amount !== undefined
            ? data.discount_amount
            : quotation.discount_amount,
          data.transport_charges !== undefined
            ? data.transport_charges
            : quotation.transport_charges,
          data.cgst_percent !== undefined
            ? data.cgst_percent
            : quotation.cgst_percent,
          data.sgst_percent !== undefined
            ? data.sgst_percent
            : quotation.sgst_percent,
          data.igst_percent !== undefined
            ? data.igst_percent
            : quotation.igst_percent,
        );

        Object.assign(updatePayload, {
          sub_total: totals.sub_total,
          discount_percent: totals.discount_percent,
          discount_amount: totals.discount_amount,
          cgst_percent: totals.cgst_percent,
          cgst_amount: totals.cgst_amount,
          sgst_percent: totals.sgst_percent,
          sgst_amount: totals.sgst_amount,
          igst_percent: totals.igst_percent,
          igst_amount: totals.igst_amount,
          transport_charges: totals.transport_charges,
          grand_total: totals.grand_total,
          status: 'DRAFT', // Reset to DRAFT on any change that affects totals
        });
      }

      await quotation.update(updatePayload, { transaction });

      await this.QuotationItems.destroy({
        where: { quotation_id: quotation.id },
        transaction,
      });

      if (data.items?.length) {
        const itemsPayload = this.buildItemPayloads(data.items, quotation.id);

        await this.QuotationItems.bulkCreate(itemsPayload, {
          transaction,
        });
      }

      const updatedQuotation = await this.fetchQuotationById(
        quotation.id,
        transaction,
      );

      await this.createActivityLog(
        quotation.id,
        'UPDATED',
        oldSnapshot,
        updatedQuotation ? updatedQuotation.toJSON() : null,
        changedBy,
        transaction,
      );

      await transaction.commit();

      log.info('Quotation updated successfully', {
        quotationId: quotation.id,
      });

      return {
        success: true,
        message: 'Quotation updated successfully',
        data: updatedQuotation,
      };
    } catch (error: unknown) {
      await transaction.rollback();
      log.error('Failed to update quotation', error as Error);

      return {
        success: false,
        message: 'Failed to update quotation',
        data: null,
      };
    }
  }

  async getQuotationDetails(id: number): Promise<IServiceResponse> {
    const log = this.getLog('getQuotationDetails', { quotationId: id });
    log.info('Fetching quotation details');

    try {
      const quotation = await this.fetchQuotationById(id);

      if (!quotation) {
        log.warn('Quotation not found', { quotationId: id });

        return {
          success: false,
          message: 'Quotation not found',
          data: null,
        };
      }

      return {
        success: true,
        message: 'Quotation fetched successfully',
        data: quotation,
      };
    } catch (error: unknown) {
      log.error('Failed to fetch quotation details', error as Error);

      return {
        success: false,
        message: 'Failed to fetch quotation details',
        data: null,
      };
    }
  }

  async getQuotationHistory(id: number): Promise<IServiceResponse> {
    const log = this.getLog('getQuotationHistory', { quotationId: id });
    log.info('Fetching quotation history');

    try {
      const history = await this.QuotationVersions.findAll({
        where: {
          quotation_id: id,
        },
        order: [['version_number', 'DESC']],
        include: [
          {
            model: this.Users,
            as: 'changed_by_user',
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
      });

      return {
        success: true,
        message: 'Quotation history fetched successfully',
        data: history,
      };
    } catch (error: unknown) {
      log.error('Failed to fetch quotation history', error as Error);

      return {
        success: false,
        message: 'Failed to fetch quotation history',
        data: null,
      };
    }
  }

  async getQuotationTimeline(id: number): Promise<IServiceResponse> {
    const log = this.getLog('getQuotationTimeline', { quotationId: id });
    log.info('Fetching quotation timeline');

    try {
      const timeline = await this.QuotationVersions.findAll({
        where: {
          quotation_id: id,
        },
        attributes: [
          'id',
          'version_number',
          'action_type',
          'changed_by',
          'created_at',
        ],
        include: [
          {
            model: this.Users,
            as: 'changed_by_user',
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
        order: [['created_at', 'DESC']],
      });

      return {
        success: true,
        message: 'Quotation timeline fetched successfully',
        data: timeline,
      };
    } catch (error: unknown) {
      log.error('Failed to fetch quotation timeline', error as Error);

      return {
        success: false,
        message: 'Failed to fetch quotation timeline',
        data: null,
      };
    }
  }

  async sendQuotation(id: number, userId?: number): Promise<IServiceResponse> {
    const log = this.getLog('sendQuotation', { quotationId: id });
    log.info('Sending quotation');

    const transaction = await this.dbProvider.sequelize.transaction();

    try {
      const quotation = await this.Quotations.findByPk(id, {
        transaction,
      });

      if (!quotation) {
        await transaction.rollback();
        log.warn('Quotation not found', { quotationId: id });

        return {
          success: false,
          message: 'Quotation not found',
          data: null,
        };
      }

      const currentVersion = Number(quotation.version_number || 1);
      const changedBy = userId ?? quotation.updated_by;

      await this.QuotationVersions.create(
        {
          quotation_id: quotation.id,
          version_number: currentVersion,
          quotation_snapshot: quotation.toJSON(),
          action_type: 'SENT',
          changed_by: changedBy,
        },
        { transaction },
      );

      await quotation.update(
        {
          status: 'SENT',
          version_number: currentVersion + 1,
          updated_by: changedBy,
        },
        { transaction },
      );

      const updatedQuotation = await this.fetchQuotationById(
        quotation.id,
        transaction,
      );

      await this.createActivityLog(
        quotation.id,
        'SENT',
        quotation.toJSON(),
        updatedQuotation ? updatedQuotation.toJSON() : null,
        changedBy,
        transaction,
      );

      await transaction.commit();

      log.info('Quotation sent successfully', {
        quotationId: quotation.id,
      });

      return {
        success: true,
        message: 'Quotation sent successfully',
        data: updatedQuotation,
      };
    } catch (error: unknown) {
      await transaction.rollback();
      log.error('Failed to send quotation', error as Error);

      return {
        success: false,
        message: 'Failed to send quotation',
        data: null,
      };
    }
  }

  async approveQuotation(
    id: number,
    userId?: number,
  ): Promise<IServiceResponse> {
    const log = this.getLog('approveQuotation', { quotationId: id });
    log.info('Approving quotation');

    const transaction = await this.dbProvider.sequelize.transaction();

    try {
      const quotation = await this.Quotations.findByPk(id, {
        transaction,
      });

      if (!quotation) {
        await transaction.rollback();
        log.warn('Quotation not found', { quotationId: id });

        return {
          success: false,
          message: 'Quotation not found',
          data: null,
        };
      }

      const currentVersion = Number(quotation.version_number || 1);
      const changedBy = userId ?? quotation.updated_by;

      await this.QuotationVersions.create(
        {
          quotation_id: quotation.id,
          version_number: currentVersion,
          quotation_snapshot: quotation.toJSON(),
          action_type: 'APPROVED',
          changed_by: changedBy,
        },
        { transaction },
      );

      await quotation.update(
        {
          status: 'APPROVED',
          version_number: currentVersion + 1,
          updated_by: changedBy,
        },
        { transaction },
      );

      const updatedQuotation = await this.fetchQuotationById(
        quotation.id,
        transaction,
      );

      await this.createActivityLog(
        quotation.id,
        'APPROVED',
        quotation.toJSON(),
        updatedQuotation ? updatedQuotation.toJSON() : null,
        changedBy,
        transaction,
      );

      await transaction.commit();

      log.info('Quotation approved successfully', {
        quotationId: quotation.id,
      });

      return {
        success: true,
        message: 'Quotation approved successfully',
        data: updatedQuotation,
      };
    } catch (error: unknown) {
      await transaction.rollback();
      log.error('Failed to approve quotation', error as Error);

      return {
        success: false,
        message: 'Failed to approve quotation',
        data: null,
      };
    }
  }

  async deleteQuotation(id: number, userId: number): Promise<IServiceResponse> {
    const log = this.getLog('deleteQuotation', {
      quotationId: id,
    });

    const transaction = await this.dbProvider.sequelize.transaction();

    try {
      const quotation = await this.Quotations.findByPk(id, {
        transaction,
      });

      if (!quotation) {
        await transaction.rollback();

        return {
          success: false,
          message: 'Quotation not found',
          data: null,
        };
      }

      const oldSnapshot = quotation.toJSON();

      await this.QuotationVersions.create(
        {
          quotation_id: quotation.id,

          version_number: Number(quotation.version_number || 1),

          quotation_snapshot: oldSnapshot,

          action_type: 'UPDATED',

          changed_by: userId,
        },
        { transaction },
      );

      await quotation.update(
        {
          status: 'DELETED',

          updated_by: userId,

          version_number: Number(quotation.version_number || 1) + 1,
        },
        { transaction },
      );

      const updatedQuotation = await this.fetchQuotationById(
        quotation.id,
        transaction,
      );

      await this.createActivityLog(
        quotation.id,
        'DELETED',
        oldSnapshot,
        updatedQuotation ? updatedQuotation.toJSON() : null,
        userId,
        transaction,
      );

      await transaction.commit();

      return {
        success: true,
        message: 'Quotation deleted successfully',
        data: updatedQuotation,
      };
    } catch (error) {
      await transaction.rollback();

      log.error('Failed to delete quotation', error as Error);

      return {
        success: false,
        message: 'Failed to delete quotation',
        data: null,
      };
    }
  }
}
