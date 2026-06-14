import { Module } from '@nestjs/common';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { AppLogger } from 'src/common/logger/logger.service';
import { CustomerService } from 'src/customers/customers.service';
import { ProductService } from 'src/products/products.service';
import { CompanyService } from 'src/companies/companies.service';
import { QuotationService } from 'src/quotations/quotations.service';

@Module({
  controllers: [AiAgentController],
  providers: [AiAgentService, AppLogger, CustomerService, ProductService, CompanyService, QuotationService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
