import {
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';

import { Type } from 'class-transformer';

export class InvoiceListDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;
}