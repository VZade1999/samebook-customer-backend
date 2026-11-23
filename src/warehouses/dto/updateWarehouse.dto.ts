import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  /** true makes it the default warehouse (the previous default stops being one). */
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
