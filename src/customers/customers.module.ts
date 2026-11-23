import { Module } from '@nestjs/common';
import { CustomerService } from './customers.service';
import { CustomerController } from './customers.controller';
import { CustomerDirectoryService } from './customer-directory.service';
@Module({
  controllers: [CustomerController],
  providers: [CustomerService, CustomerDirectoryService],
  exports: [CustomerService],
})
export class CustomerModule {}
