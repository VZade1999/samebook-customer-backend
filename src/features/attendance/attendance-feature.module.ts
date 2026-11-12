import { Inject, Module } from '@nestjs/common';
import { AttendanceModule } from './attendance/attendance.module';
import { LeaveModule } from './leave/leave.module';
import { registerAttendanceModels } from './attendance.models';

/**
 * The Attendance & Leave add-on as one pluggable unit: its controllers,
 * services, DTOs and DB models all live under src/features/attendance.
 * Removing the feature = removing this module from app.module.ts.
 *
 * Access is gated per company by @RequireModule('attendance') + ModuleGuard
 * on its controllers (see src/company-modules).
 */
@Module({
  imports: [AttendanceModule, LeaveModule],
})
export class AttendanceFeatureModule {
  // Registered in the constructor (not onModuleInit): Nest instantiates the
  // module class before any controller can serve a request, and the DB
  // provider is a resolved singleton by then. Services read the models lazily
  // through getters, so they always see them.
  constructor(@Inject('DATABASE_CONNECTION') dbProvider: any) {
    registerAttendanceModels(dbProvider.sequelize, dbProvider.db);
  }
}
