import { Global, Module } from '@nestjs/common';
import { DocumentSeriesController } from './document-series.controller';
import { DocumentSeriesService } from './document-series.service';

/**
 * Per-company numbering series for invoices, quotations and delivery challans.
 * Global so the document services can take the next number without importing it.
 */
@Global()
@Module({
  controllers: [DocumentSeriesController],
  providers: [DocumentSeriesService],
  exports: [DocumentSeriesService],
})
export class DocumentSeriesModule {}
