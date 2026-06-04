import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface company_metadataAttributes {
  id: number;
  company_id: number;
  key: string;
  value?: string;
  data_type?: string;
  is_sensitive?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type company_metadataPk = 'id';
export type company_metadataId = company_metadata[company_metadataPk];
export type company_metadataOptionalAttributes =
  | 'id'
  | 'value'
  | 'data_type'
  | 'is_sensitive'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type company_metadataCreationAttributes = Optional<
  company_metadataAttributes,
  company_metadataOptionalAttributes
>;

export class company_metadata
  extends Model<company_metadataAttributes, company_metadataCreationAttributes>
  implements company_metadataAttributes
{
  id!: number;
  company_id!: number;
  key!: string;
  value?: string;
  data_type?: string;
  is_sensitive?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof company_metadata {
    return company_metadata.init(
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
          references: {
            model: 'companies',
            key: 'id',
          },
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
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'company_metadata',
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
            name: 'company_metadata_company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
          {
            name: 'company_metadata_key',
            using: 'BTREE',
            fields: [{ name: 'key' }],
          },
        ],
      },
    );
  }
}
