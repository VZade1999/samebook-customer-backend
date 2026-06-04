import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface product_variantsAttributes {
  id: number;
  product_id: number;
  sku?: string;
  attributes?: object | string;
  price?: number;
  compare_at_price?: number;
  cost_price?: number;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type product_variantsPk = 'id';
export type product_variantsId = product_variants[product_variantsPk];
export type product_variantsOptionalAttributes =
  | 'id'
  | 'sku'
  | 'attributes'
  | 'price'
  | 'compare_at_price'
  | 'cost_price'
  | 'is_default'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type product_variantsCreationAttributes = Optional<
  product_variantsAttributes,
  product_variantsOptionalAttributes
>;

export class product_variants
  extends Model<product_variantsAttributes, product_variantsCreationAttributes>
  implements product_variantsAttributes
{
  id!: number;
  product_id!: number;
  sku?: string;
  attributes?: object | string;
  price?: number;
  compare_at_price?: number;
  cost_price?: number;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof product_variants {
    return product_variants.init(
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
        sku: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        attributes: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        price: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },
        compare_at_price: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },
        cost_price: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },
        is_default: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 0,
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
        tableName: 'product_variants',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          { name: 'product_id', using: 'BTREE', fields: [{ name: 'product_id' }] },
          { name: 'sku', using: 'BTREE', fields: [{ name: 'sku' }] },
        ],
      },
    );
  }
}
