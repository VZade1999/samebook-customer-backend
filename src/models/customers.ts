import * as Sequelize from 'sequelize';

import {
  DataTypes,
  Model,
  Optional,
} from 'sequelize';

export interface customersAttributes {
  id: number;

  company_id: number;

  customer_type:
    | 'INDIVIDUAL'
    | 'BUSINESS';

  display_name: string;

  company_name?: string;

  gst_number?: string;

  email?: string;

  phone?: string;

  website?: string;

  industry?: string;

  is_active?: number;

  notes?: string;

  created_by?: number;

  updated_by?: number;

  created_at?: Date;

  updated_at?: Date;
}

export type customersPk = 'id';

export type customersId =
  customers[customersPk];

export type customersOptionalAttributes =
  | 'id'
  | 'company_name'
  | 'gst_number'
  | 'email'
  | 'phone'
  | 'website'
  | 'industry'
  | 'is_active'
  | 'notes'
  | 'created_by'
  | 'updated_by'
  | 'created_at'
  | 'updated_at';

export type customersCreationAttributes =
  Optional<
    customersAttributes,
    customersOptionalAttributes
  >;

export class customers
  extends Model<
    customersAttributes,
    customersCreationAttributes
  >
  implements customersAttributes
{
  id!: number;

  company_id!: number;

  customer_type!:
    | 'INDIVIDUAL'
    | 'BUSINESS';

  display_name!: string;

  company_name?: string;

  gst_number?: string;

  email?: string;

  phone?: string;

  website?: string;

  industry?: string;

  is_active?: number;

  notes?: string;

  created_by?: number;

  updated_by?: number;

  created_at?: Date;

  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof customers {
    return customers.init(
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
        },

        customer_type: {
          type: DataTypes.ENUM(
            'INDIVIDUAL',
            'BUSINESS',
          ),

          allowNull: false,

          defaultValue:
            'INDIVIDUAL',
        },

        display_name: {
          type: DataTypes.STRING(
            255,
          ),

          allowNull: false,
        },

        company_name: {
          type: DataTypes.STRING(
            255,
          ),

          allowNull: true,
        },

        gst_number: {
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

        website: {
          type: DataTypes.STRING(
            255,
          ),

          allowNull: true,
        },

        industry: {
          type: DataTypes.STRING(
            100,
          ),

          allowNull: true,
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

        created_by: {
          type: DataTypes.BIGINT,

          allowNull: true,
        },

        updated_by: {
          type: DataTypes.BIGINT,

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

        tableName: 'customers',

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
            name: 'company_id',

            using: 'BTREE',

            fields: [
              {
                name: 'company_id',
              },
            ],
          },

          {
            name: 'display_name',

            using: 'BTREE',

            fields: [
              {
                name: 'display_name',
              },
            ],
          },

          {
            name: 'email',

            using: 'BTREE',

            fields: [
              {
                name: 'email',
              },
            ],
          },

          {
            name: 'phone',

            using: 'BTREE',

            fields: [
              {
                name: 'phone',
              },
            ],
          },
        ],
      },
    );
  }
}