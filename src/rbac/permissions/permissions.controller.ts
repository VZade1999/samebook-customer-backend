
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
} from '@nestjs/common';

import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';


@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
  ) {}

  @Get('list')
  @RequirePermissions('permissions.view')
  async listPermissions(
    @Req() req: any,
    @Query('page', ParseIntPipe) page = 1,
    @Query('limit', ParseIntPipe) limit = 10,
    @Query('search') search?: string,
  ) {
    return this.permissionsService.listPermissions(
      page,
      limit,
      search?.trim(),
    );
  }

  @Get()
  @RequirePermissions('permissions.view')
  async getPermissions() {
    return this.permissionsService.getPermissions();
  }

  @Get(':id')
  @RequirePermissions('permissions.view')
  async getPermissionById(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.permissionsService.getPermissionById(id);
  }

  @Post('create')
//   @RequirePermissions('permissions.create')
  async createPermission(
    @Body() payload: any,
  ) {
    return this.permissionsService.createPermission(
      payload,
    );
  }

  @Put(':id')
  @RequirePermissions('permissions.edit')
  async updatePermission(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: any,
  ) {
    return this.permissionsService.updatePermission(
      id,
      payload,
    );
  }

  @Delete(':id')
  @RequirePermissions('permissions.delete')
  async deletePermission(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.permissionsService.deletePermission(
      id,
    );
  }
}

