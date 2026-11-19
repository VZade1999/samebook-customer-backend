import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

// AccessModule, CompanyModulesModule, CacheModule and the database are global.
@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
