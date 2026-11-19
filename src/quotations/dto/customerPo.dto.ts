import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The customer's purchase order, sent when approving a quotation or when
 * changing its PO later. Both are optional here; the real checks (length,
 * no future date, "PO required" customers) are in parsePo.
 */
export class CustomerPoDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  customer_po_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  customer_po_date?: string | null;
}
