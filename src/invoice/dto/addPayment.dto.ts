import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

import { Type } from 'class-transformer';

export class AddPaymentDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  amount: number;


   payment_date?: string;



payment_mode:
    | 'CASH'
    | 'BANK_TRANSFER'
    | 'CHEQUE'
    | 'UPI'
    | 'CARD';

  @IsOptional()
  @IsString()
  transaction_reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  received_by?: number;
}