import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;

  /** The chat to continue; leave it out to start a new one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id?: number;

  /** Minutes east of UTC, for "today" (defaults to India). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tz?: number;

  // Accepted from older pages; not used. Conversation context is always loaded
  // on the server (never sent by the page), so it can't be forged.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  session_id?: string;
}

export class RenameChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;
}

export class DecideDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tz?: number;
}

export class AiSettingsDto {
  @IsOptional()
  @IsBoolean()
  allow_changes?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  daily_limit?: number;
}
