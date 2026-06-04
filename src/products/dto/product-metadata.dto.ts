import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class ProductMetadataDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id?: number;

  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  key!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  data_type?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_sensitive?: boolean;
}
