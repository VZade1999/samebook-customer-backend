import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const DC_REASONS = [
  'JOB_WORK',
  'STOCK_TRANSFER',
  'SUPPLY_ON_APPROVAL',
  'PARTIAL_SUPPLY',
  'SALE',
  'EXHIBITION',
  'REPAIR',
  'OTHER',
] as const;
export type DcReason = (typeof DC_REASONS)[number];

export const DC_STATUSES = [
  'DRAFT',
  'DISPATCHED',
  'DELIVERED',
  'INVOICED',
  'CANCELLED',
] as const;
export type DcStatus = (typeof DC_STATUSES)[number];

export class ChallanItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotation_item_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  item_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsn_code?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate?: number;
}

export class CreateChallanDto {
  @IsDateString()
  challan_date: string;

  @IsIn(DC_REASONS as unknown as string[])
  reason: DcReason;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotation_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billing_address_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  place_of_supply?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from_warehouse_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to_warehouse_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  transporter_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicle_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  eway_bill_number?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  affects_stock?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChallanItemDto)
  items: ChallanItemDto[];
}

// Same shape as create, every field optional. Items are replaced only when
// `items` is present in the body.
export class UpdateChallanDto {
  @IsOptional()
  @IsDateString()
  challan_date?: string;

  @IsOptional()
  @IsIn(DC_REASONS as unknown as string[])
  reason?: DcReason;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotation_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billing_address_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shipping_address_id?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  place_of_supply?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from_warehouse_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  to_warehouse_id?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  transporter_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicle_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  eway_bill_number?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  affects_stock?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChallanItemDto)
  items?: ChallanItemDto[];
}

export class ChallanListDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(DC_STATUSES as unknown as string[])
  status?: DcStatus;

  @IsOptional()
  @IsIn(DC_REASONS as unknown as string[])
  reason?: DcReason;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotation_id?: number;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;
}

export class CancelChallanDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ConvertChallanDto {
  @IsDateString()
  payment_due_date: string;
}
