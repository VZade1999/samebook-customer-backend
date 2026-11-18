import { IsOptional, IsString, IsNumber, IsInt } from 'class-validator';

import { Type } from 'class-transformer';

/**
 * GET /invoice/list. The service parses every field leniently (unknown filters
 * and sorts fall back to "all" / "newest"), see invoice-insights.rules.ts.
 */
export class InvoiceListDto {
  @IsOptional()
  @IsString()
  search?: string;

  /** UNPAID, PARTIAL, PAID, OVERDUE, DUE_SOON, NO_DUE or CANCELLED; empty = all live invoices. */
  @IsOptional()
  @IsString()
  status?: string;

  /** newest (default), oldest, due_soonest, balance_high or amount_high. */
  @IsOptional()
  @IsString()
  sort?: string;

  /** Minutes east of UTC, for "today" (defaults to India). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  tz?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;
}
