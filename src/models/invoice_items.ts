import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';


export interface invoiceItemsAttributes {
  id: number;

  invoice_id: number;

  product_name: string;

  description?: string;

  hsn_code?: string;

  qty?: number;

  unit?: string;

  rate?: number;

  discount_percent?: number;

  discount_amount?: number;

  discounted_rate?: number;

  total?: number;

  created_at?: Date;
}

export type invoiceItemsOptionalAttributes =
  | 'id'
  | 'description'
  | 'hsn_code'
  | 'qty'
  | 'unit'
  | 'rate'
  | 'discount_percent'
  | 'discount_amount'
  | 'discounted_rate'
  | 'total'
  | 'created_at';

export type invoiceItemsCreationAttributes =
  Optional<
    invoiceItemsAttributes,
    invoiceItemsOptionalAttributes
  >;

export class invoice_items
  extends Model<
    invoiceItemsAttributes,
    invoiceItemsCreationAttributes
  >
  implements invoiceItemsAttributes
{
  id!: number;

  invoice_id!: number;

  product_name!: string;

  description?: string;

  hsn_code?: string;

  qty?: number;

  unit?: string;

  rate?: number;

  discount_percent?: number;

  discount_amount?: number;

  discounted_rate?: number;

  total?: number;

  created_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof invoice_items {
    return invoice_items.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },

        invoice_id: {
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

        discount_percent: {
          type: DataTypes.DECIMAL(5, 2),
          allowNull: true,
          defaultValue: 0.0,
        },

        discount_amount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },

        discounted_rate: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
        },

        total: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0.0,
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

        tableName: 'invoice_items',

        underscored: true,

        timestamps: false,
      },
    );
  }
}