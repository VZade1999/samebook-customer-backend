import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface productsAttributes {
  id: number;
  company_id: number;
  product_code?: string;
  name: string;
  description?: string;
  unit?: string;
  price: number;
  cost_price?: number;
  tax_percentage?: number;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  minimum_stock?: number;
  is_active?: number;
  image_url?: string;
  created_at?: Date;
  updated_at?: Date;
  category_id?: number;
}

export type productsPk = 'id';
export type productsId = products[productsPk];
export type productsOptionalAttributes =
  | 'id'
  | 'product_code'
  | 'description'
  | 'unit'
  | 'cost_price'
  | 'tax_percentage'
  | 'sku'
  | 'barcode'
  | 'stock_quantity'
  | 'minimum_stock'
  | 'is_active'
  | 'image_url'
  | 'created_at'
  | 'updated_at'
  | 'category_id';
export type productsCreationAttributes = Optional<
  productsAttributes,
  productsOptionalAttributes
>;

export class products
  extends Model<productsAttributes, productsCreationAttributes>
  implements productsAttributes
{
  id!: number;
  company_id!: number;
  product_code?: string;
  name!: string;
  description?: string;
  unit?: string;
  price!: number;
  cost_price?: number;
  tax_percentage?: number;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  minimum_stock?: number;
  is_active?: number;
  image_url?: string;
  created_at?: Date;
  updated_at?: Date;
  category_id?: number;

  static initModel(sequelize: Sequelize.Sequelize): typeof products {
    return products.init(
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
        product_code: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        unit: {
          type: DataTypes.STRING(50),
          allowNull: true,
          defaultValue: 'pcs',
        },
        price: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0.0,
        },
        cost_price: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },
        tax_percentage: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.0,
        },
        sku: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        barcode: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        stock_quantity: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        minimum_stock: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        is_active: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
        },
        image_url: {
          type: DataTypes.STRING(500),
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
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        category_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: 'products',
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
            name: 'company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
          {
            name: 'name',
            using: 'BTREE',
            fields: [{ name: 'name' }],
          },
          {
            name: 'sku',
            using: 'BTREE',
            fields: [{ name: 'sku' }],
          },
          {
            name: 'products_ibfk_2',
            using: 'BTREE',
            fields: [{ name: 'category_id' }],
          },
        ],
      },
    );
  }
}
