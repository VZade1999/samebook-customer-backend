import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';
import { CUSTOMER_ADDRESS_TYPE } from 'src/customers/customer-address.enum';

export interface customer_addressesAttributes {
  id: number;

  customer_id: number;

  address_type: CUSTOMER_ADDRESS_TYPE;

  label?: string;

  contact_person_name?: string;

  contact_person_phone?: string;

  gst_number?: string;

  address_line_1: string;

  address_line_2?: string;

  city?: string;

  state?: string;

  country?: string;

  postal_code?: string;

  is_primary?: number;

  is_active?: number;

  notes?: string;

  created_at?: Date;

  updated_at?: Date;
}

export type customer_addressesPk = 'id';

export type customer_addressesId = customer_addresses[customer_addressesPk];

export type customer_addressesOptionalAttributes =
  | 'id'
  | 'address_type' // ← add
  | 'label'
  | 'contact_person_name'
  | 'contact_person_phone'
  | 'gst_number'
  | 'address_line_1' // ← add
  | 'address_line_2' // ← add
  | 'city' // ← add
  | 'state' // ← add
  | 'country' // ← add
  | 'postal_code' // ← add
  | 'is_primary'
  | 'is_active'
  | 'notes'
  | 'created_at'
  | 'updated_at';

export type customer_addressesCreationAttributes = Optional<
  customer_addressesAttributes,
  customer_addressesOptionalAttributes
>;

export class customer_addresses
  extends Model<
    customer_addressesAttributes,
    customer_addressesCreationAttributes
  >
  implements customer_addressesAttributes
{
  id!: number;

  customer_id!: number;

  address_type!: CUSTOMER_ADDRESS_TYPE;

  label?: string;

  contact_person_name?: string;

  contact_person_phone?: string;

  gst_number?: string;

  address_line_1!: string;

  address_line_2?: string;

  city?: string;

  state?: string;

  country?: string;

  postal_code?: string;

  is_primary?: number;

  is_active?: number;

  notes?: string;

  created_at?: Date;

  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof customer_addresses {
    return customer_addresses.init(
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

        address_type: {
          type: DataTypes.ENUM(
            CUSTOMER_ADDRESS_TYPE.BILLING,
            CUSTOMER_ADDRESS_TYPE.SHIPPING,
            CUSTOMER_ADDRESS_TYPE.OFFICE,
            CUSTOMER_ADDRESS_TYPE.WAREHOUSE,
            CUSTOMER_ADDRESS_TYPE.FACTORY,
            CUSTOMER_ADDRESS_TYPE.BRANCH,
            CUSTOMER_ADDRESS_TYPE.OTHER,
          ),

          allowNull: false,

          defaultValue: 'OTHER',
        },

        label: {
          type: DataTypes.STRING(255),

          allowNull: true,
        },

        contact_person_name: {
          type: DataTypes.STRING(255),

          allowNull: true,
        },

        contact_person_phone: {
          type: DataTypes.STRING(50),

          allowNull: true,
        },

        gst_number: {
          type: DataTypes.STRING(100),

          allowNull: true,
        },

        address_line_1: {
          type: DataTypes.STRING(255),

          allowNull: false,
        },

        address_line_2: {
          type: DataTypes.STRING(255),

          allowNull: true,
        },

        city: {
          type: DataTypes.STRING(100),

          allowNull: true,
        },

        state: {
          type: DataTypes.STRING(100),

          allowNull: true,
        },

        country: {
          type: DataTypes.STRING(100),

          allowNull: true,
        },

        postal_code: {
          type: DataTypes.STRING(20),

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

        tableName: 'customer_addresses',

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
