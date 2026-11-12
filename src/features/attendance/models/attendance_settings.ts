import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface attendance_settingsAttributes {
  id: number;
  company_id: number;
  timezone: string;
  shift_start: string;
  shift_end: string;
  grace_minutes: number;
  half_day_minutes: number;
  full_day_minutes: number;
  weekly_offs: string;
  updated_by?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type attendance_settingsPk = 'id';
export type attendance_settingsId = attendance_settings[attendance_settingsPk];
export type attendance_settingsOptionalAttributes =
  | 'id'
  | 'timezone'
  | 'shift_start'
  | 'shift_end'
  | 'grace_minutes'
  | 'half_day_minutes'
  | 'full_day_minutes'
  | 'weekly_offs'
  | 'updated_by'
  | 'created_at'
  | 'updated_at';
export type attendance_settingsCreationAttributes = Optional<
  attendance_settingsAttributes,
  attendance_settingsOptionalAttributes
>;

export class attendance_settings
  extends Model<attendance_settingsAttributes, attendance_settingsCreationAttributes>
  implements attendance_settingsAttributes
{
  id!: number;
  company_id!: number;
  timezone!: string;
  shift_start!: string;
  shift_end!: string;
  grace_minutes!: number;
  half_day_minutes!: number;
  full_day_minutes!: number;
  weekly_offs!: string;
  updated_by?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof attendance_settings {
    return attendance_settings.init(
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
          unique: 'uq_attendance_settings_company_id',
        },
        timezone: {
          type: DataTypes.STRING(64),
          allowNull: false,
          defaultValue: 'Asia/Kolkata',
        },
        shift_start: {
          type: DataTypes.TIME,
          allowNull: false,
          defaultValue: '09:30:00',
        },
        shift_end: {
          type: DataTypes.TIME,
          allowNull: false,
          defaultValue: '18:30:00',
        },
        grace_minutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 15,
        },
        half_day_minutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 240,
        },
        full_day_minutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 480,
        },
        weekly_offs: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: '0',
        },
        updated_by: {
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
        tableName: 'attendance_settings',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          {
            name: 'uq_attendance_settings_company_id',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
          { name: 'updated_by', using: 'BTREE', fields: [{ name: 'updated_by' }] },
        ],
      },
    );
  }
}
