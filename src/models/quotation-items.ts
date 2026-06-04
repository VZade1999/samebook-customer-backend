import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';

export interface quotationItemsAttributes {
  id: number;

  quotation_id: number;

  product_name: string;

  description?: string;

  hsn_code?: string;

  qty?: number;

  unit?: string;

  rate?: number;

  gst_percent?: number;

  discount_percent?: number;

  amount?: number;

  created_at?: Date;
}

export type quotationItemsOptionalAttributes =
  | 'id'
  | 'description'
  | 'hsn_code'
  | 'qty'
  | 'unit'
  | 'rate'
  | 'gst_percent'
  | 'discount_percent'
  | 'amount'
  | 'created_at';

export type quotationItemsCreationAttributes =
  Optional<
    quotationItemsAttributes,
    quotationItemsOptionalAttributes
  >;

export class quotation_items
  extends Model<
    quotationItemsAttributes,
    quotationItemsCreationAttributes
  >
  implements quotationItemsAttributes
{
  id!: number;

  quotation_id!: number;

  product_name!: string;

  description?: string;

  hsn_code?: string;

  qty?: number;

  unit?: string;

  rate?: number;

  gst_percent?: number;

  discount_percent?: number;

  amount?: number;

  created_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof quotation_items {
    return quotation_items.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        quotation_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        product_name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },

        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        hsn_code: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        qty: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 1,
        },

        unit: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },

        rate: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },

        gst_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0,
        },

        discount_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0,
        },

        amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },
      },

      {
        sequelize,

        tableName: 'quotation_items',

        underscored: true,

        timestamps: false,
      },
    );
  }
}