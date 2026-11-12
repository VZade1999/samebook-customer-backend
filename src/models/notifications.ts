import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

// In-app notifications (header bell). Generic: any module can write one;
// `module` lets the API hide notifications of add-ons that are switched off.
export class notifications extends Model<any, any> {
  static initModel(sequelize: Sequelize.Sequelize): typeof notifications {
    return notifications.init(
      {
        id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
        company_id: { type: DataTypes.BIGINT, allowNull: false },
        user_id: { type: DataTypes.BIGINT, allowNull: false },
        module: { type: DataTypes.STRING(30), allowNull: true },
        type: { type: DataTypes.STRING(40), allowNull: false },
        title: { type: DataTypes.STRING(200), allowNull: false },
        body: { type: DataTypes.STRING(500), allowNull: true },
        link: { type: DataTypes.STRING(255), allowNull: true },
        entity_type: { type: DataTypes.STRING(30), allowNull: true },
        entity_id: { type: DataTypes.BIGINT, allowNull: true },
        actor_id: { type: DataTypes.BIGINT, allowNull: true },
        is_read: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
        read_at: { type: DataTypes.DATE, allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      { sequelize, tableName: 'notifications', underscored: true, timestamps: false },
    );
  }
}
