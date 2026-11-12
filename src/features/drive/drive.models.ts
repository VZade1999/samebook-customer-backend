import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

const now = () => ({
  type: DataTypes.DATE,
  allowNull: true,
  defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
});

export class drive_folders extends Model<any, any> {}
export class drive_files extends Model<any, any> {}
export class drive_file_versions extends Model<any, any> {}
export class drive_activity extends Model<any, any> {}

/**
 * Registers the Drive models + associations on the shared `db` object, owned
 * by the feature (core init-models knows nothing about Drive). Idempotent.
 */
export function registerDriveModels(sequelize: Sequelize.Sequelize, db: Record<string, any>) {
  if (db.drive_files) return;
  const { users } = db;

  drive_folders.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      parent_id: { type: DataTypes.BIGINT, allowNull: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: true },
      color: { type: DataTypes.STRING(20), allowNull: true },
      created_by: { type: DataTypes.BIGINT, allowNull: false },
      updated_by: { type: DataTypes.BIGINT, allowNull: true },
      created_at: now(),
      updated_at: { ...now(), allowNull: false },
    },
    { sequelize, tableName: 'drive_folders', underscored: true, timestamps: false },
  );

  drive_files.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      folder_id: { type: DataTypes.BIGINT, allowNull: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      tags: { type: DataTypes.STRING(600), allowNull: true },
      extension: { type: DataTypes.STRING(20), allowNull: true },
      mime_type: { type: DataTypes.STRING(150), allowNull: true },
      size_bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      current_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      created_by: { type: DataTypes.BIGINT, allowNull: false },
      updated_by: { type: DataTypes.BIGINT, allowNull: true },
      created_at: now(),
      updated_at: { ...now(), allowNull: false },
    },
    { sequelize, tableName: 'drive_files', underscored: true, timestamps: false },
  );

  drive_file_versions.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      file_id: { type: DataTypes.BIGINT, allowNull: false },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      version_no: { type: DataTypes.INTEGER, allowNull: false },
      storage_key: { type: DataTypes.STRING(300), allowNull: false },
      original_name: { type: DataTypes.STRING(255), allowNull: false },
      extension: { type: DataTypes.STRING(20), allowNull: true },
      mime_type: { type: DataTypes.STRING(150), allowNull: true },
      size_bytes: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      checksum_sha256: { type: DataTypes.CHAR(64), allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      restored_from: { type: DataTypes.INTEGER, allowNull: true },
      uploaded_by: { type: DataTypes.BIGINT, allowNull: false },
      created_at: now(),
    },
    { sequelize, tableName: 'drive_file_versions', underscored: true, timestamps: false },
  );

  drive_activity.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      file_id: { type: DataTypes.BIGINT, allowNull: true },
      folder_id: { type: DataTypes.BIGINT, allowNull: true },
      user_id: { type: DataTypes.BIGINT, allowNull: true },
      action: { type: DataTypes.STRING(30), allowNull: false },
      field: { type: DataTypes.STRING(30), allowNull: true },
      old_value: { type: DataTypes.STRING(500), allowNull: true },
      new_value: { type: DataTypes.STRING(500), allowNull: true },
      version_no: { type: DataTypes.INTEGER, allowNull: true },
      created_at: now(),
    },
    { sequelize, tableName: 'drive_activity', underscored: true, timestamps: false },
  );

  drive_folders.belongsTo(users, { as: 'creator', foreignKey: 'created_by' });
  drive_folders.belongsTo(users, { as: 'editor', foreignKey: 'updated_by' });
  drive_files.belongsTo(users, { as: 'creator', foreignKey: 'created_by' });
  drive_files.belongsTo(users, { as: 'editor', foreignKey: 'updated_by' });
  drive_files.belongsTo(drive_folders, { as: 'folder', foreignKey: 'folder_id' });
  drive_file_versions.belongsTo(users, { as: 'uploader', foreignKey: 'uploaded_by' });
  drive_activity.belongsTo(users, { as: 'user', foreignKey: 'user_id' });
  drive_activity.belongsTo(drive_files, { as: 'file', foreignKey: 'file_id' });
  drive_activity.belongsTo(drive_folders, { as: 'folder', foreignKey: 'folder_id' });

  Object.assign(db, { drive_folders, drive_files, drive_file_versions, drive_activity });
}
