import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { FOLDER_COLORS, MAX_TAGS, MAX_TAG_LEN } from '../drive.rules';

const present = (v: unknown) => v !== null && v !== undefined;

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(FOLDER_COLORS as unknown as string[])
  color?: string;
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  /** null = move to the drive root. */
  @IsOptional()
  @ValidateIf((o) => present(o.parent_id))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_id?: number | null;

  @IsOptional()
  @ValidateIf((o) => present(o.description))
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @ValidateIf((o) => present(o.color))
  @IsIn(FOLDER_COLORS as unknown as string[])
  color?: string | null;
}

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((o) => present(o.description))
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LEN, { each: true })
  tags?: string[];

  /** null = move to the drive root. */
  @IsOptional()
  @ValidateIf((o) => present(o.folder_id))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  folder_id?: number | null;
}

export class RestoreVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
