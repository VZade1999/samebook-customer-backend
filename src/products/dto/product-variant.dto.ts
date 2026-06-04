import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsNumber, Min, MaxLength } from 'class-validator';

export class ProductVariantDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  sku?: string;

  @IsOptional()
  attributes?: Record<string, unknown> | any;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  compare_at_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  cost_price?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_default?: boolean;
}
