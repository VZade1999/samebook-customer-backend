import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface company_locationsAttributes {
  id: number;
  company_id: number;
  name?: string;
  location_type?: string;
  address_id?: number | null; 
  manager_name?: string;
  manager_phone?: string;
  capacity?: string;
  operational_hours?: string;
  address_line_1?: string;
  address_line_2?: string;
  address_city?: string;
  address_state?: string;
  address_country?: string;
  address_postal_code?: string;
  notes?: string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;
}

export type company_locationsPk = 'id';
export type company_locationsId = company_locations[company_locationsPk];
export type company_locationsOptionalAttributes =
  | 'id'
  | 'name'
  | 'location_type'
  | 'address_id'
  | 'manager_name'
  | 'manager_phone'
  | 'capacity'
  | 'operational_hours'
  | 'address_line_1'
  | 'address_line_2'
  | 'address_city'
  | 'address_state'
  | 'address_country'
  | 'address_postal_code'
  | 'notes'
  | 'is_active'
  | 'created_at'
  | 'updated_at';
export type company_locationsCreationAttributes = Optional<
  company_locationsAttributes,
  company_locationsOptionalAttributes
>;

export class company_locations
  extends Model<company_locationsAttributes, company_locationsCreationAttributes>
  implements company_locationsAttributes
{
  id!: number;
  company_id!: number;
  name?: string;
  location_type?: string;
  address_id?: number;
  manager_name?: string;
  manager_phone?: string;
  capacity?: string;
  operational_hours?: string;
  notes?: string;
  is_active?: number;
  created_at?: Date;
  updated_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof company_locations {
    return company_locations.init(
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
        name: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        location_type: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        address_id: {
          type: DataTypes.BIGINT,
          allowNull: true,
          references: {
            model: 'company_addresses',
            key: 'id',
          },
        },
        manager_name: {
          type: DataTypes.STRING(150),
          allowNull: true,
        },
        manager_phone: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        capacity: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        operational_hours: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        address_line_1: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        address_line_2: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        address_city: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        address_state: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        address_country: {
          type: DataTypes.STRING(100),
          allowNull: true,
        },
        address_postal_code: {
          type: DataTypes.STRING(50),
          allowNull: true,
        },
        notes: {
          type: DataTypes.TEXT,
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
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'company_locations',
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
            name: 'company_locations_company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
          {
            name: 'company_locations_address_id',
            using: 'BTREE',
            fields: [{ name: 'address_id' }],
          },
        ],
      },
    );
  }
}
