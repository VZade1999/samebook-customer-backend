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
}
