import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateLeaveDto {
  @IsNotEmpty()
  @IsDateString()
  from_date: string;

  @IsNotEmpty()
  @IsDateString()
  to_date: string;

  @IsOptional()
  @IsIn(['FULL_DAY', 'HALF_DAY'])
  leave_type?: 'FULL_DAY' | 'HALF_DAY';

  // Required only when leave_type is HALF_DAY — a full-day leave has no
  // concept of which half of the day it covers.
  @ValidateIf((dto) => dto.leave_type === 'HALF_DAY')
  @IsIn(['AM', 'PM'])
  half_day_period?: 'AM' | 'PM';

  @IsNotEmpty()
  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters' })
  reason: string;
}
