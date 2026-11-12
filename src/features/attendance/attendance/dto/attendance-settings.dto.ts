import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateAttendanceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'shift_start must be in HH:mm format' })
  shift_start?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'shift_end must be in HH:mm format' })
  shift_end?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  grace_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(1440)
  half_day_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(1440)
  full_day_minutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekly_offs?: number[];
}
