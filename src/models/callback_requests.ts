import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface callback_requestsAttributes {
  id: number;
  name: string;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  email_sent: boolean;
  created_at?: Date;
}

export type callback_requestsPk = 'id';
export type callback_requestsId = callback_requests[callback_requestsPk];

export type callback_requestsOptionalAttributes =
  | 'id'
  | 'company_name'
  | 'phone'
  | 'email'
  | 'message'
  | 'email_sent'
  | 'created_at';

export type callback_requestsCreationAttributes = Optional<
  callback_requestsAttributes,
  callback_requestsOptionalAttributes
>;

export class callback_requests
  extends Model<callback_requestsAttributes, callback_requestsCreationAttributes>
  implements callback_requestsAttributes
{
  id!: number;
  name!: string;
  company_name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  email_sent!: boolean;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof callback_requests {
    return callback_requests.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        name: {
          type: DataTypes.STRING(150),
          allowNull: false,
        },
        company_name: {
          type: DataTypes.STRING(200),
          allowNull: true,
        },
        phone: {
          type: DataTypes.STRING(30),
          allowNull: true,
        },
        email: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        message: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        email_sent: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'callback_requests',
        timestamps: false,
        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },
        ],
      },
    );
  }
}
