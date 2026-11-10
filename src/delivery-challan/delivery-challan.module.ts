import { Module } from '@nestjs/common';
import { InvoiceModule } from '../invoice/invoice.module';
import { DeliveryChallanController } from './delivery-challan.controller';
import { DeliveryChallanService } from './delivery-challan.service';

@Module({
  imports: [InvoiceModule],
  controllers: [DeliveryChallanController],
  providers: [DeliveryChallanService],
  exports: [DeliveryChallanService],
})
export class DeliveryChallanModule {}
