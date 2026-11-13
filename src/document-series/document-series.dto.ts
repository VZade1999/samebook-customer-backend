import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DOC_TYPES, DocType, LIMITS, RESET_PERIODS, ResetPeriod } from './document-series.rules';

export class CreateSeriesDto {
  @IsIn(DOC_TYPES as unknown as string[])
  doc_type: DocType;

  @IsString()
  @MaxLength(LIMITS.nameMax)
  name: string;

  @IsString()
  @MaxLength(LIMITS.formatMax)
  format: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIMITS.paddingMin)
  @Max(LIMITS.paddingMax)
  padding?: number;

  @IsOptional()
  @IsIn(RESET_PERIODS as unknown as string[])
  reset_period?: ResetPeriod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIMITS.nextMin)
  @Max(LIMITS.nextMax)
  next_number?: number;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class UpdateSeriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.nameMax)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITS.formatMax)
  format?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIMITS.paddingMin)
  @Max(LIMITS.paddingMax)
  padding?: number;

  @IsOptional()
  @IsIn(RESET_PERIODS as unknown as string[])
  reset_period?: ResetPeriod;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIMITS.nextMin)
  @Max(LIMITS.nextMax)
  next_number?: number;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Live check while typing in the editor; nothing is saved. */
export class PreviewSeriesDto extends CreateSeriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exclude_id?: number;
}
