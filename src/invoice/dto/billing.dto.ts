import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One quotation line and how much of it to bill. */
export class BillLineDto {
  @Type(() => Number)
  @IsInt()
  quotation_item_id: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty: number;
}

/** Shared by "from challans", "from a quotation" and the preview. */
class BillDatesDto {
  @IsOptional()
  @IsDateString()
  invoice_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  series_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transport_charges?: number;

  // Dispatch details (checked in parseDispatch).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  transporter_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicle_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lr_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  eway_bill_number?: string;
}

export class FromChallansDto extends BillDatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  challan_ids: number[];

  @IsDateString()
  payment_due_date: string;
}

export class PreviewBillDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  challan_ids?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quotation_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines?: BillLineDto[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transport_charges?: number;
}

/** Dispatch details of an invoice that travels with the goods (checked in parseDispatch). */
export class DispatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  transporter_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  vehicle_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lr_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  eway_bill_number?: string;
}

/**
 * An invoice without a quotation. The lines, rates and addresses are checked
 * in the service (parseDirectLines, the customer's own address records).
 */
export class DirectInvoiceDto extends BillDatesDto {
  @Type(() => Number)
  @IsInt()
  customer_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  contact_person_id?: number;

  @Type(() => Number)
  @IsInt()
  billing_address_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shipping_address_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  issuing_location_id?: number;

  @IsOptional()
  @Allow()
  business_details_snapshot?: unknown;

  @IsOptional()
  @Allow()
  payment_details_snapshot?: unknown;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Allow()
  items: unknown[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cgst_percent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sgst_percent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  igst_percent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms_conditions?: string;

  @IsDateString()
  payment_due_date: string;

  // Challans made without a quotation that this invoice bills.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  challan_ids?: number[];
}

export class CancelInvoiceDto {
  @IsString()
  @MaxLength(400)
  reason: string;
}
