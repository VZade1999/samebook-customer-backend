import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ASSIGN_MODES,
  CALL_OUTCOMES,
  INTEGRATION_TYPES,
  LOG_TYPES,
  MAX_IMPORT_ROWS,
  RATINGS,
  SOURCES,
  STAGES,
} from '../crm.rules';

const set = (o: any, k: string) => o[k] !== null && o[k] !== undefined;

// ─── Leads ──────────────────────────────────────────────────────────────────

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional() @IsString() @MaxLength(200) company_name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) alt_phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(30) gst_number?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(20) pincode?: string;
  @IsOptional() @IsString() @MaxLength(60) country?: string;
  @IsOptional() @IsString() @MaxLength(300) requirement?: string;
  @IsOptional() @IsString() @MaxLength(5000) message?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  estimated_value?: number;

  @IsOptional() @IsIn(SOURCES as unknown as string[]) source?: string;
  @IsOptional() @IsString() @MaxLength(100) source_detail?: string;
  @IsOptional() @IsIn(RATINGS as unknown as string[]) rating?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number;

  @IsOptional() @IsISO8601() next_follow_up_at?: string;
  @IsOptional() @IsString() @MaxLength(300) follow_up_note?: string;
}

/** Partial update of a lead's details. `null` clears an optional field. */
export class UpdateLeadDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) name?: string;
  @ValidateIf((o) => set(o, 'company_name')) @IsString() @MaxLength(200) company_name?: string | null;
  @ValidateIf((o) => set(o, 'phone')) @IsString() @MaxLength(30) phone?: string | null;
  @ValidateIf((o) => set(o, 'alt_phone')) @IsString() @MaxLength(30) alt_phone?: string | null;
  @ValidateIf((o) => set(o, 'email')) @IsString() @MaxLength(200) email?: string | null;
  @ValidateIf((o) => set(o, 'gst_number')) @IsString() @MaxLength(30) gst_number?: string | null;
  @ValidateIf((o) => set(o, 'address')) @IsString() @MaxLength(500) address?: string | null;
  @ValidateIf((o) => set(o, 'city')) @IsString() @MaxLength(100) city?: string | null;
  @ValidateIf((o) => set(o, 'state')) @IsString() @MaxLength(100) state?: string | null;
  @ValidateIf((o) => set(o, 'pincode')) @IsString() @MaxLength(20) pincode?: string | null;
  @ValidateIf((o) => set(o, 'country')) @IsString() @MaxLength(60) country?: string | null;
  @ValidateIf((o) => set(o, 'requirement')) @IsString() @MaxLength(300) requirement?: string | null;
  @ValidateIf((o) => set(o, 'message')) @IsString() @MaxLength(5000) message?: string | null;

  @ValidateIf((o) => set(o, 'estimated_value'))
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  estimated_value?: number | null;

  @IsOptional() @IsIn(SOURCES as unknown as string[]) source?: string;
  @ValidateIf((o) => set(o, 'source_detail')) @IsString() @MaxLength(100) source_detail?: string | null;
  @ValidateIf((o) => set(o, 'rating')) @IsIn(RATINGS as unknown as string[]) rating?: string | null;
}

export class StageDto {
  @IsIn(STAGES as unknown as string[])
  stage: string;

  @IsOptional() @IsString() @MaxLength(300) lost_reason?: string;

  /** Final deal value when marking won (optional). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999)
  value?: number;
}

export class AssignDto {
  @ValidateIf((o) => o.owner_id !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id: number | null;
}

export class FollowUpDto {
  @ValidateIf((o) => o.at !== null)
  @IsISO8601()
  at: string | null;

  @ValidateIf((o) => set(o, 'note'))
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class LogActivityDto {
  @IsIn(LOG_TYPES as unknown as string[])
  type: string;

  @IsOptional() @IsIn(CALL_OUTCOMES as unknown as string[]) outcome?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;

  /** Omitted = keep the current follow-up; null = no follow-up; ISO = set. */
  @ValidateIf((o) => set(o, 'next_follow_up_at'))
  @IsISO8601()
  next_follow_up_at?: string | null;

  @IsOptional() @IsString() @MaxLength(300) follow_up_note?: string;
}

// ─── Lead → customer ────────────────────────────────────────────────────────

export class ConvertContactDto {
  @IsString() @MinLength(2) @MaxLength(100) first_name: string;
  @IsOptional() @IsString() @MaxLength(100) last_name?: string;

  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'Phone must be a 10-digit Indian mobile number' })
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(100) designation?: string;
}

export class ConvertAddressDto {
  @IsString() @IsNotEmpty() @MaxLength(255) address_line_1: string;
  @IsOptional() @IsString() @MaxLength(255) address_line_2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(20) postal_code?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
}

export class ConvertCustomerDto {
  @IsIn(['INDIVIDUAL', 'BUSINESS']) customer_type: string;
  @IsString() @MinLength(2) @MaxLength(255) display_name: string;
  @IsOptional() @IsString() @MaxLength(255) company_name?: string;
  @IsOptional() @IsString() @MaxLength(50) gst_number?: string;

  @ValidateNested() @Type(() => ConvertContactDto) contact: ConvertContactDto;
  @ValidateNested() @Type(() => ConvertAddressDto) address: ConvertAddressDto;
}

export class ConvertLeadDto {
  @IsIn(['link', 'create']) mode: 'link' | 'create';

  @ValidateIf((o) => o.mode === 'link')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customer_id?: number;

  @ValidateIf((o) => o.mode === 'create')
  @ValidateNested()
  @Type(() => ConvertCustomerDto)
  customer?: ConvertCustomerDto;
}

// ─── CSV import ─────────────────────────────────────────────────────────────

export class ImportRowDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(300) company_name?: string;
  @IsOptional() @Allow() phone?: string | number;
  @IsOptional() @Allow() alt_phone?: string | number;
  @IsOptional() @IsString() @MaxLength(300) email?: string;
  @IsOptional() @IsString() @MaxLength(60) gst_number?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @IsString() @MaxLength(200) city?: string;
  @IsOptional() @IsString() @MaxLength(200) state?: string;
  @IsOptional() @Allow() pincode?: string | number;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(600) requirement?: string;
  @IsOptional() @IsString() @MaxLength(5000) message?: string;
  @IsOptional() @Allow() estimated_value?: string | number;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
}

export class ImportLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];

  @IsOptional() @IsIn(SOURCES as unknown as string[]) source?: string;
  @IsOptional() @IsIn(RATINGS as unknown as string[]) rating?: string;

  @ValidateIf((o) => set(o, 'owner_id'))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  owner_id?: number | null;
}

// ─── Lead sources (integrations) ────────────────────────────────────────────

export class SourceSettingsDto {
  @IsOptional() @IsIn(ASSIGN_MODES as unknown as string[]) assign_mode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assign_user_ids?: number[];

  @IsOptional() @IsIn(SOURCES as unknown as string[]) lead_source?: string;
  @ValidateIf((o) => set(o, 'default_rating')) @IsIn(RATINGS as unknown as string[]) default_rating?: string | null;
  @ValidateIf((o) => set(o, 'redirect_url')) @IsString() @MaxLength(500) redirect_url?: string | null;
}

export class CreateSourceDto {
  @IsIn(INTEGRATION_TYPES as unknown as string[]) type: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(300) api_key?: string;
  @IsOptional() @ValidateNested() @Type(() => SourceSettingsDto) settings?: SourceSettingsDto;
}

export class UpdateSourceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsString() @MaxLength(300) api_key?: string;
  @IsOptional() @ValidateNested() @Type(() => SourceSettingsDto) settings?: SourceSettingsDto;
}
