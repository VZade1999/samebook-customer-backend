import { Type } from 'class-transformer';

import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { QuotationItemDto } from './quotationItems.dto';



export class CreateQuotationDto {
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  company_id: number;

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

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  customer_id: number;

  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  user_id: number;

  @IsOptional()
  @IsDateString()
  quotation_date?: string;

  @IsOptional()
  @IsDateString()
  validity_date?: string;

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

  @IsNumber()
  @Type(() => Number)
  sub_total: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  discount_percent?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  discount_amount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cgst_percent?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cgst_amount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sgst_percent?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sgst_amount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  igst_percent?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  igst_amount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  transport_charges?: number;

  @IsNumber()
  @Type(() => Number)
  grand_total: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items: QuotationItemDto[];

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
}