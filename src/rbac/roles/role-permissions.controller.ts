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

import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthGuard } from '../../middlewares/auth.guard';
import { RolePermissionsService } from './role-permissions.service';
import { InvalidatesCache } from '../../common/cache/invalidates-cache';

@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('access')
@Controller('roles')
export class RolePermissionsController {
  constructor(
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  @Get(':id/permissions')
  @RequirePermissions('roles.view')
  async getRolePermissions(
    @Req() req: any,
    @Param('id', ParseIntPipe) roleId: number,
  ) {
    const companyId = req.user?.company_id;

    return this.rolePermissionsService.getRolePermissions(
      companyId,
      roleId,
    );
  }

  @Post(':id/permissions')
  @RequirePermissions('roles.edit')
  async assignPermissions(
    @Req() req: any,
    @Param('id', ParseIntPipe) roleId: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;

    return this.rolePermissionsService.assignPermissions(
      companyId,
      roleId,
      payload.permission_ids || [],
      req.user?.roles || [],
    );
  }
}