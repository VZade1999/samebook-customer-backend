import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface invoicesAttributes {
  id: number;

  quotation_id: number;

  company_id: number;

  customer_id: number;

  invoice_number: string;

  quotation_number?: string;

  document_type?: string;

  daily_sequence?: number;

  overall_sequence?: number;

  invoice_date: Date;

  due_date?: Date;

  payment_terms?: string;

  status?: string;

  customer_name?: string;

  customer_type?: string;

  customer_gst_number?: string;

  contact_person_name?: string;

  contact_person_email?: string;

  contact_person_phone?: string;

  billing_address_snapshot?: object;

  shipping_address_snapshot?: object;

  business_details_snapshot?: object;

  payment_details_snapshot?: object;

  notes?: string;

  terms_conditions?: string;

  place_of_supply_state_id?: number;

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

  paid_amount?: number;

  balance_amount?: number;

  pdf_path?: string;

  generated_by?: number;

  created_at?: Date;

  updated_at?: Date;
}

export type invoicesPk = 'id';

export type invoicesId = invoices[invoicesPk];

export type invoicesOptionalAttributes =
  | 'id'
  | 'quotation_number'
  | 'document_type'
  | 'daily_sequence'
  | 'overall_sequence'
  | 'due_date'
  | 'payment_terms'
  | 'status'
  | 'customer_name'
  | 'customer_type'
  | 'customer_gst_number'
  | 'contact_person_name'
  | 'contact_person_email'
  | 'contact_person_phone'
  | 'billing_address_snapshot'
  | 'shipping_address_snapshot'
  | 'business_details_snapshot'
  | 'payment_details_snapshot'
  | 'notes'
  | 'terms_conditions'
  | 'place_of_supply_state_id'
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
  | 'paid_amount'
  | 'balance_amount'
  | 'pdf_path'
  | 'generated_by'
  | 'created_at'
  | 'updated_at';

export type invoicesCreationAttributes = Optional<
  invoicesAttributes,
  invoicesOptionalAttributes
>;

export class invoices
  extends Model<
    invoicesAttributes,
    invoicesCreationAttributes
  >
  implements invoicesAttributes
{
  id!: number;
  quotation_id!: number;
  company_id!: number;
  customer_id!: number;
  invoice_number!: string;

  quotation_number?: string;
  document_type?: string;
  daily_sequence?: number;
  overall_sequence?: number;

  invoice_date!: Date;
  due_date?: Date;

  payment_terms?: string;
  status?: string;

  customer_name?: string;
  customer_type?: string;
  customer_gst_number?: string;

  contact_person_name?: string;
  contact_person_email?: string;
  contact_person_phone?: string;

  billing_address_snapshot?: object;
  shipping_address_snapshot?: object;

  business_details_snapshot?: object;
  payment_details_snapshot?: object;

  notes?: string;
  terms_conditions?: string;

  place_of_supply_state_id?: number;

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

  paid_amount?: number;
  balance_amount?: number;

  pdf_path?: string;

  generated_by?: number;

  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof invoices {
    return invoices.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        quotation_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        company_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        customer_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        invoice_number: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },

        quotation_number: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        document_type: {
          type: DataTypes.STRING(20),
          allowNull: true,
          defaultValue: 'INV',
        },

        daily_sequence: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },

        overall_sequence: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        invoice_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },

        due_date: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },

        payment_terms: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        status: {
          type: DataTypes.ENUM(
            'GENERATED',
            'SENT',
            'PARTIAL_PAID',
            'PAID',
            'OVERDUE',
            'SUPERSEDED',
            'CANCELLED',
          ),
          defaultValue: 'GENERATED',
        },

        customer_name: DataTypes.STRING(255),
        customer_type: DataTypes.STRING(50),
        customer_gst_number: DataTypes.STRING(100),

        contact_person_name: DataTypes.STRING(255),
        contact_person_email: DataTypes.STRING(255),
        contact_person_phone: DataTypes.STRING(100),

        billing_address_snapshot: DataTypes.JSON,
        shipping_address_snapshot: DataTypes.JSON,

        business_details_snapshot: DataTypes.JSON,
        payment_details_snapshot: DataTypes.JSON,

        notes: DataTypes.TEXT,
        terms_conditions: DataTypes.TEXT,

        place_of_supply_state_id: DataTypes.BIGINT,

        sub_total: DataTypes.DECIMAL(15, 2),

        discount_percent: DataTypes.DECIMAL(10, 2),
        discount_amount: DataTypes.DECIMAL(15, 2),

        cgst_percent: DataTypes.DECIMAL(10, 2),
        cgst_amount: DataTypes.DECIMAL(15, 2),

        sgst_percent: DataTypes.DECIMAL(10, 2),
        sgst_amount: DataTypes.DECIMAL(15, 2),

        igst_percent: DataTypes.DECIMAL(10, 2),
        igst_amount: DataTypes.DECIMAL(15, 2),

        transport_charges: DataTypes.DECIMAL(15, 2),

        grand_total: DataTypes.DECIMAL(15, 2),

        paid_amount: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0,
        },

        balance_amount: {
          type: DataTypes.DECIMAL(15, 2),
          defaultValue: 0,
        },

        pdf_path: DataTypes.STRING(500),

        generated_by: DataTypes.BIGINT,

        created_at: {
          type: DataTypes.DATE,
          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },

        updated_at: {
          type: DataTypes.DATE,
          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },
      },
      {
        sequelize,
        tableName: 'invoices',
        timestamps: false,
        underscored: true,
      },
    );
  }
}