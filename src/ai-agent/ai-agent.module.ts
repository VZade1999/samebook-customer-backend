import { Module } from '@nestjs/common';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { CustomerModule } from 'src/customers/customers.module';
import { ProductModule } from 'src/products/products.module';
import { CompanyModule } from 'src/companies/companies.module';
import { QuotationModule } from 'src/quotations/quotations.module';

// AppLogger is @Global() (see common/logger/logger.module.ts) — no need to
// re-provide it here. The four domain services are consumed through their
// owning modules rather than re-declared as providers, so the AI agent
// shares the same singleton instances as the rest of the app instead of
// spinning up its own private copies.
@Module({
  imports: [CustomerModule, ProductModule, CompanyModule, QuotationModule],
  controllers: [AiAgentController],
  providers: [AiAgentService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
