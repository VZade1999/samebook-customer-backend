import { Type } from 'class-transformer';

import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CUSTOMER_ADDRESS_TYPE, CUSTOMER_TYPE } from '../customer-address.enum';



// =====================================================
// CONTACT DTO
// =====================================================

export class CreateCustomerContactDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  first_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  last_name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Phone number must be a valid Indian phone number (10 digits starting with 6-9)',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  is_primary?: number;
}

// =====================================================
// ADDRESS DTO
// =====================================================

export class CreateCustomerAddressDto {
  @IsNotEmpty()
  @IsEnum(
    CUSTOMER_ADDRESS_TYPE,
  )
  address_type: CUSTOMER_ADDRESS_TYPE;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  gst_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line_1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address_line_2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postal_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  is_primary?: number;
}

// =====================================================
// MAIN CUSTOMER DTO
// =====================================================

export class CreateCustomerDto {
  // =========================================
  // CUSTOMER BASIC INFO
  // =========================================

  @IsNotEmpty()
  @IsEnum(CUSTOMER_TYPE)
  customer_type: CUSTOMER_TYPE;

  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  display_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  gst_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // =========================================
  // COMPANY ID
  // =========================================

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  company_id?: number;

  // =========================================
  // CONTACTS
  // =========================================

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({
    each: true,
  })
  @Type(
    () =>
      CreateCustomerContactDto,
  )
  contacts: CreateCustomerContactDto[];

  // =========================================
  // ADDRESSES
  // =========================================

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({
    each: true,
  })
  @Type(
    () =>
      CreateCustomerAddressDto,
  )
  addresses: CreateCustomerAddressDto[];
}