import { IsOptional, IsString, IsBoolean, IsNumber } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateCompanyMetadataDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id?: number;

  @IsString()
  key!: string;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  data_type?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '1' || value === 1) return true;
    if (value === '0' || value === 0) return false;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
  })
  @IsBoolean()
  is_sensitive?: boolean;
}
