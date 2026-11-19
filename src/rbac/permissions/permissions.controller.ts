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
import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { InvalidatesCache } from '../../common/cache/invalidates-cache';
import { PlatformGuard } from '../platform.guard';

// Reading: anyone allowed to see permissions (companies never see the
// platform ones). Changing the master list: SameBook Super Admins only.
@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('g:access')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('list')
  @RequirePermissions('permissions.view')
  async listPermissions(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.permissionsService.listPermissions(Number(page) || 1, Number(limit) || 10, search?.trim(), !!req.user?.platform);
  }

  /** Grouped by area, with the company roles that give each permission. */
  @Get('catalogue')
  @RequirePermissions('permissions.view')
  async catalogue(@Req() req: any) {
    return this.permissionsService.catalogue(req.user?.company_id, !!req.user?.platform);
  }

  @Get()
  @RequirePermissions('permissions.view')
  async getPermissions(@Req() req: any) {
    return this.permissionsService.getPermissions(!!req.user?.platform);
  }

  @Get(':id')
  @RequirePermissions('permissions.view')
  async getPermissionById(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.permissionsService.getPermissionById(id, !!req.user?.platform);
  }

  @Post('create')
  @UseGuards(PlatformGuard)
  @RequirePermissions('permissions.create')
  async createPermission(@Body() payload: any) {
    return this.permissionsService.createPermission(payload);
  }

  @Put(':id')
  @UseGuards(PlatformGuard)
  @RequirePermissions('permissions.edit')
  async updatePermission(@Param('id', ParseIntPipe) id: number, @Body() payload: any) {
    return this.permissionsService.updatePermission(id, payload);
  }

  @Delete(':id')
  @UseGuards(PlatformGuard)
  @RequirePermissions('permissions.delete')
  async deletePermission(@Param('id', ParseIntPipe) id: number) {
    return this.permissionsService.deletePermission(id);
  }
}
