import {
  Inject,
  Injectable,
} from '@nestjs/common';

import { Op } from 'sequelize';

import { AppLogger } from 'src/common/logger/logger.service';

import { customers } from 'src/models/customers';

import { customer_contacts } from 'src/models/customer_contacts';

import { customer_addresses } from 'src/models/customer_addresses';

import { CreateCustomerDto } from './dto/createCustomer.dto';

import { UpdateCustomerDto } from './dto/updateCustomer.dto';

import { CustomersListDto } from './customers-list.dto';

@Injectable()
export class CustomerService {
  private readonly Customers: typeof customers;

  private readonly CustomerContacts: typeof customer_contacts;

  private readonly CustomerAddresses: typeof customer_addresses;

  constructor(
    @Inject(
      'DATABASE_CONNECTION',
    )
    private dbProvider: any,

    private readonly appLogger: AppLogger,
  ) {
    this.Customers =
      this.dbProvider.db.customers;

    this.CustomerContacts =
      this.dbProvider.db.customer_contacts;

    this.CustomerAddresses =
      this.dbProvider.db.customer_addresses;
  }

  // =====================================================
  // CREATE CUSTOMER
  // =====================================================

  async createCustomer(
    data: CreateCustomerDto,

    currentUser: {
      company_id: number;

      user_id: number;
    },
  ) {
    const transaction =
      await this.dbProvider.sequelize.transaction();

    const log =
      this.appLogger.forContext(
        'CustomerService',
        'createCustomer',
        {
          companyId:
            currentUser.company_id,
        },
      );

    try {
      log.info(
        'Create customer started',
      );

      // =====================================
      // CHECK DUPLICATE CUSTOMER
      // =====================================

      const existingCustomer =
        await this.Customers.findOne(
          {
            where: {
              company_id:
                currentUser.company_id,

              display_name:
                data.display_name,

              is_active: 1,
            },

            transaction,
          },
        );

      if (existingCustomer) {
        await transaction.rollback();

        return {
          success: false,

          message:
            'Customer already exists',
        };
      }

      // =====================================
      // CREATE CUSTOMER
      // =====================================

      const customer =
        await this.Customers.create(
          {
            company_id:
              currentUser.company_id,

            customer_type:
              data.customer_type,

            display_name:
              data.display_name,

            company_name:
              data.company_name,

            gst_number:
              data.gst_number,

            website:
              data.website,

            industry:
              data.industry,

            notes: data.notes,

            created_by:
              currentUser.user_id,

            updated_by:
              currentUser.user_id,
          },
          {
            transaction,
          },
        );

      // =====================================
      // CREATE CONTACTS
      // =====================================

      if (
        data.contacts?.length
      ) {
        const contactsPayload =
          data.contacts.map(
            (contact) => ({
              customer_id:
                customer.id,

              first_name:
                contact.first_name,

              last_name:
                contact.last_name,

              email:
                contact.email,

              phone:
                contact.phone,

              department:
                contact.department,

              designation:
                contact.designation,

              is_primary:
                contact.is_primary ||
                0,

              created_by:
                currentUser.user_id,

              updated_by:
                currentUser.user_id,
            }),
          );

        await this.CustomerContacts.bulkCreate(
          contactsPayload,
          {
            transaction,
          },
        );
      }

      // =====================================
      // CREATE ADDRESSES
      // =====================================

      if (
        data.addresses?.length
      ) {
        const addressesPayload =
          data.addresses.map(
            (address) => ({
              customer_id:
                customer.id,

              address_type:
                address.address_type,

              label:
                address.label,

              gst_number:
                address.gst_number,

              address_line_1:
                address.address_line_1,

              address_line_2:
                address.address_line_2,

              city: address.city,

              state:
                address.state,

              country:
                address.country,

              postal_code:
                address.postal_code,

              is_primary:
                address.is_primary ||
                0,

              created_by:
                currentUser.user_id,

              updated_by:
                currentUser.user_id,
            }),
          );

        await this.CustomerAddresses.bulkCreate(
          addressesPayload,
          {
            transaction,
          },
        );
      }

      await transaction.commit();

      log.info(
        'Customer created successfully',
      );

      return {
        success: true,

        message:
          'Customer created successfully',

        data: {
          id: customer.id,
        },
      };
    } catch (error: any) {
      await transaction.rollback();

      log.error(
        'Create customer failed',
        error,
      );

      throw new Error(
        'DATABASE_ERROR',
      );
    }
  }

  // =====================================================
  // GET CUSTOMERS LIST
  // =====================================================

