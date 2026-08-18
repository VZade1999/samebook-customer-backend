import { IsDateString, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateLeaveDto {
  @IsNotEmpty()
  @IsDateString()
  from_date: string;

  @IsNotEmpty()
  @IsDateString()
  to_date: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters' })
  reason: string;
}
