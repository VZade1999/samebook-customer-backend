import { IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CompaniesListDto {
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;
}