  async getCustomersList(
    query: CustomersListDto,

    currentUser: {
      company_id: number;

      user_id: number;
    },
  ) {
    const log =
      this.appLogger.forContext(
        'CustomerService',
        'getCustomersList',
        {
          companyId:
            currentUser.company_id,
        },
      );

    try {
      const page =
        Number(query.page) || 1;

      const limit =
        Number(query.limit) || 10;

      const offset =
        (page - 1) * limit;

      const whereClause: any =
        {
          company_id:
            currentUser.company_id,

          is_active: 1,
        };

      // =====================================
      // SEARCH
      // =====================================

      if (query.search) {
        whereClause[
          Op.or
        ] = [
          {
            display_name: {
              [Op.like]: `%${query.search}%`,
            },
          },

          {
            company_name: {
              [Op.like]: `%${query.search}%`,
            },
          },

          {
            gst_number: {
              [Op.like]: `%${query.search}%`,
            },
          },
        ];
      }

      // =====================================
      // CUSTOMER TYPE
      // =====================================

      if (
        query.customer_type
      ) {
        whereClause.customer_type =
          query.customer_type;
      }

      // =====================================
      // INDUSTRY
      // =====================================

      if (query.industry) {
        whereClause.industry =
          query.industry;
      }

      // =====================================
      // GET DATA
      // =====================================

      const result =
        await this.Customers.findAndCountAll(
          {
            where: whereClause,

            include: [
              {
                model:
                  this.CustomerContacts,

                as: 'contacts',

                required: false,

                where: {
                  is_active: 1,
                },

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
                model:
                  this.CustomerAddresses,

                as: 'addresses',

                required: false,

                where: {
                  is_active: 1,
                },

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

            order: [
              [
                'created_at',
                'DESC',
              ],
            ],

            limit,

            offset,

            distinct: true,
          },
        );

      const totalPages =
        Math.ceil(
          result.count / limit,
        );

      return {
        success: true,

        message:
          'Customers fetched successfully',

        data: {
          customers:
            result.rows,

          pagination: {
            total:
              result.count,

            page,

            limit,

            totalPages,

            hasNextPage:
              page <
              totalPages,

            hasPrevPage:
              page > 1,
          },
        },
      };
    } catch (error: any) {
      log.error(
        'Get customers list failed',
        error,
      );

      throw new Error(
        'DATABASE_ERROR',
      );
    }
  }

  // =====================================================
  // GET CUSTOMER DETAILS
  // =====================================================

  async getCustomerDetails(
    customerId: number,

    currentUser: {
      company_id: number;

      user_id: number;
    },
  ) {
    const log =
      this.appLogger.forContext(
        'CustomerService',
        'getCustomerDetails',
        {
          customerId,
        },
      );

    try {
      const customer =
        await this.Customers.findOne(
          {
            where: {
              id: customerId,

              company_id:
                currentUser.company_id,

              is_active: 1,
            },

            include: [
              {
                model:
                  this.CustomerContacts,

                as: 'contacts',

                required: false,
              },

              {
                model:
                  this.CustomerAddresses,

                as: 'addresses',

                required: false,
              },
            ],
          },
        );

      if (!customer) {
        return {
          success: false,

          message:
            'Customer not found',
        };
      }

      return {
        success: true,

        message:
          'Customer details fetched successfully',

        data: customer,
      };
    } catch (error: any) {
      log.error(
        'Get customer details failed',
        error,
      );

      throw new Error(
        'DATABASE_ERROR',
      );
    }
  }

  // =====================================================
  // UPDATE CUSTOMER
  // =====================================================

  async updateCustomer(
    customerId: number,

    data: UpdateCustomerDto,

    currentUser: {
      company_id: number;

      user_id: number;
    },
  ) {
    const transaction =
      await this.dbProvider.sequelize.transaction();

    const log =
      this.appLogger.forContext(
        'CustomerService',
        'updateCustomer',
        {
          customerId,
        },
      );

    try {
      const customer =
        await this.Customers.findOne(
          {
            where: {
              id: customerId,

              company_id:
                currentUser.company_id,

              is_active: 1,
            },

            transaction,
          },
        );

      if (!customer) {
        await transaction.rollback();

        return {
          success: false,

          message:
            'Customer not found',
            data: null,
        };
      }

      // =====================================
      // UPDATE CUSTOMER
      // =====================================

      await customer.update(
        {
          ...(data.customer_type !==
            undefined && {
            customer_type:
              data.customer_type,
          }),

          ...(data.display_name !==
            undefined && {
            display_name:
              data.display_name,
          }),

          ...(data.company_name !==
            undefined && {
            company_name:
              data.company_name,
          }),

          ...(data.gst_number !==
            undefined && {
            gst_number:
              data.gst_number,
          }),

          ...(data.website !==
            undefined && {
            website:
              data.website,
          }),

          ...(data.industry !==
            undefined && {
            industry:
              data.industry,
          }),

          ...(data.notes !==
            undefined && {
            notes:
              data.notes,
          }),

          updated_by:
            currentUser.user_id,
        },
        {
          transaction,
        },
      );

      // =====================================
      // UPDATE CONTACTS
      // =====================================

      if (
        data.contacts
      ) {
        // SOFT DELETE OLD CONTACTS

        await this.CustomerContacts.update(
          {
            is_active: 0,
          },
          {
            where: {
              customer_id:
                customerId,
            },

            transaction,
          },
        );

        // INSERT NEW CONTACTS

        const contactsPayload =
          data.contacts.map(
            (contact) => ({
              customer_id:
                customerId,

              first_name:
                contact.first_name,

              last_name:
                contact.last_name,

              email:
                contact.email,

              phone:
                contact.phone,

              department:
                contact.department,

              designation:
                contact.designation,

              is_primary:
                contact.is_primary ||
                0,

              created_by:
                currentUser.user_id,

              updated_by:
                currentUser.user_id,
            }),
          );

        await this.CustomerContacts.bulkCreate(
          contactsPayload,
          {
            transaction,
          },
        );
      }

      // =====================================
      // UPDATE ADDRESSES
      // =====================================

      if (
        data.addresses
      ) {
        // SOFT DELETE OLD ADDRESSES

        await this.CustomerAddresses.update(
          {
            is_active: 0,
          },
          {
            where: {
              customer_id:
                customerId,
            },

            transaction,
          },
        );

        // INSERT NEW ADDRESSES

        const addressesPayload =
          data.addresses.map(
            (address) => ({
              customer_id:
                customerId,

              address_type:
                address.address_type,

              label:
                address.label,

              gst_number:
                address.gst_number,

              address_line_1:
                address.address_line_1,

              address_line_2:
                address.address_line_2,

              city: address.city,

              state:
                address.state,

              country:
                address.country,

              postal_code:
                address.postal_code,

              is_primary:
                address.is_primary ||
                0,

              created_by:
                currentUser.user_id,

              updated_by:
                currentUser.user_id,
            }),
          );

        await this.CustomerAddresses.bulkCreate(
          addressesPayload,
          {
            transaction,
          },
        );
      }

      await transaction.commit();

      return {
        success: true,

        message:
          'Customer updated successfully',
      };
    } catch (error: any) {
      await transaction.rollback();

      log.error(
        'Update customer failed',
        error,
      );

      throw new Error(
        'DATABASE_ERROR',
      );
    }
  }

  // =====================================================
  // DELETE CUSTOMER
  // =====================================================

  async deleteCustomer(
    customerId: number,

    currentUser: {
      company_id: number;

      user_id: number;
    },
  ) {
    const transaction =
      await this.dbProvider.sequelize.transaction();

    const log =
      this.appLogger.forContext(
        'CustomerService',
        'deleteCustomer',
        {
          customerId,
        },
      );

    try {
      const customer =
        await this.Customers.findOne(
          {
            where: {
              id: customerId,

              company_id:
                currentUser.company_id,

              is_active: 1,
            },

            transaction,
          },
        );

      if (!customer) {
        await transaction.rollback();

        return {
          success: false,

          message:
            'Customer not found',
            data: null,
        };
      }

      // SOFT DELETE CUSTOMER

      await customer.update(
        {
          is_active: 0,

          updated_by:
            currentUser.user_id,
        },
        {
          transaction,
        },
      );

      // SOFT DELETE CONTACTS

      await this.CustomerContacts.update(
        {
          is_active: 0,
        },
        {
          where: {
            customer_id:
              customerId,
          },

          transaction,
        },
      );

      // SOFT DELETE ADDRESSES

      await this.CustomerAddresses.update(
        {
          is_active: 0,
        },
        {
          where: {
            customer_id:
              customerId,
          },

          transaction,
        },
      );

      await transaction.commit();

      return {
        success: true,

        message:
          'Customer deleted successfully',
        data: null,
      };
    } catch (error: any) {
      await transaction.rollback();

      log.error(
        'Delete customer failed',
        error,
      );

      throw new Error(
        'DATABASE_ERROR',
      );
    }
  }
}