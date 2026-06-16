import { Module } from '@nestjs/common';
import { LoggerModule } from 'src/common/logger/logger.module';
import { AppLogger } from 'src/common/logger/logger.service';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';





@Module({
  imports: [LoggerModule],
  controllers: [PermissionsController],
  providers: [PermissionsService, AppLogger],
  exports: [PermissionsService],
})
export class PermissionsModule {}
