import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface delivery_challansAttributes {
  id: number;
  company_id: number;
  challan_number: string;
  challan_date: string | Date;
  reason: string;
  status?: string;
  quotation_id?: number | null;
  invoice_id?: number | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_gst_number?: string | null;
  billing_address_snapshot?: object | null;
  shipping_address_snapshot?: object | null;
  place_of_supply?: string | null;
  from_warehouse_id?: number | null;
  to_warehouse_id?: number | null;
  transporter_name?: string | null;
  vehicle_number?: string | null;
  eway_bill_number?: string | null;
  notes?: string | null;
  total_quantity?: number;
  total_value?: number;
  affects_stock?: number;
  overall_sequence: number;
  dispatched_at?: Date | null;
  delivered_at?: Date | null;
  cancelled_at?: Date | null;
  created_by?: number;
  updated_by?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type delivery_challansPk = 'id';
export type delivery_challansId = delivery_challans[delivery_challansPk];
export type delivery_challansOptionalAttributes =
  | 'id'
  | 'status'
  | 'quotation_id'
  | 'invoice_id'
  | 'customer_id'
  | 'customer_name'
  | 'customer_gst_number'
  | 'billing_address_snapshot'
  | 'shipping_address_snapshot'
  | 'place_of_supply'
  | 'from_warehouse_id'
  | 'to_warehouse_id'
  | 'transporter_name'
  | 'vehicle_number'
  | 'eway_bill_number'
  | 'notes'
  | 'total_quantity'
  | 'total_value'
  | 'affects_stock'
  | 'dispatched_at'
  | 'delivered_at'
  | 'cancelled_at'
  | 'created_by'
  | 'updated_by'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type delivery_challansCreationAttributes = Optional<
  delivery_challansAttributes,
  delivery_challansOptionalAttributes
>;

export class delivery_challans
  extends Model<delivery_challansAttributes, delivery_challansCreationAttributes>
  implements delivery_challansAttributes
{
  id!: number;
  company_id!: number;
  challan_number!: string;
  challan_date!: string | Date;
  reason!: string;
  status?: string;
  quotation_id?: number | null;
  invoice_id?: number | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_gst_number?: string | null;
  billing_address_snapshot?: object | null;
  shipping_address_snapshot?: object | null;
  place_of_supply?: string | null;
  from_warehouse_id?: number | null;
  to_warehouse_id?: number | null;
  transporter_name?: string | null;
  vehicle_number?: string | null;
  eway_bill_number?: string | null;
  notes?: string | null;
  total_quantity?: number;
  total_value?: number;
  affects_stock?: number;
  overall_sequence!: number;
  dispatched_at?: Date | null;
  delivered_at?: Date | null;
  cancelled_at?: Date | null;
  created_by?: number;
  updated_by?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof delivery_challans {
    return delivery_challans.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        company_id: { type: DataTypes.BIGINT, allowNull: false },
        challan_number: { type: DataTypes.STRING(64), allowNull: false },
        challan_date: { type: DataTypes.DATEONLY, allowNull: false },
        reason: { type: DataTypes.STRING(32), allowNull: false },
        status: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'DRAFT',
        },
        quotation_id: { type: DataTypes.BIGINT, allowNull: true },
        invoice_id: { type: DataTypes.BIGINT, allowNull: true },
        customer_id: { type: DataTypes.BIGINT, allowNull: true },
        customer_name: { type: DataTypes.STRING(255), allowNull: true },
        customer_gst_number: { type: DataTypes.STRING(20), allowNull: true },
        billing_address_snapshot: { type: DataTypes.JSON, allowNull: true },
        shipping_address_snapshot: { type: DataTypes.JSON, allowNull: true },
        place_of_supply: { type: DataTypes.STRING(100), allowNull: true },
        from_warehouse_id: { type: DataTypes.BIGINT, allowNull: true },
        to_warehouse_id: { type: DataTypes.BIGINT, allowNull: true },
        transporter_name: { type: DataTypes.STRING(255), allowNull: true },
        vehicle_number: { type: DataTypes.STRING(32), allowNull: true },
        eway_bill_number: { type: DataTypes.STRING(32), allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        total_quantity: {
          type: DataTypes.DECIMAL(14, 3),
          allowNull: true,
          defaultValue: 0,
        },
        total_value: {
          type: DataTypes.DECIMAL(14, 2),
          allowNull: true,
          defaultValue: 0,
        },
        affects_stock: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
        },
        overall_sequence: { type: DataTypes.INTEGER, allowNull: false },
        dispatched_at: { type: DataTypes.DATE, allowNull: true },
        delivered_at: { type: DataTypes.DATE, allowNull: true },
        cancelled_at: { type: DataTypes.DATE, allowNull: true },
        created_by: { type: DataTypes.BIGINT, allowNull: true },
        updated_by: { type: DataTypes.BIGINT, allowNull: true },
        is_active: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'delivery_challans',
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
            name: 'uq_dc_company_number',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'challan_number' }],
          },
          {
            name: 'idx_dc_company_status',
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'status' }],
          },
          {
            name: 'idx_dc_quotation',
            using: 'BTREE',
            fields: [{ name: 'quotation_id' }],
          },
        ],
      },
    );
  }
}
