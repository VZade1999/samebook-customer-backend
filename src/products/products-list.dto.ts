import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class ProductsListDto {
  @IsOptional() @IsString() product_code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsInt() @Type(() => Number) company_id?: number;
  @IsOptional() @IsInt() @Type(() => Number) category_id?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
