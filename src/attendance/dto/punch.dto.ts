import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PunchDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
