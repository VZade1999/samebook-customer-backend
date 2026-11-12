import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewLeaveDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  review_note?: string;
}
