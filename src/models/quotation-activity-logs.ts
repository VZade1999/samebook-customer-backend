import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';

export interface quotationActivityLogsAttributes {
  id: number;
  quotation_id: number;
  action: string;
  old_value?: object;
  new_value?: object;
  changed_by?: number;
  created_at?: Date;
}

export type quotationActivityLogsOptionalAttributes =
  | 'id'
  | 'old_value'
  | 'new_value'
  | 'changed_by'
  | 'created_at';

export type quotationActivityLogsCreationAttributes = Optional<
  quotationActivityLogsAttributes,
  quotationActivityLogsOptionalAttributes
>;

export class quotation_activity_logs
  extends Model<
    quotationActivityLogsAttributes,
    quotationActivityLogsCreationAttributes
  >
  implements quotationActivityLogsAttributes
{
  id!: number;
  quotation_id!: number;
  action!: string;
  old_value?: object;
  new_value?: object;
  changed_by?: number;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof quotation_activity_logs {
    return quotation_activity_logs.init(
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
        tableName: 'quotation_activity_logs',
        underscored: true,
        timestamps: false,
      },
    );
  }
}
