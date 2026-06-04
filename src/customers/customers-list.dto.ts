import { Type } from 'class-transformer';

import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CUSTOMER_TYPE } from './customer-address.enum';



export class CustomersListDto {
  // =========================================
  // GLOBAL SEARCH
  // =========================================

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  // =========================================
  // CUSTOMER FILTERS
  // =========================================

  @IsOptional()
  @IsEnum(CUSTOMER_TYPE)
  customer_type?: CUSTOMER_TYPE;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  gst_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  // =========================================
  // CONTACT FILTERS
  // =========================================

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // =========================================
  // ADDRESS FILTERS
  // =========================================

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  // =========================================
  // PAGINATION
  // =========================================

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}