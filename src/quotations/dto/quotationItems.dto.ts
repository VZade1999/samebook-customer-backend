import { Type } from 'class-transformer';

import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class QuotationItemDto {
  @IsNotEmpty()
  @IsString()
  product_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  hsn_code?: string;

 @IsOptional()
  @IsString()
  unit?: string;

  @IsNumber()
  @Type(() => Number)
  @Min(1)
  qty: number;

  @IsNumber()
  @Type(() => Number)
  rate: number;


  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  discount_percent?: number;

  // `amount`, `discount_amount`, `discounted_rate`, and `total` are computed by the server.
}