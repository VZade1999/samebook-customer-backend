import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CreateCompanyAddressDto } from './createCompanyAddress.dto';
import { CreateCompanyLocationDto } from './createCompanyLocation.dto';
import { CreateCompanyMetadataDto } from './createCompanyMetadata.dto';
import { CreateCompanyBankAccountDto } from './createCompanyBankAccount.dto';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  legal_name?: string;

  @IsOptional()
  @IsString()
  registration_number?: string;

  @IsOptional()
  @IsString()
  tax_id?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsEmail()
  primary_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[A-Z0-9]+$/)
  company_prefix?: string;

  @IsOptional()
  @IsString()
  primary_phone?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  default_terms_conditions?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanyAddressDto)
  addresses?: CreateCompanyAddressDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanyLocationDto)
  locations?: CreateCompanyLocationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanyMetadataDto)
  metadata?: CreateCompanyMetadataDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompanyBankAccountDto)
  bank_accounts?: CreateCompanyBankAccountDto[];
}
