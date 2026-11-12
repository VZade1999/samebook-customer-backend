import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UserRolesService } from './user-roles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { InvalidatesCache } from '../../common/cache/invalidates-cache';

@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('access')
@Controller('users')
export class UserRolesController {
  constructor(
    private readonly userRolesService: UserRolesService,
  ) {}

  @Get(':id/roles')
  @RequirePermissions('users.view')
  async getUserRoles(
    @Req() req: any,
    @Param('id', ParseIntPipe) userId: number,
  ) {
    const companyId = req.user?.company_id;

    return this.userRolesService.getUserRoles(
      companyId,
      userId,
    );
  }

  @Post(':id/roles')
  @RequirePermissions('users.edit')
  async assignRoles(
    @Req() req: any,
    @Param('id', ParseIntPipe) userId: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;

    return this.userRolesService.assignRoles(
      companyId,
      userId,
      payload.role_ids || [],
    );
  }
}