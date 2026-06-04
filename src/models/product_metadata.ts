import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface product_metadataAttributes {
  id: number;
  product_id: number;
  key: string;
  value?: string;
  data_type?: string;
  is_sensitive?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type product_metadataPk = 'id';
export type product_metadataId = product_metadata[product_metadataPk];
export type product_metadataOptionalAttributes =
  | 'id'
  | 'value'
  | 'data_type'
  | 'is_sensitive'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type product_metadataCreationAttributes = Optional<
  product_metadataAttributes,
  product_metadataOptionalAttributes
>;

export class product_metadata
  extends Model<product_metadataAttributes, product_metadataCreationAttributes>
  implements product_metadataAttributes
{
  id!: number;
  product_id!: number;
  key!: string;
  value?: string;
  data_type?: string;
  is_sensitive?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof product_metadata {
    return product_metadata.init(
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
        key: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        value: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        data_type: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        is_sensitive: {
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
        tableName: 'product_metadata',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          { name: 'product_id', using: 'BTREE', fields: [{ name: 'product_id' }] },
          { name: 'key', using: 'BTREE', fields: [{ name: 'key' }] },
        ],
      },
    );
  }
}
