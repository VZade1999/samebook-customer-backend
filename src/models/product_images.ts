import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface product_imagesAttributes {
  id: number;
  product_id: number;
  variant_id?: number;
  url?: string;
  sort_order?: number;
  metadata?: object | string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type product_imagesPk = 'id';
export type product_imagesId = product_images[product_imagesPk];
export type product_imagesOptionalAttributes =
  | 'id'
  | 'variant_id'
  | 'url'
  | 'sort_order'
  | 'metadata'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type product_imagesCreationAttributes = Optional<
  product_imagesAttributes,
  product_imagesOptionalAttributes
>;

export class product_images
  extends Model<product_imagesAttributes, product_imagesCreationAttributes>
  implements product_imagesAttributes
{
  id!: number;
  product_id!: number;
  variant_id?: number;
  url?: string;
  sort_order?: number;
  metadata?: object | string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof product_images {
    return product_images.init(
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
        url: {
          type: DataTypes.STRING(1000),
          allowNull: true,
        },
        sort_order: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        metadata: {
          type: DataTypes.JSON,
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
        tableName: 'product_images',
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
