import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface leave_requestsAttributes {
  id: number;
  user_id: number;
  company_id: number;
  from_date: string;
  to_date: string;
  reason: string;
  status: string;
  reviewed_by?: number;
  reviewed_at?: Date;
  review_note?: string;
  created_at?: Date;
  updated_at?: Date;
}

export type leave_requestsPk = 'id';
export type leave_requestsId = leave_requests[leave_requestsPk];
export type leave_requestsOptionalAttributes =
  | 'id'
  | 'status'
  | 'reviewed_by'
  | 'reviewed_at'
  | 'review_note'
  | 'created_at'
  | 'updated_at';
export type leave_requestsCreationAttributes = Optional<
  leave_requestsAttributes,
  leave_requestsOptionalAttributes
>;

export class leave_requests
  extends Model<leave_requestsAttributes, leave_requestsCreationAttributes>
  implements leave_requestsAttributes
{
  id!: number;
  user_id!: number;
  company_id!: number;
  from_date!: string;
  to_date!: string;
  reason!: string;
  status!: string;
  reviewed_by?: number;
  reviewed_at?: Date;
  review_note?: string;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof leave_requests {
    return leave_requests.init(
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
        from_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        to_date: {
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        reason: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: 'pending',
        },
        reviewed_by: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },
        reviewed_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        review_note: {
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
        tableName: 'leave_requests',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          { name: 'user_id', using: 'BTREE', fields: [{ name: 'user_id' }] },
          { name: 'company_id', using: 'BTREE', fields: [{ name: 'company_id' }] },
          { name: 'status', using: 'BTREE', fields: [{ name: 'status' }] },
        ],
      },
    );
  }
}
