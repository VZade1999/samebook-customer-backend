import { Inject, Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { registerTasksModels } from './tasks.models';

/**
 * The Tasks add-on (Epic > Goal > Task > Subtask) as one pluggable unit:
 * controller, service, DTOs, rules and DB models all live here. Gated per
 * company by @RequireModule('tasks') + ModuleGuard. Remove = drop it from
 * app.module.ts.
 */
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksFeatureModule {
  constructor(@Inject('DATABASE_CONNECTION') dbProvider: any) {
    registerTasksModels(dbProvider.sequelize, dbProvider.db);
  }
}
