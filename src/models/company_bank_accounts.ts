import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface company_bank_accountsAttributes {
  id: number;
  company_id: number;
  bank_name?: string;
  account_holder_name?: string;
  account_number?: string;
  ifsc_code?: string;
  branch_name?: string;
  branch_address?: string;
  account_type?: string;
  notes?: string;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type company_bank_accountsPk = 'id';
export type company_bank_accountsId = company_bank_accounts[company_bank_accountsPk];
export type company_bank_accountsOptionalAttributes =
  | 'id'
  | 'bank_name'
  | 'account_holder_name'
  | 'account_number'
  | 'ifsc_code'
  | 'branch_name'
  | 'branch_address'
  | 'account_type'
  | 'notes'
  | 'is_default'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type company_bank_accountsCreationAttributes = Optional<
  company_bank_accountsAttributes,
  company_bank_accountsOptionalAttributes
>;

export class company_bank_accounts
  extends Model<company_bank_accountsAttributes, company_bank_accountsCreationAttributes>
  implements company_bank_accountsAttributes
{
  id!: number;
  company_id!: number;
  bank_name?: string;
  account_holder_name?: string;
  account_number?: string;
  ifsc_code?: string;
  branch_name?: string;
  branch_address?: string;
  account_type?: string;
  notes?: string;
  is_default?: number;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof company_bank_accounts {
    return company_bank_accounts.init(
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
        bank_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        account_holder_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        account_number: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        ifsc_code: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        branch_name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        branch_address: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        account_type: {
          type: DataTypes.STRING(100),
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
        tableName: 'company_bank_accounts',
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
            name: 'company_bank_accounts_company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
