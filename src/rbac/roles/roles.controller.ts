import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { InvalidatesCache } from '../../common/cache/invalidates-cache';

// The caller's company's own roles. Levels and "only below your own level"
// are checked in RolesService.
@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('access')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('')
  @RequirePermissions('roles.view')
  async listRoles(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.rolesService.listRoles(req.user?.company_id, Number(page) || 1, Number(limit) || 10, search?.trim(), req.user?.user_id);
  }

  /** Roles, the permission catalogue and the caller's rights, for the Roles page. */
  @Get('overview')
  @RequirePermissions('roles.view')
  async overview(@Req() req: any) {
    return this.rolesService.overview(req.user?.company_id, req.user?.user_id);
  }

  @Get('all')
  @RequirePermissions('roles.view')
  async getRoles(@Req() req: any) {
    return this.rolesService.getRoles(req.user?.company_id, req.user?.user_id);
  }

  @Get(':id')
  @RequirePermissions('roles.view')
  async getRoleById(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.rolesService.getRoleById(req.user?.company_id, id, req.user?.user_id);
  }

  @Post('create')
  @RequirePermissions('roles.create')
  async createRole(@Req() req: any, @Body() payload: any) {
    return this.rolesService.createRole(req.user?.company_id, payload, req.user?.user_id);
  }

  @Put(':id')
  @RequirePermissions('roles.edit')
  async updateRole(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() payload: any) {
    return this.rolesService.updateRole(req.user?.company_id, id, payload, req.user?.user_id);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  async deleteRole(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.rolesService.deleteRole(req.user?.company_id, id, req.user?.user_id);
  }
}
