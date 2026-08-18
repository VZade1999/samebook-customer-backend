import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface warehousesAttributes {
  id: number;
  company_id: number;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type warehousesPk = 'id';
export type warehousesId = warehouses[warehousesPk];
export type warehousesOptionalAttributes =
  | 'id'
  | 'address'
  | 'city'
  | 'state'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type warehousesCreationAttributes = Optional<
  warehousesAttributes,
  warehousesOptionalAttributes
>;

export class warehouses
  extends Model<warehousesAttributes, warehousesCreationAttributes>
  implements warehousesAttributes
{
  id!: number;
  company_id!: number;
  name!: string;
  address?: string;
  city?: string;
  state?: string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof warehouses {
    return warehouses.init(
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
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        address: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        city: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        state: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        is_active: {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: 1,
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
        tableName: 'warehouses',
        underscored: true,
        timestamps: false,
        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },
          {
            name: 'company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
