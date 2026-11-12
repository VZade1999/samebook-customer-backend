import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface company_modulesAttributes {
  id: number;
  company_id: number;
  module_key: string;
  enabled: number;
  plan: string;
  enabled_by?: number | null;
  enabled_at?: Date | null;
  disabled_by?: number | null;
  disabled_at?: Date | null;
  expires_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export type company_modulesPk = 'id';
export type company_modulesId = company_modules[company_modulesPk];
export type company_modulesOptionalAttributes =
  | 'id'
  | 'enabled'
  | 'plan'
  | 'enabled_by'
  | 'enabled_at'
  | 'disabled_by'
  | 'disabled_at'
  | 'expires_at'
  | 'created_at'
  | 'updated_at';
export type company_modulesCreationAttributes = Optional<
  company_modulesAttributes,
  company_modulesOptionalAttributes
>;

export class company_modules
  extends Model<company_modulesAttributes, company_modulesCreationAttributes>
  implements company_modulesAttributes
{
  id!: number;
  company_id!: number;
  module_key!: string;
  enabled!: number;
  plan!: string;
  enabled_by?: number | null;
  enabled_at?: Date | null;
  disabled_by?: number | null;
  disabled_at?: Date | null;
  expires_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof company_modules {
    return company_modules.init(
      {
        id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
        company_id: { type: DataTypes.BIGINT, allowNull: false },
        module_key: { type: DataTypes.STRING(50), allowNull: false },
        enabled: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
        plan: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'FREE' },
        enabled_by: { type: DataTypes.BIGINT, allowNull: true },
        enabled_at: { type: DataTypes.DATE, allowNull: true },
        disabled_by: { type: DataTypes.BIGINT, allowNull: true },
        disabled_at: { type: DataTypes.DATE, allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: true },
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
        tableName: 'company_modules',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          {
            name: 'uq_company_modules_company_module',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'module_key' }],
          },
        ],
      },
    );
  }
}
