import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface invoicePaymentsAttributes {
  id: number;
  invoice_id: number;
  payment_date: Date;
  payment_amount: number;
  payment_mode: string;
  transaction_reference?: string;
  remarks?: string;
  received_by?: number;
  created_at?: Date;
}

export type invoicePaymentsCreationAttributes =
  Optional<
    invoicePaymentsAttributes,
    'id' | 'transaction_reference' | 'remarks' | 'received_by' | 'created_at'
  >;

export class invoice_payments
  extends Model<
    invoicePaymentsAttributes,
    invoicePaymentsCreationAttributes
  >
  implements invoicePaymentsAttributes
{
  id!: number;
  invoice_id!: number;
  payment_date!: Date;
  payment_amount!: number;
  payment_mode!: string;

  transaction_reference?: string;
  remarks?: string;
  received_by?: number;
  created_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof invoice_payments {
    return invoice_payments.init(
      {
        id: {
          autoIncrement: true,
          primaryKey: true,
          type: DataTypes.BIGINT,
        },

        invoice_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },

        payment_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },

        payment_amount: {
          type: DataTypes.DECIMAL(15, 2),
          allowNull: false,
        },

        payment_mode: {
          type: DataTypes.ENUM(
            'CASH',
            'BANK_TRANSFER',
            'CHEQUE',
            'UPI',
            'CARD',
          ),
          allowNull: false,
        },

        transaction_reference:
          DataTypes.STRING(255),

        remarks: DataTypes.TEXT,

        received_by: DataTypes.BIGINT,

        created_at: {
          type: DataTypes.DATE,
          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },
      },
      {
        sequelize,
        tableName: 'invoice_payments',
        timestamps: false,
        underscored: true,
      },
    );
  }
}