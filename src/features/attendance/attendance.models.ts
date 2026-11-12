import type { Sequelize } from 'sequelize';
import { attendance as _attendance } from './models/attendance';
import { leave_requests as _leave_requests } from './models/leave_requests';
import { attendance_settings as _attendance_settings } from './models/attendance_settings';
import { attendance_holidays as _attendance_holidays } from './models/attendance_holidays';

/**
 * Registers the Attendance & Leave models on the shared `db` object exposed by
 * the DATABASE_CONNECTION provider, with the same keys and association aliases
 * the core init-models used to define. Owned by the feature, so the core model
 * registry knows nothing about attendance. Idempotent.
 */
export function registerAttendanceModels(sequelize: Sequelize, db: Record<string, any>) {
  if (db.attendance) return;

  const { users, companies } = db;
  const attendance = _attendance.initModel(sequelize);
  const leave_requests = _leave_requests.initModel(sequelize);
  const attendance_settings = _attendance_settings.initModel(sequelize);
  const attendance_holidays = _attendance_holidays.initModel(sequelize);

  users.hasMany(attendance, { as: 'attendance', foreignKey: 'user_id' });
  attendance.belongsTo(users, { as: 'user', foreignKey: 'user_id' });

  users.hasMany(leave_requests, { as: 'leave_requests', foreignKey: 'user_id' });
  leave_requests.belongsTo(users, { as: 'user', foreignKey: 'user_id' });
  leave_requests.belongsTo(users, { as: 'reviewer', foreignKey: 'reviewed_by' });

  companies.hasOne(attendance_settings, { as: 'attendance_settings', foreignKey: 'company_id' });
  attendance_settings.belongsTo(companies, { as: 'company', foreignKey: 'company_id' });
  attendance_settings.belongsTo(users, { as: 'updated_by_user', foreignKey: 'updated_by' });
  companies.hasMany(attendance_holidays, { as: 'attendance_holidays', foreignKey: 'company_id' });
  attendance_holidays.belongsTo(companies, { as: 'company', foreignKey: 'company_id' });
  attendance_holidays.belongsTo(users, { as: 'created_by_user', foreignKey: 'created_by' });

  Object.assign(db, { attendance, leave_requests, attendance_settings, attendance_holidays });
}
