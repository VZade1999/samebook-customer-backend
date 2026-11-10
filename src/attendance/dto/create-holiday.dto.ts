import { IsString, Length, Matches } from 'class-validator';

export class CreateHolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'holiday_date must be in YYYY-MM-DD format' })
  holiday_date: string;

  @IsString()
  @Length(1, 100)
  name: string;
}
