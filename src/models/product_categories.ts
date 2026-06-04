import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface product_categoriesAttributes {
  id: number;
  company_id: number;
  name: string;
  description?: string;
  parent_category_id?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type product_categoriesPk = 'id';
export type product_categoriesId = product_categories[product_categoriesPk];
export type product_categoriesOptionalAttributes =
  | 'id'
  | 'description'
  | 'parent_category_id'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type product_categoriesCreationAttributes = Optional<
  product_categoriesAttributes,
  product_categoriesOptionalAttributes
>;

export class product_categories
  extends Model<
    product_categoriesAttributes,
    product_categoriesCreationAttributes
  >
  implements product_categoriesAttributes
{
  id!: number;
  company_id!: number;
  name!: string;
  description?: string;
  parent_category_id?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof product_categories {
    return product_categories.init(
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
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        parent_category_id: {
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
        tableName: 'product_categories',
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
            name: 'parent_category_id',
            using: 'BTREE',
            fields: [{ name: 'parent_category_id' }],
          },
        ],
      },
    );
  }
}
