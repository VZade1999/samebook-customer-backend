import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface user_rolesAttributes {
  id: number;
  user_id: number;
  role_id: number;
  created_at?: Date;
}

export type user_rolesPk = 'id';
export type user_rolesId = user_roles[user_rolesPk];

export type user_rolesOptionalAttributes = 'id' | 'created_at';

export type user_rolesCreationAttributes = Optional<
  user_rolesAttributes,
  user_rolesOptionalAttributes
>;

export class user_roles
  extends Model<user_rolesAttributes, user_rolesCreationAttributes>
  implements user_rolesAttributes
{
  id!: number;
  user_id!: number;
  role_id!: number;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof user_roles {
    return user_roles.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        user_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
        },

        role_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          references: {
            model: 'roles',
            key: 'id',
          },
          onDelete: 'CASCADE',
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'user_roles',

        timestamps: false,

        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },

          {
            name: 'user_id',
            using: 'BTREE',
            fields: [{ name: 'user_id' }],
          },

          {
            name: 'role_id',
            using: 'BTREE',
            fields: [{ name: 'role_id' }],
          },
        ],
      },
    );
  }
}
