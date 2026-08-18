import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface usersAttributes {
  id: number;
  company_id: number;
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  password: string;
  is_active?: number;
  last_login?: Date;
  date_of_birth?: string;
  gender?: string;
  marital_status?: string;
  blood_group?: string;
  permanent_address?: string;
  aadhar_no?: string;
  pan_no?: string;
  emergency_contact?: string;
  bank_name?: string;
  branch_name?: string;
  account_number?: string;
  account_type?: string;
  ifsc_code?: string;
  micr_code?: string;
  salary_payment_mode?: string;
  avatar?: Buffer;
  created_at?: Date;
  updated_at?: Date;
}

export type usersPk = 'id';
export type usersId = users[usersPk];

export type usersOptionalAttributes =
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'is_active'
  | 'last_login'
  | 'date_of_birth'
  | 'gender'
  | 'marital_status'
  | 'blood_group'
  | 'permanent_address'
  | 'aadhar_no'
  | 'pan_no'
  | 'emergency_contact'
  | 'bank_name'
  | 'branch_name'
  | 'account_number'
  | 'account_type'
  | 'ifsc_code'
  | 'micr_code'
  | 'salary_payment_mode'
  | 'avatar'
  | 'created_at'
  | 'updated_at';

export type usersCreationAttributes = Optional<
  usersAttributes,
  usersOptionalAttributes
>;

export class users
  extends Model<usersAttributes, usersCreationAttributes>
  implements usersAttributes
{
  id!: number;
  company_id!: number;
  first_name?: string;
  last_name?: string;
  email!: string;
  phone?: string;
  password!: string;
  is_active?: number;
  last_login?: Date;
  date_of_birth?: string;
  gender?: string;
  marital_status?: string;
  blood_group?: string;
  permanent_address?: string;
  aadhar_no?: string;
  pan_no?: string;
  emergency_contact?: string;
  bank_name?: string;
  branch_name?: string;
  account_number?: string;
  account_type?: string;
  ifsc_code?: string;
  micr_code?: string;
  salary_payment_mode?: string;
  avatar?: Buffer;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof users {
    return users.init(
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
          references: {
            model: 'companies',
            key: 'id',
          },
        },

        first_name: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        last_name: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },

        email: {
          type: DataTypes.STRING(255),
          allowNull: false,
          unique: true,
        },

        phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },

        password: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },

        is_active: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
        },

        last_login: {
          type: DataTypes.DATE,
          allowNull: true,
        },

        date_of_birth: {
          type: DataTypes.DATEONLY,
          allowNull: true,
        },

        gender: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        marital_status: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        blood_group: {
          type: DataTypes.STRING(10),
          allowNull: true,
        },

        permanent_address: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        aadhar_no: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        pan_no: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        emergency_contact: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },

        bank_name: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },

        branch_name: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },

        account_number: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },

        account_type: {
          type: DataTypes.STRING(30),
          allowNull: true,
        },

        ifsc_code: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        micr_code: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },

        salary_payment_mode: {
          type: DataTypes.STRING(30),
          allowNull: true,
        },

        avatar: {
          type: DataTypes.BLOB('long'),
          allowNull: true,
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },

        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'users',

        timestamps: false, // important (you already handle manually)

        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },
          {
            name: 'email',
            unique: true,
            fields: [{ name: 'email' }],
          },
          {
            name: 'company_id',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
