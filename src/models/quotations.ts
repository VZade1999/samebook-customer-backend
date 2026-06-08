import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';

export interface quotationsAttributes {
  id: number;

  company_id: number;

  quotation_number: string;

  customer_id?: number;

  version_number?: number;

  quotation_date?: Date;

  validity_date?: Date;

  status?: string;

  sub_total?: number;

  discount_percent?: number;

  discount_amount?: number;

  cgst_percent?: number;

  cgst_amount?: number;

  sgst_percent?: number;

  sgst_amount?: number;

  igst_percent?: number;

  igst_amount?: number;

  transport_charges?: number;

  grand_total?: number;

  notes?: string;

  terms_conditions?: string;

  place_of_supply_state_id?: number;

  created_by?: number;

  updated_by?: number;

  created_at?: Date;

  updated_at?: Date;

  billing_address_id?: number;

  shipping_address_id?: number;

  contact_person_id?: number;

  customer_name?: string;

  customer_type?: 'INDIVIDUAL' | 'BUSINESS';

  contact_person_name?: string;

  contact_person_email?: string;

  contact_person_phone?: string;

  billing_address_snapshot?: object;

  shipping_address_snapshot?: object;

  customer_gst_number?: string;
  document_type?: string;
  daily_sequence?: number;
  overall_sequence?: number;
}

export type quotationsPk = 'id';

export type quotationsId = quotations[quotationsPk];

export type quotationsOptionalAttributes =
  | 'id'
  | 'customer_id'
  | 'version_number'
  | 'quotation_date'
  | 'validity_date'
  | 'status'
  | 'sub_total'
  | 'discount_percent'
  | 'discount_amount'
  | 'cgst_percent'
  | 'cgst_amount'
  | 'sgst_percent'
  | 'sgst_amount'
  | 'igst_percent'
  | 'igst_amount'
  | 'transport_charges'
  | 'grand_total'
  | 'notes'
  | 'terms_conditions'
  | 'place_of_supply_state_id'
  | 'created_by'
  | 'updated_by'
  | 'created_at'
  | 'updated_at'
  | 'billing_address_id'
  | 'shipping_address_id'
  | 'contact_person_id'
  | 'customer_name'
  | 'customer_type'
  | 'contact_person_name'
  | 'contact_person_email'
  | 'contact_person_phone'
  | 'billing_address_snapshot'
  | 'shipping_address_snapshot'
  | 'customer_gst_number'
  | 'document_type'
  | 'daily_sequence'
  | 'overall_sequence';

export type quotationsCreationAttributes = Optional<
  quotationsAttributes,
  quotationsOptionalAttributes
>;

export class quotations
  extends Model<quotationsAttributes, quotationsCreationAttributes>
  implements quotationsAttributes
{
  id!: number;

  company_id!: number;

  quotation_number!: string;

  customer_id?: number;

  version_number?: number;

  quotation_date?: Date;

  validity_date?: Date;

  status?: string;

  sub_total?: number;

  discount_percent?: number;

  discount_amount?: number;

  cgst_percent?: number;

  cgst_amount?: number;

  sgst_percent?: number;

  sgst_amount?: number;

  igst_percent?: number;

  igst_amount?: number;

  transport_charges?: number;

  grand_total?: number;

  notes?: string;

  terms_conditions?: string;

  place_of_supply_state_id?: number;

  created_by?: number;

  updated_by?: number;

  created_at?: Date;

  updated_at?: Date;
  billing_address_id?: number;

  shipping_address_id?: number;

  contact_person_id?: number;

  customer_name?: string;

  customer_type?: 'INDIVIDUAL' | 'BUSINESS';

  contact_person_name?: string;

  contact_person_email?: string;

  contact_person_phone?: string;

  billing_address_snapshot?: object;

  shipping_address_snapshot?: object;

  customer_gst_number?: string;
  document_type?: string;
  daily_sequence?: number;
  overall_sequence?: number;

  static initModel(sequelize: Sequelize.Sequelize): typeof quotations {
    return quotations.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        company_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        quotation_number: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        document_type: {
          type: DataTypes.STRING(10),
          allowNull: false,
          defaultValue: 'QT',
        },
        daily_sequence: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        overall_sequence: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },

        customer_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
        billing_address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        shipping_address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        contact_person_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        version_number: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },

        quotation_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },

        validity_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },

        status: {
          type: DataTypes.ENUM(
            'DRAFT',
            'SENT',
            'APPROVED',
            'REJECTED',
            'EXPIRED',
            'DELETED',
          ),
          allowNull: true,
          defaultValue: 'DRAFT',
        },

        sub_total: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },

        discount_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        discount_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        cgst_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        cgst_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        sgst_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        sgst_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        igst_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        igst_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.00,
        },

        transport_charges: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },

        grand_total: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },

        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        terms_conditions: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        place_of_supply_state_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        created_by: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        updated_by: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },

        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        customer_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },

        customer_type: {
          type: DataTypes.ENUM('INDIVIDUAL', 'BUSINESS'),
          allowNull: true,
        },

        customer_gst_number: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        contact_person_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },

        contact_person_email: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },

        contact_person_phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        billing_address_snapshot: {
          type: DataTypes.JSON,
          allowNull: true,
        },

        shipping_address_snapshot: {
          type: DataTypes.JSON,
          allowNull: true,
        },
      },

      {
        sequelize,

        tableName: 'quotations',

        underscored: true,

        timestamps: false,

        indexes: [
          {
            name: 'PRIMARY',

            unique: true,

            using: 'BTREE',

            fields: [{ name: 'id' }],
          },
          {
            name: 'idx_customer_id',
            using: 'BTREE',
            fields: [{ name: 'customer_id' }],
          },

          {
            name: 'idx_billing_address_id',
            using: 'BTREE',
            fields: [{ name: 'billing_address_id' }],
          },

          {
            name: 'idx_shipping_address_id',
            using: 'BTREE',
            fields: [{ name: 'shipping_address_id' }],
          },

          {
            name: 'idx_contact_person_id',
            using: 'BTREE',
            fields: [{ name: 'contact_person_id' }],
          },
          {
            name: 'idx_company_document_date',
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'document_type' }, { name: 'created_at' }],
          },
          {
            name: 'idx_company_document_overall',
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'document_type' }, { name: 'overall_sequence' }],
          },
        ],
      },
    );
  }
}
