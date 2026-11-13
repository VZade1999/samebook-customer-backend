import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

export class document_series extends Model<any, any> {}

/** Registers the model on the shared `db` object (scripts/add_document_series.sql). Idempotent. */
export function registerDocumentSeriesModel(sequelize: Sequelize.Sequelize, db: Record<string, any>) {
  if (db.document_series) return;
  document_series.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      doc_type: { type: DataTypes.STRING(20), allowNull: false },
      name: { type: DataTypes.STRING(60), allowNull: false },
      format: { type: DataTypes.STRING(80), allowNull: false },
      padding: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 4 },
      reset_period: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'YEARLY' },
      next_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      current_period: { type: DataTypes.STRING(16), allowNull: true },
      is_default: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      issued_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_issued_number: { type: DataTypes.STRING(100), allowNull: true },
      last_issued_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.BIGINT, allowNull: true },
      updated_by: { type: DataTypes.BIGINT, allowNull: true },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    },
    { sequelize, tableName: 'document_series', underscored: true, timestamps: false },
  );
  db.document_series = document_series;
}
