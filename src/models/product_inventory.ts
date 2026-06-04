import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface product_inventoryAttributes {
  id: number;
  product_id: number;
  variant_id?: number;
  stock_level?: number;
  stock_policy?: string;
  warehouse_id?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type product_inventoryPk = 'id';
export type product_inventoryId = product_inventory[product_inventoryPk];
export type product_inventoryOptionalAttributes =
  | 'id'
  | 'variant_id'
  | 'stock_level'
  | 'stock_policy'
  | 'warehouse_id'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type product_inventoryCreationAttributes = Optional<
  product_inventoryAttributes,
  product_inventoryOptionalAttributes
>;

export class product_inventory
  extends Model<product_inventoryAttributes, product_inventoryCreationAttributes>
  implements product_inventoryAttributes
{
  id!: number;
  product_id!: number;
  variant_id?: number;
  stock_level?: number;
  stock_policy?: string;
  warehouse_id?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof product_inventory {
    return product_inventory.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        product_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        variant_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
        stock_level: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        stock_policy: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        warehouse_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
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
        tableName: 'product_inventory',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          { name: 'product_id', using: 'BTREE', fields: [{ name: 'product_id' }] },
          { name: 'variant_id', using: 'BTREE', fields: [{ name: 'variant_id' }] },
        ],
      },
    );
  }
}
