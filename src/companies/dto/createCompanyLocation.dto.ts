import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCompanyLocationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  address_id?: number;

  @IsOptional()
  @IsString()
  manager_name?: string;

  @IsOptional()
  @IsString()
  manager_phone?: string;

  @IsOptional()
  @IsString()
  capacity?: string;

  @IsOptional()
  @IsString()
  operational_hours?: string;

  @IsOptional()
  @IsString()
  address_line_1?: string;

  @IsOptional()
  @IsString()
  address_line_2?: string;

  @IsOptional()
  @IsString()
  address_city?: string;

  @IsOptional()
  @IsString()
  address_state?: string;

  @IsOptional()
  @IsString()
  address_country?: string;

  @IsOptional()
  @IsString()
  address_postal_code?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
