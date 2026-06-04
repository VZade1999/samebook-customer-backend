import { Module } from '@nestjs/common';
import { QuotationService } from './quotations.service';
import { QuotationController } from './quotations.controller';

@Module({
  controllers: [QuotationController],
  providers: [QuotationService],
})
export class QuotationModule {}
