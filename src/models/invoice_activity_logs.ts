import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';

export interface invoiceActivityLogsAttributes {
  id: number;
  invoice_id: number;
  action: string;
  old_value?: object;
  new_value?: object;
  changed_by?: number;
  created_at?: Date;
}

export type invoiceActivityLogsOptionalAttributes =
  | 'id'
  | 'old_value'
  | 'new_value'
  | 'changed_by'
  | 'created_at';

export type invoiceActivityLogsCreationAttributes = Optional<
  invoiceActivityLogsAttributes,
  invoiceActivityLogsOptionalAttributes
>;

export class invoice_activity_logs
  extends Model<
    invoiceActivityLogsAttributes,
    invoiceActivityLogsCreationAttributes
  >
  implements invoiceActivityLogsAttributes
{
  id!: number;
  invoice_id!: number;
  action!: string;
  old_value?: object;
  new_value?: object;
  changed_by?: number;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof invoice_activity_logs {
    return invoice_activity_logs.init(
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
        action: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        old_value: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        new_value: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        changed_by: {
          type: DataTypes.BIGINT,
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
        tableName: 'invoice_activity_logs',
        underscored: true,
        timestamps: false,
      },
    );
  }
}
