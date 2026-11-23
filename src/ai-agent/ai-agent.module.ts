import { Module } from '@nestjs/common';
import { CustomerModule } from 'src/customers/customers.module';
import { ProductModule } from 'src/products/products.module';
import { CompanyModule } from 'src/companies/companies.module';
import { QuotationModule } from 'src/quotations/quotations.module';
import { StockModule } from 'src/stock/stock.module';
import { DeliveryChallanModule } from 'src/delivery-challan/delivery-challan.module';
import { InvoiceModule } from 'src/invoice/invoice.module';
import { DashboardModule } from 'src/dashboard/dashboard.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiLookupService } from './ai-lookup.service';
import { AiStoreService } from './ai-store.service';

// The assistant uses the same services as the pages (shared instances), so
// every rule — numbering, stock, PO checks, tenant scoping — stays in one place.
// AppLogger and CompanyModulesService are global.
@Module({
  imports: [CustomerModule, ProductModule, CompanyModule, QuotationModule, StockModule, DeliveryChallanModule, InvoiceModule, DashboardModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService, AiStoreService, AiLookupService],
})
export class AiAgentModule {}
