import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface attendance_holidaysAttributes {
  id: number;
  company_id: number;
  holiday_date: string;
  name: string;
  created_by?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type attendance_holidaysPk = 'id';
export type attendance_holidaysId = attendance_holidays[attendance_holidaysPk];
export type attendance_holidaysOptionalAttributes =
  | 'id'
  | 'created_by'
  | 'created_at'
  | 'updated_at';
export type attendance_holidaysCreationAttributes = Optional<
  attendance_holidaysAttributes,
  attendance_holidaysOptionalAttributes
>;

export class attendance_holidays
  extends Model<attendance_holidaysAttributes, attendance_holidaysCreationAttributes>
  implements attendance_holidaysAttributes
{
  id!: number;
  company_id!: number;
  holiday_date!: string;
  name!: string;
  created_by?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof attendance_holidays {
    return attendance_holidays.init(
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
        holiday_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        created_by: {
          type: DataTypes.BIGINT,
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
        tableName: 'attendance_holidays',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          {
            name: 'uq_attendance_holidays_company_date',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'holiday_date' }],
          },
          {
            name: 'company_id_holiday_date',
            using: 'BTREE',
            fields: [{ name: 'company_id' }, { name: 'holiday_date' }],
          },
          { name: 'created_by', using: 'BTREE', fields: [{ name: 'created_by' }] },
        ],
      },
    );
  }
}
