import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { LINK_TYPES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '../tasks.rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateTaskDto {
  @IsIn(TASK_TYPES as unknown as string[])
  type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignee_id?: number;

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Matches(DATE, { message: 'due_date must be YYYY-MM-DD' })
  due_date?: string;

  @IsOptional()
  @Matches(TIME, { message: 'due_time must be HH:mm' })
  due_time?: string;

  @IsOptional()
  @IsIn(LINK_TYPES as unknown as string[])
  link_type?: string;

  @ValidateIf((o) => o.link_type != null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  link_id?: number;
}

/**
 * Partial update. `null` clears assignee / parent / due date / time / link /
 * description; omitted fields are left unchanged.
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ValidateIf((o) => o.description !== null && o.description !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @ValidateIf((o) => o.parent_id !== null && o.parent_id !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parent_id?: number | null;

  @ValidateIf((o) => o.assignee_id !== null && o.assignee_id !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignee_id?: number | null;

  @IsOptional()
  @IsIn(TASK_PRIORITIES as unknown as string[])
  priority?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: string;

  @ValidateIf((o) => o.due_date !== null && o.due_date !== undefined)
  @Matches(DATE, { message: 'due_date must be YYYY-MM-DD' })
  due_date?: string | null;

  @ValidateIf((o) => o.due_time !== null && o.due_time !== undefined)
  @Matches(TIME, { message: 'due_time must be HH:mm' })
  due_time?: string | null;

  @ValidateIf((o) => o.link_type !== null && o.link_type !== undefined)
  @IsIn(LINK_TYPES as unknown as string[])
  link_type?: string | null;

  @ValidateIf((o) => o.link_type != null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  link_id?: number | null;
}

export class CommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;
}

export class FollowUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
