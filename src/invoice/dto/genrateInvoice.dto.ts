import { IsDate, IsNumber } from "class-validator";

export class GenrateInvoice{

    @IsNumber()
    quotationId

    @IsDate()
    invoice_date

    @IsDate()
    payment_due_date
}