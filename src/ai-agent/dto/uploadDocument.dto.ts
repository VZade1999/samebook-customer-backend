import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export class UploadDocumentDto {
  // Base64-encoded file content (no data: URI prefix) — same convention
  // already used for avatar/logo uploads elsewhere in this app.
  @IsNotEmpty()
  @IsString()
  @MaxLength(20_000_000) // ~15MB raw file, matching main.ts's body size limit
  document: string;

  @IsIn(ALLOWED_MIME_TYPES)
  document_mime_type: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  document_name?: string;

  // Optional note with the document (e.g. "these are urgent") — without one
  // the assistant makes a draft quotation from it.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /** The chat to continue; leave it out to start a new one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-840)
  @Max(840)
  tz?: number;

  // Accepted from older pages; not used.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  session_id?: string;
}

export { ALLOWED_MIME_TYPES };
