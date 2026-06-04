import { Module } from '@nestjs/common';
import { CustomerService } from './customers.service';
import { CustomerController } from './customers.controller';
@Module({
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}
