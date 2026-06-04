  import * as Sequelize from 'sequelize';

import { DataTypes, Model, Optional } from 'sequelize';

export interface quotationVersionsAttributes {
  id: number;

  quotation_id: number;

  version_number: number;

  quotation_snapshot: object;

  action_type?: string;

  changed_by?: number;

  change_reason?: string;

  created_at?: Date;
}

export type quotationVersionsOptionalAttributes =
  | 'id'
  | 'action_type'
  | 'changed_by'
  | 'change_reason'
  | 'created_at';

export type quotationVersionsCreationAttributes =
  Optional<
    quotationVersionsAttributes,
    quotationVersionsOptionalAttributes
  >;

export class quotation_versions
  extends Model<
    quotationVersionsAttributes,
    quotationVersionsCreationAttributes
  >
  implements quotationVersionsAttributes
{
  id!: number;

  quotation_id!: number;

  version_number!: number;

  quotation_snapshot!: object;

  action_type?: string;

  changed_by?: number;

  change_reason?: string;

  created_at?: Date;

  static initModel(
    sequelize: Sequelize.Sequelize,
  ): typeof quotation_versions {
    return quotation_versions.init(
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

        version_number: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },

        quotation_snapshot: {
          type: DataTypes.JSON,
          allowNull: false,
        },

        action_type: {
          type: DataTypes.ENUM(
            'CREATED',
            'UPDATED',
            'SENT',
            'APPROVED',
            'REJECTED',
          ),
          allowNull: true,
          defaultValue: 'UPDATED',
        },

        changed_by: {
          type: DataTypes.BIGINT,
          allowNull: true,
        },

        change_reason: {
          type: DataTypes.TEXT,
          allowNull: true,
        },

        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue:
            Sequelize.Sequelize.literal(
              'CURRENT_TIMESTAMP',
            ),
        },
      },

      {
        sequelize,

        tableName: 'quotation_versions',

        underscored: true,

        timestamps: false,
      },
    );
  }
}