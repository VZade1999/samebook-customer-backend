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
import { UsersService } from './users.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { InvalidatesCache } from '../../common/cache/invalidates-cache';

// The company's people. Every change also checks the hierarchy (you manage
// only people below you, and give only roles below your level) in UsersService.
@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('access')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Everyone (active and deactivated), the caller's standing and choices, and counts. */
  @Get('team')
  @RequirePermissions('users.view')
  async team(@Req() req: any) {
    return this.usersService.team(req.user?.company_id, req.user?.user_id);
  }

  @Get('list')
  @RequirePermissions('users.view')
  async listUsers(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.usersService.listUsers(
      req.user?.company_id,
      Number(page) || 1,
      Number(limit) || 10,
      search?.trim(),
      req.user?.user_id,
      status === 'inactive' || status === 'all' ? status : 'active',
    );
  }

  /** Roles the caller may give. */
  @Get('roles')
  @RequirePermissions('users.view')
  async getRoles(@Req() req: any) {
    return this.usersService.getRoles(req.user?.company_id, req.user?.user_id);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  async getUserById(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.usersService.getUserById(req.user?.company_id, id, req.user?.user_id);
  }

  @Post('create')
  @RequirePermissions('users.create')
  async createUser(@Req() req: any, @Body() payload: any) {
    return this.usersService.createUser(req.user?.company_id, payload, req.user?.user_id);
  }

  @Put(':id')
  @RequirePermissions('users.edit')
  async updateUser(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() payload: any) {
    return this.usersService.updateUser(req.user?.company_id, id, payload, req.user?.user_id);
  }

  /** Deactivate (people are never deleted, so their documents keep their names). */
  @Delete(':id')
  @RequirePermissions('users.delete')
  async deleteUser(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.usersService.softDeleteUser(req.user?.company_id, id, req.user?.user_id);
  }

  @Post(':id/activate')
  @RequirePermissions('users.delete')
  async activateUser(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.usersService.activateUser(req.user?.company_id, id, req.user?.user_id);
  }
}
