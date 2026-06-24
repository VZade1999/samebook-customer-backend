import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { LoggerModule } from '../../common/logger/logger.module';
import { AppLogger } from '../../common/logger/logger.service';
import { UserRolesController } from './user-roles.controller';
import { UserRolesService } from './user-roles.service';

@Module({
  imports: [LoggerModule],
  controllers: [UsersController, UserRolesController],
  providers: [UsersService, AppLogger, UserRolesService],
  exports: [UsersService, UserRolesService],
})
export class UsersModule {}
