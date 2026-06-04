import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface permissionsAttributes {
  id: number;
  name: string;
  description?: string;
  created_at?: Date;
}

export type permissionsPk = 'id';
export type permissionsId = permissions[permissionsPk];

export type permissionsOptionalAttributes = 'id' | 'description' | 'created_at';

export type permissionsCreationAttributes = Optional<
  permissionsAttributes,
  permissionsOptionalAttributes
>;

export class permissions
  extends Model<permissionsAttributes, permissionsCreationAttributes>
  implements permissionsAttributes
{
  id!: number;
  name!: string;
  description?: string;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof permissions {
    return permissions.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
          unique: true,
        },

        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'permissions',

        timestamps: false,

        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },

          {
            name: 'name',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'name' }],
          },
        ],
      },
    );
  }
}
