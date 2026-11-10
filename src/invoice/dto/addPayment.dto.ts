import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

import { Type } from 'class-transformer';

export const PAYMENT_MODES = [
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'UPI',
  'CARD',
] as const;

export class AddPaymentDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsDateString()
  payment_date?: string;

  @IsString()
  @IsIn(PAYMENT_MODES)
  payment_mode: (typeof PAYMENT_MODES)[number];

  @IsOptional()
  @IsString()
  transaction_reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Ignored: received_by is always taken from the authenticated user.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  received_by?: number;
}
