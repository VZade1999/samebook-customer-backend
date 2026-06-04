import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface usersAttributes {
  id: number;
  company_id: number;
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  password: string;
  is_active?: number;
  last_login?: Date;
  created_at?: Date;
  updated_at?: Date;
}

export type usersPk = 'id';
export type usersId = users[usersPk];

export type usersOptionalAttributes =
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'is_active'
  | 'last_login'
  | 'created_at'
  | 'updated_at';

export type usersCreationAttributes = Optional<
  usersAttributes,
  usersOptionalAttributes
>;

export class users
  extends Model<usersAttributes, usersCreationAttributes>
  implements usersAttributes
{
  id!: number;
  company_id!: number;
  first_name?: string;
  last_name?: string;
  email!: string;
  phone?: string;
  password!: string;
  is_active?: number;
  last_login?: Date;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof users {
    return users.init(
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

        first_name: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        last_name: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        email: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true,
        },

        phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },

        password: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },

        is_active: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
        },

        last_login: {
          type: DataTypes.DATE,
          allowNull: true,
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
        tableName: 'users',

        timestamps: false, // important (you already handle manually)

        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },
          {
            name: 'email',
            unique: true,
            fields: [{ name: 'email' }],
          },
          {
            name: 'company_id',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
