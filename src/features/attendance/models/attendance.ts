import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface attendanceAttributes {
  id: number;
  user_id: number;
  company_id: number;
  punch_in: Date;
  punch_out?: Date;
  work_date: string;
  total_minutes?: number;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
}

export type attendancePk = 'id';
export type attendanceId = attendance[attendancePk];
export type attendanceOptionalAttributes =
  | 'id'
  | 'punch_out'
  | 'total_minutes'
  | 'notes'
  | 'created_at'
  | 'updated_at';
export type attendanceCreationAttributes = Optional<
  attendanceAttributes,
  attendanceOptionalAttributes
>;

export class attendance
  extends Model<attendanceAttributes, attendanceCreationAttributes>
  implements attendanceAttributes
{
  id!: number;
  user_id!: number;
  company_id!: number;
  punch_in!: Date;
  punch_out?: Date;
  work_date!: string;
  total_minutes?: number;
  notes?: string;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof attendance {
    return attendance.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        user_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        company_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        punch_in: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        punch_out: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        work_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        total_minutes: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        notes: {
          type: DataTypes.STRING(255),
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
        tableName: 'attendance',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          { name: 'user_id', using: 'BTREE', fields: [{ name: 'user_id' }] },
          { name: 'company_id', using: 'BTREE', fields: [{ name: 'company_id' }] },
          { name: 'work_date', using: 'BTREE', fields: [{ name: 'work_date' }] },
          {
            name: 'user_id_work_date',
            using: 'BTREE',
            fields: [{ name: 'user_id' }, { name: 'work_date' }],
          },
        ],
      },
    );
  }
}
