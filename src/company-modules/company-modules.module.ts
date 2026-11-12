import { Global, Module } from '@nestjs/common';
import { CompanyModulesController } from './company-modules.controller';
import { CompanyModulesService } from './company-modules.service';
import { ModuleGuard } from './module.guard';

// Global so any feature module can use @UseGuards(ModuleGuard) and the auth
// service can filter permissions by enabled modules without extra imports.
@Global()
@Module({
  controllers: [CompanyModulesController],
  providers: [CompanyModulesService, ModuleGuard],
  exports: [CompanyModulesService, ModuleGuard],
})
export class CompanyModulesModule {}
