import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

const createdAt = () => ({
  type: DataTypes.DATE,
  allowNull: true,
  defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
});

export class tasks extends Model<any, any> {}
export class task_comments extends Model<any, any> {}
export class task_activity_logs extends Model<any, any> {}

/**
 * Registers the Tasks models + associations on the shared `db` object, owned
 * by the feature (the core init-models knows nothing about tasks). Idempotent.
 */
export function registerTasksModels(sequelize: Sequelize.Sequelize, db: Record<string, any>) {
  if (db.tasks) return;
  const { users } = db;

  tasks.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      task_number: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'TASK' },
      parent_id: { type: DataTypes.BIGINT, allowNull: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'TODO' },
      priority: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'NORMAL' },
      assignee_id: { type: DataTypes.BIGINT, allowNull: true },
      created_by: { type: DataTypes.BIGINT, allowNull: false },
      due_date: { type: DataTypes.DATEONLY, allowNull: true },
      due_time: { type: DataTypes.TIME, allowNull: true },
      link_type: { type: DataTypes.STRING(20), allowNull: true },
      link_id: { type: DataTypes.BIGINT, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      is_deleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_at: createdAt(),
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    },
    { sequelize, tableName: 'tasks', underscored: true, timestamps: false },
  );

  task_comments.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      task_id: { type: DataTypes.BIGINT, allowNull: false },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      user_id: { type: DataTypes.BIGINT, allowNull: false },
      kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'COMMENT' },
      body: { type: DataTypes.TEXT, allowNull: false },
      created_at: createdAt(),
    },
    { sequelize, tableName: 'task_comments', underscored: true, timestamps: false },
  );

  task_activity_logs.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      task_id: { type: DataTypes.BIGINT, allowNull: false },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      user_id: { type: DataTypes.BIGINT, allowNull: true },
      action: { type: DataTypes.STRING(30), allowNull: false },
      field: { type: DataTypes.STRING(30), allowNull: true },
      old_value: { type: DataTypes.STRING(500), allowNull: true },
      new_value: { type: DataTypes.STRING(500), allowNull: true },
      created_at: createdAt(),
    },
    { sequelize, tableName: 'task_activity_logs', underscored: true, timestamps: false },
  );

  tasks.belongsTo(users, { as: 'assignee', foreignKey: 'assignee_id' });
  tasks.belongsTo(users, { as: 'creator', foreignKey: 'created_by' });
  tasks.belongsTo(tasks, { as: 'parent', foreignKey: 'parent_id' });
  tasks.hasMany(tasks, { as: 'children', foreignKey: 'parent_id' });
  task_comments.belongsTo(users, { as: 'user', foreignKey: 'user_id' });
  task_activity_logs.belongsTo(users, { as: 'user', foreignKey: 'user_id' });

  Object.assign(db, { tasks, task_comments, task_activity_logs });
}
