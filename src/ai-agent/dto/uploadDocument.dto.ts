import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

  // Optional extra instruction alongside the document (e.g. "these are
  // urgent, mark the quotation notes accordingly") — defaults to a
  // standard "build a quotation from this" instruction if omitted.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsOptional()
  @IsString()
  session_id?: string;
}

export { ALLOWED_MIME_TYPES };
