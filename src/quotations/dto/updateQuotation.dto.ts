import { Type } from 'class-transformer';

import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { QuotationItemDto } from './quotationItems.dto';

export class UpdateQuotationDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  contact_person_id?: number;

  @IsOptional()
@IsNumber()
@Type(() => Number)
billing_address_id?: number;

@IsOptional()
@IsNumber()
@Type(() => Number)
shipping_address_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  user_id?: number;

  @IsOptional()
  @IsDateString()
  quotation_date?: string;

  @IsOptional()
  @IsDateString()
  validity_date?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  terms_conditions?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  place_of_supply_state_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sub_total?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  gst_total?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  transport_charges?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  grand_total?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items?: QuotationItemDto[];

  @IsOptional()
@IsString()
customer_name?: string;

@IsOptional()
@IsString()
customer_type?: string;

@IsOptional()
@IsString()
customer_gst_number?: string;

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
  billing_address_snapshot?: any;

  @IsOptional()
  shipping_address_snapshot?: any;

  @IsOptional()
  @IsString()
  quotation_number?: string;

  @IsOptional()
  @IsString()
  document_type?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  daily_sequence?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  overall_sequence?: number;
}

