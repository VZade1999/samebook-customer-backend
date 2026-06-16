import { Module } from '@nestjs/common';
import { LoggerModule } from 'src/common/logger/logger.module';
import { RolesService } from './roles.service';
import { AppLogger } from 'src/common/logger/logger.service';

import { RolesController } from './roles.controller';
import { RolePermissionsController } from './role-permissions.controller';
import { RolePermissionsService } from './role-permissions.service';



@Module({
  imports: [LoggerModule],
  controllers: [RolesController, RolePermissionsController],
  providers: [RolesService, AppLogger, RolePermissionsService],
  exports: [RolesService, RolePermissionsService],
})
export class RolesModule {}
