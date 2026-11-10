import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface delivery_challan_activity_logsAttributes {
  id: number;
  delivery_challan_id: number;
  action: string;
  old_value?: object | null;
  new_value?: object | null;
  changed_by?: number;
  created_at?: Date;
}

export type delivery_challan_activity_logsOptionalAttributes =
  | 'id'
  | 'old_value'
  | 'new_value'
  | 'changed_by'
  | 'created_at';
export type delivery_challan_activity_logsCreationAttributes = Optional<
  delivery_challan_activity_logsAttributes,
  delivery_challan_activity_logsOptionalAttributes
>;

export class delivery_challan_activity_logs
  extends Model<
    delivery_challan_activity_logsAttributes,
    delivery_challan_activity_logsCreationAttributes
  >
  implements delivery_challan_activity_logsAttributes
{
  id!: number;
  delivery_challan_id!: number;
  action!: string;
  old_value?: object | null;
  new_value?: object | null;
  changed_by?: number;
  created_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof delivery_challan_activity_logs {
    return delivery_challan_activity_logs.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        delivery_challan_id: { type: DataTypes.BIGINT, allowNull: false },
        action: { type: DataTypes.STRING(32), allowNull: false },
        old_value: { type: DataTypes.JSON, allowNull: true },
        new_value: { type: DataTypes.JSON, allowNull: true },
        changed_by: { type: DataTypes.BIGINT, allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'delivery_challan_activity_logs',
        underscored: true,
        timestamps: false,
      },
    );
  }
}
