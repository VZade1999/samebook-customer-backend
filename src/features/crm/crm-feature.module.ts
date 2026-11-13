import { Inject, Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmSourcesController } from './crm-sources.controller';
import { CrmPublicController } from './crm-public.controller';
import { CrmService } from './crm.service';
import { CrmIngestService } from './crm-ingest.service';
import { CrmSourcesService } from './crm-sources.service';
import { registerCrmModels } from './crm.models';

/**
 * The CRM add-on (leads, pipeline, follow-ups, lead sources) as one pluggable
 * unit. Gated per company by @RequireModule('crm') + ModuleGuard; the public
 * intake checks the module itself. Remove = drop it from app.module.ts.
 */
@Module({
  controllers: [CrmSourcesController, CrmPublicController, CrmController],
  providers: [CrmService, CrmIngestService, CrmSourcesService],
})
export class CrmFeatureModule {
  constructor(@Inject('DATABASE_CONNECTION') dbProvider: any) {
    registerCrmModels(dbProvider.sequelize, dbProvider.db);
  }
}
