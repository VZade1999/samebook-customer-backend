import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ProductInventoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stock_level?: number;

  @IsOptional()
  @IsString()
  stock_policy?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  warehouse_id?: number;
}
