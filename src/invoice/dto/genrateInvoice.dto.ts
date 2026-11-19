import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsNumber, IsOptional, Min, ValidateNested } from "class-validator";
import { BillLineDto } from "./billing.dto";

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

    // What to bill: quantities per quotation line. Left out = everything not
    // billed yet (a quotation can have several invoices).
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => BillLineDto)
    lines?: BillLineDto[]

    // Defaults to the quotation's transport on its first invoice.
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    transport_charges?: number
}
