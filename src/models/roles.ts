import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface rolesAttributes {
  id: number;
  company_id?: number;
  name: string;
  description?: string;
  /** 1 = Admin (top of a company) … 5 = view only; 0 = platform (Super Admin). */
  level?: number;
  /** PLATFORM (Super Admin) or COMPANY. */
  scope?: string;
  is_system?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type rolesPk = 'id';
export type rolesId = roles[rolesPk];

export type rolesOptionalAttributes =
  | 'id'
  | 'company_id'
  | 'description'
  | 'level'
  | 'scope'
  | 'is_system'
  | 'created_at'
  | 'updated_at';

export type rolesCreationAttributes = Optional<
  rolesAttributes,
  rolesOptionalAttributes
>;

export class roles
  extends Model<rolesAttributes, rolesCreationAttributes>
  implements rolesAttributes
{
  id!: number;
  company_id?: number;
  name!: string;
  description?: string;
  level?: number;
  scope?: string;
  is_system?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof roles {
    return roles.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        company_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: 'companies',
            key: 'id',
          },
        },

        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },

        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        level: {
          type: DataTypes.TINYINT,
          allowNull: false,
          defaultValue: 4,
        },

        scope: {
          type: DataTypes.STRING(10),
          allowNull: false,
          defaultValue: 'COMPANY',
        },

        is_system: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 0,
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
        tableName: 'roles',

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
        ],
      },
    );
  }
}
