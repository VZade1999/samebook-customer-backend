import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface role_permissionsAttributes {
  id: number;
  role_id: number;
  permission_id: number;
  created_at?: Date;
}

export type role_permissionsPk = 'id';
export type role_permissionsId = role_permissions[role_permissionsPk];

export type role_permissionsOptionalAttributes = 'id' | 'created_at';

export type role_permissionsCreationAttributes = Optional<
  role_permissionsAttributes,
  role_permissionsOptionalAttributes
>;

export class role_permissions
  extends Model<role_permissionsAttributes, role_permissionsCreationAttributes>
  implements role_permissionsAttributes
{
  id!: number;
  role_id!: number;
  permission_id!: number;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof role_permissions {
    return role_permissions.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        role_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          references: {
            model: 'roles',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },

        permission_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
          references: {
            model: 'permissions',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'role_permissions',

        timestamps: false,

        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },

          {
            name: 'role_id',
            using: 'BTREE',
            fields: [{ name: 'role_id' }],
          },

          {
            name: 'permission_id',
            using: 'BTREE',
            fields: [{ name: 'permission_id' }],
          },
        ],
      },
    );
  }
}
