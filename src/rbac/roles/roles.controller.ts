import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';

import { RolesService } from './roles.service';

import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthGuard } from '../../middlewares/auth.guard';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
  ) {}

  @Get('')
//   @RequirePermissions('roles.view')
  async listRoles(
    @Req() req: any,
    @Query('page', ParseIntPipe) page = 1,
    @Query('limit', ParseIntPipe) limit = 10,
    @Query('search') search?: string,
  ) {
    const companyId = req.user?.company_id;
     console.log('listRoles called with companyId:', companyId, 'page:', page, 'limit:', limit, 'search:', search);
    return this.rolesService.listRoles(
      companyId,
      page,
      limit,
      search?.trim(),
    );
  }

  @Get('all')
  @RequirePermissions('roles.view')
  async getRoles(@Req() req: any) {
    const companyId = req.user?.company_id;

    return this.rolesService.getRoles(companyId);
  }

  @Get(':id')
  @RequirePermissions('roles.view')
  async getRoleById(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const companyId = req.user?.company_id;

    return this.rolesService.getRoleById(
      companyId,
      id,
    );
  }

  @Post('create')
//   @RequirePermissions('roles.create')
  async createRole(
    @Req() req: any,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;

    return this.rolesService.createRole(
      companyId,
      payload,
    );
  }

  @Put(':id')
//   @RequirePermissions('roles.edit')
  async updateRole(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;

    return this.rolesService.updateRole(
      companyId,
      id,
      payload,
    );
  }

  @Delete(':id')
//   @RequirePermissions('roles.delete')
  async deleteRole(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const companyId = req.user?.company_id;

    return this.rolesService.deleteRole(
      companyId,
      id,
    );
  }
}