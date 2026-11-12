import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './Database/database.module';
import { CacheModule } from './common/cache/cache.module';
import { LoggerModule } from './common/logger/logger.module';
import { CustomerModule } from './customers/customers.module';
import { ProductModule } from './products/products.module';
import { QuotationModule } from './quotations/quotations.module';
import { AiAgentModule } from './ai-agent/ai-agent.module';
import { CompanyModule } from './companies/companies.module';
import { UsersModule } from './rbac/users/users.module';
import { RolesModule } from './rbac/roles/roles.module';
import { PermissionsModule } from './rbac/permissions/permissions.module';
import { InvoiceModule } from './invoice/invoice.module';
import { AuthModule } from './auth/auth.module';
import { CallbackModule } from './callback/callback.module';
import { CategoriesModule } from './categories/categories.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ProfileModule } from './profile/profile.module';
import { AttendanceFeatureModule } from './features/attendance/attendance-feature.module';
import { TasksFeatureModule } from './features/tasks/tasks-feature.module';
import { DriveFeatureModule } from './features/drive/drive-feature.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DeliveryChallanModule } from './delivery-challan/delivery-challan.module';
import { CompanyModulesModule } from './company-modules/company-modules.module';
import { ThrottlerBehindProxyGuard } from './middlewares/throttle.guard';

//import { AppController } from './app.controller';
//import { AppService } from './app.service';

const NODE_ENV = process.env.NODE_ENV;
const ignoreLoadEnvFile = !(!NODE_ENV || NODE_ENV === 'local');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.local',
      ignoreEnvFile: ignoreLoadEnvFile,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    CustomerModule,
    CompanyModule,
    ProductModule,
    QuotationModule,
    UsersModule,
    DatabaseModule,
    LoggerModule,
    CacheModule,
    AiAgentModule,
    RolesModule,
    PermissionsModule,
    InvoiceModule,
    AuthModule,
    CallbackModule,
    CategoriesModule,
    WarehousesModule,
    ProfileModule,
    NotificationsModule,
    // Add-on features
    AttendanceFeatureModule,
    TasksFeatureModule,
    DriveFeatureModule,
    DeliveryChallanModule,
    CompanyModulesModule,
  ],
  //controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard }],
})
export class AppModule {}
