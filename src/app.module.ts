import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './Database/database.module';
import { LoggerModule } from './common/logger/logger.module';
import { CustomerModule } from './customers/customers.module';
import { ProductModule } from './products/products.module';
import { QuotationModule } from './quotations/quotations.module';
import { AiAgentModule } from './ai-agent/ai-agent.module';
import { CompanyModule } from './companies/companies.module';
import { UsersModule } from './users/users.module';

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
    CustomerModule,
    CompanyModule,
    ProductModule,
    QuotationModule,
    UsersModule,
    DatabaseModule,
    LoggerModule,
    AiAgentModule
  ],
  //controllers: [AppController],
  //providers: [AppService],
})
export class AppModule {}
