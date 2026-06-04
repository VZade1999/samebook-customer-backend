import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DAOFactory } from './dao';
import { DAOService } from './dao.service';
import { databaseProviders } from './database.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule {}
