import { Module } from '@nestjs/common';
import { DocumentLinksController } from './document-links.controller';
import { DocumentLinksService } from './document-links.service';

@Module({
  controllers: [DocumentLinksController],
  providers: [DocumentLinksService],
})
export class DocumentLinksModule {}
