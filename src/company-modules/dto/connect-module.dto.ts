import { ArrayMaxSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';

export class ConnectModuleDto {
  /** Roles (of the caller's company) that get the module's base permission. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  grant_role_ids?: number[];
}
