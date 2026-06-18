import { IsOptional, IsString } from 'class-validator';

export class GenerateInvoiceDto {
  @IsOptional()
  @IsString()
  payment_terms?: string;

  @IsOptional()
  @IsString()
  due_date?: string;
}