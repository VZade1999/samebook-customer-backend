import { Inject, Module } from '@nestjs/common';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { DriveStorage, driveStorage } from './drive.storage';
import { registerDriveModels } from './drive.models';

/**
 * The Drive add-on (folders, files, versions, activity) as one pluggable
 * unit. Gated per company by @RequireModule('drive') + ModuleGuard.
 * Remove = drop it from app.module.ts.
 */
@Module({
  controllers: [DriveController],
  providers: [DriveService, { provide: DriveStorage, useValue: driveStorage }],
})
export class DriveFeatureModule {
  constructor(@Inject('DATABASE_CONNECTION') dbProvider: any) {
    registerDriveModels(dbProvider.sequelize, dbProvider.db);
  }
}
