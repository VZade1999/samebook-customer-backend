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
import { UsersService } from './users.service';
import { RequirePermissions } from 'src/common/decorators/require-permissions.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('list')
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
  async getRoles(@Req() req: any) {
    const companyId = req.user?.company_id;
    return this.usersService.getRoles(companyId);
  }

  @Get(':id')
  async getUserById(@Req() req: any, @Param('id') id: number) {
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
  async updateUser(
    @Req() req: any,
    @Param('id') id: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;
    return this.usersService.updateUser(companyId, id, payload);
  }

  @Delete(':id')
  async deleteUser(@Req() req: any, @Param('id') id: number) {
    const companyId = req.user?.company_id;
    return this.usersService.softDeleteUser(companyId, id);
  }
}
