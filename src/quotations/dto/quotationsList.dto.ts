import { Type } from 'class-transformer';

import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class QuotationsListDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum([
    'DRAFT',
    'SENT',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
  ])
  status?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  company_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsString()
  customer_name?: string;

  @IsOptional()
  @IsString()
  contact_person_name?: string;

  @IsOptional()
  @IsString()
  contact_person_email?: string;

  @IsOptional()
  @IsString()
  contact_person_phone?: string;

  @IsOptional()
  @IsString()
  customer_gst_number?: string;

  @IsOptional()
  @IsString()
  customer_type?: string;

  @IsOptional()
  @IsString()
  quotation_number?: string;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 10;
}