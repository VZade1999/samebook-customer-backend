import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface delivery_challan_itemsAttributes {
  id: number;
  delivery_challan_id: number;
  quotation_item_id?: number | null;
  product_id?: number | null;
  variant_id?: number | null;
  item_name: string;
  description?: string | null;
  hsn_code?: string | null;
  quantity: number;
  unit?: string | null;
  rate?: number;
  value?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type delivery_challan_itemsPk = 'id';
export type delivery_challan_itemsId =
  delivery_challan_items[delivery_challan_itemsPk];
export type delivery_challan_itemsOptionalAttributes =
  | 'id'
  | 'quotation_item_id'
  | 'product_id'
  | 'variant_id'
  | 'description'
  | 'hsn_code'
  | 'unit'
  | 'rate'
  | 'value'
  | 'created_at'
  | 'updated_at';
export type delivery_challan_itemsCreationAttributes = Optional<
  delivery_challan_itemsAttributes,
  delivery_challan_itemsOptionalAttributes
>;

export class delivery_challan_items
  extends Model<
    delivery_challan_itemsAttributes,
    delivery_challan_itemsCreationAttributes
  >
  implements delivery_challan_itemsAttributes
{
  id!: number;
  delivery_challan_id!: number;
  quotation_item_id?: number | null;
  product_id?: number | null;
  variant_id?: number | null;
  item_name!: string;
  description?: string | null;
  hsn_code?: string | null;
  quantity!: number;
  unit?: string | null;
  rate?: number;
  value?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof delivery_challan_items {
    return delivery_challan_items.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        delivery_challan_id: { type: DataTypes.BIGINT, allowNull: false },
        quotation_item_id: { type: DataTypes.BIGINT, allowNull: true },
        product_id: { type: DataTypes.BIGINT, allowNull: true },
        variant_id: { type: DataTypes.BIGINT, allowNull: true },
        item_name: { type: DataTypes.STRING(255), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        hsn_code: { type: DataTypes.STRING(20), allowNull: true },
        quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
        unit: { type: DataTypes.STRING(32), allowNull: true },
        rate: {
          type: DataTypes.DECIMAL(14, 2),
          allowNull: true,
          defaultValue: 0,
        },
        value: {
          type: DataTypes.DECIMAL(14, 2),
          allowNull: true,
          defaultValue: 0,
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
        tableName: 'delivery_challan_items',
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
            name: 'idx_dci_challan',
            using: 'BTREE',
            fields: [{ name: 'delivery_challan_id' }],
          },
          {
            name: 'idx_dci_quotation_item',
            using: 'BTREE',
            fields: [{ name: 'quotation_item_id' }],
          },
        ],
      },
    );
  }
}
