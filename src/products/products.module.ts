import { Module } from '@nestjs/common';
import { ProductController } from './products.controller';
import { ProductService } from './products.service';
import { ProductCatalogService } from './product-catalog.service';

@Module({
  controllers: [ProductController],
  providers: [ProductService, ProductCatalogService],
  exports: [ProductService],
})
export class ProductModule {}
