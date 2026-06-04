import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface company_addressesAttributes {
  id: number;
  company_id: number;
  type?: string;
  label?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  phone?: string;
  fax?: string;
  notes?: string;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type company_addressesPk = 'id';
export type company_addressesId = company_addresses[company_addressesPk];
export type company_addressesOptionalAttributes =
  | 'id'
  | 'type'
  | 'label'
  | 'line_1'
  | 'line_2'
  | 'city'
  | 'state'
  | 'country'
  | 'postal_code'
  | 'phone'
  | 'fax'
  | 'notes'
  | 'is_default'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type company_addressesCreationAttributes = Optional<
  company_addressesAttributes,
  company_addressesOptionalAttributes
>;

export class company_addresses
  extends Model<company_addressesAttributes, company_addressesCreationAttributes>
  implements company_addressesAttributes
{
  id!: number;
  company_id!: number;
  type?: string;
  label?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  phone?: string;
  fax?: string;
  notes?: string;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof company_addresses {
    return company_addresses.init(
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
        type: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        label: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        line_1: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        line_2: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        city: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        state: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        country: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        postal_code: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        fax: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        notes: {
          type: DataTypes.TEXT,
          allowNull: true,
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
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'company_addresses',
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
            name: 'company_addresses_company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
