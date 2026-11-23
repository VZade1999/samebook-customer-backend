import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductVariantDto } from './product-variant.dto';
import { ProductImageDto } from './product-image.dto';
import { ProductInventoryDto } from './product-inventory.dto';
import { ProductMetadataDto } from './product-metadata.dto';

export class CreateProductDto {
  @IsOptional()
  @IsString()
  product_code?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  cost_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  tax_percentage?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock_quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimum_stock?: number;

  // Ignored: the product always goes to the signed-in person's company.
  // Optional so a client doesn't have to send it.
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  company_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsString()
  image_url?: string;

  /** Where it's kept. With stock_quantity > 0 and no warehouse, the default warehouse is used. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouse_id?: number;

  /** Rack / shelf in that warehouse. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bin_location?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductInventoryDto)
  inventory?: ProductInventoryDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductMetadataDto)
  metadata?: ProductMetadataDto[];
}
