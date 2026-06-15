import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface companiesAttributes {
  id: number;
  name: string;
  company_prefix?: string;
  legal_name?: string;
  registration_number?: string;
  tax_id?: string;
  website?: string;
  industry?: string;
  primary_email?: string;
  primary_phone?: string;
  status?: string;
  default_terms_conditions?: string;
  logo?: Buffer;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type companiesPk = 'id';
export type companiesId = companies[companiesPk];
export type companiesOptionalAttributes =
  | 'id'
  | 'company_prefix'
  | 'legal_name'
  | 'registration_number'
  | 'tax_id'
  | 'website'
  | 'industry'
  | 'primary_email'
  | 'primary_phone'
  | 'status'
  | 'default_terms_conditions'
  | 'logo'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type companiesCreationAttributes = Optional<
  companiesAttributes,
  companiesOptionalAttributes
>;

export class companies
  extends Model<companiesAttributes, companiesCreationAttributes>
  implements companiesAttributes
{
  id!: number;
  name!: string;
  company_prefix?: string;
  legal_name?: string;
  registration_number?: string;
  tax_id?: string;
  website?: string;
  industry?: string;
  primary_email?: string;
  primary_phone?: string;
  status?: string;
  default_terms_conditions?: string;
  logo?: Buffer;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof companies {
    return companies.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        company_prefix: {
          type: DataTypes.STRING(10),
          allowNull: false,
          defaultValue: '',
          unique: true,
          validate: {
            len: [1, 10],
            is: /^[A-Z0-9]+$/,
          },
        },
        legal_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        registration_number: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        tax_id: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        website: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        industry: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        primary_email: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        primary_phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        status: {
          type: DataTypes.STRING(50),
          allowNull: true,
          defaultValue: 'active',
        },
        default_terms_conditions: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        logo: {
          type: DataTypes.BLOB('medium'),
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
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'companies',
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
            name: 'companies_name',
            using: 'BTREE',
            fields: [{ name: 'name' }],
          },
          {
            name: 'idx_company_prefix',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'company_prefix' }],
          },
        ],
      },
    );
  }
}
