import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional } from "class-validator";

export class GenrateInvoice{

    // Unused by the service (the route param is authoritative); the frontend
    // currently sends it as undefined, so it must stay optional.
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    quotationId?: number

    @IsOptional()
    @IsDateString()
    invoice_date?: string

    @IsDateString()
    payment_due_date: string

    // Numbering series to use; omitted = the company's default series (or the
    // standard format when it has none).
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    series_id?: number
}
