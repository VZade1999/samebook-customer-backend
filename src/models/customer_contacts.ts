import * as Sequelize from 'sequelize';

import {
  DataTypes,
  Model,
  Optional,
} from 'sequelize';

export interface customer_contactsAttributes {
  id: number;

  customer_id: number;

  first_name: string;

  last_name?: string;

  email?: string;

  phone?: string;

  department?: string;

  designation?: string;

  is_primary?: number;

  is_active?: number;

  notes?: string;

  created_at?: Date;

  updated_at?: Date;
}

export type customer_contactsPk =
  'id';

export type customer_contactsId =
  customer_contacts[customer_contactsPk];

export type customer_contactsOptionalAttributes =
  | 'id'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'department'
  | 'designation'
  | 'is_primary'
  | 'is_active'
  | 'notes'
  | 'created_at'
  | 'updated_at';

export type customer_contactsCreationAttributes =
  Optional<
    customer_contactsAttributes,
    customer_contactsOptionalAttributes
  >;

export class customer_contacts
  extends Model<
    customer_contactsAttributes,
    customer_contactsCreationAttributes
  >
  implements customer_contactsAttributes
{
  id!: number;

  customer_id!: number;

  first_name!: string;

  last_name?: string;

  email?: string;

  phone?: string;

  department?: string;

  designation?: string;

  is_primary?: number;

  is_active?: number;

  notes?: string;

  created_at?: Date;

  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof customer_contacts {
    return customer_contacts.init(
      {
        id: {
          autoIncrement: true,

          type: DataTypes.BIGINT,

          allowNull: false,

          primaryKey: true,
        },

        customer_id: {
          type: DataTypes.BIGINT,

          allowNull: false,
        },

        first_name: {
          type: DataTypes.STRING(
            100,
          ),

          allowNull: false,
        },

        last_name: {
          type: DataTypes.STRING(
            100,
          ),

          allowNull: true,
        },

        email: {
          type: DataTypes.STRING(
            255,
          ),

          allowNull: true,
        },

        phone: {
          type: DataTypes.STRING(
            50,
          ),

          allowNull: true,
        },

        department: {
          type: DataTypes.STRING(
            100,
          ),

          allowNull: true,
        },

        designation: {
          type: DataTypes.STRING(
            100,
          ),

          allowNull: true,
        },

        is_primary: {
          type: DataTypes.TINYINT,

          allowNull: true,

          defaultValue: 0,
        },

        is_active: {
          type: DataTypes.TINYINT,

          allowNull: true,

          defaultValue: 1,
        },

        notes: {
          type: DataTypes.TEXT,

          allowNull: true,
        },

        created_at: {
          type: DataTypes.DATE,

          allowNull: true,

          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },

        updated_at: {
          type: DataTypes.DATE,

          allowNull: false,

          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },
      },

      {
        sequelize,

        tableName:
          'customer_contacts',

        underscored: true,

        timestamps: false,

        indexes: [
          {
            name: 'PRIMARY',

            unique: true,

            using: 'BTREE',

            fields: [
              { name: 'id' },
            ],
          },

          {
            name: 'customer_id',

            using: 'BTREE',

            fields: [
              {
                name: 'customer_id',
              },
            ],
          },
        ],
      },
    );
  }
}