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

@UseGuards(AuthGuard, PermissionsGuard)
@InvalidatesCache('access')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('list')
  @RequirePermissions('users.view')
  async listUsers(
    @Req() req: any,
    @Query('page', ParseIntPipe) page: number = 1,
    @Query('limit', ParseIntPipe) limit: number = 10,
    @Query('search') search?: string,
  ) {
    const companyId = req.user?.company_id;
    return this.usersService.listUsers(companyId, page, limit, search?.trim());
  }

  @Get('roles')
  @RequirePermissions('users.view')
  async getRoles(@Req() req: any) {
    const companyId = req.user?.company_id;
    return this.usersService.getRoles(companyId);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  async getUserById(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const companyId = req.user?.company_id;
    return this.usersService.getUserById(companyId, id);
  }

  @Post('create')
  @RequirePermissions('users.create')
  async createUser(@Req() req: any, @Body() payload: any) {
    const companyId = req.user?.company_id;
    return this.usersService.createUser(companyId, payload);
  }

  @Put(':id')
  @RequirePermissions('users.edit')
  async updateUser(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;
    return this.usersService.updateUser(companyId, id, payload);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  async deleteUser(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const companyId = req.user?.company_id;
    return this.usersService.softDeleteUser(companyId, id);
  }
}
