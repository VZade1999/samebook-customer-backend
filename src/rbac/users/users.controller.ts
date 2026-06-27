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
import { AuthGuard } from 'src/middlewares/auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard)
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

  @UseGuards(AuthGuard)
  @Get('roles')
  async getRoles(@Req() req: any) {
    const companyId = req.user?.company_id;
    return this.usersService.getRoles(companyId);
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async getUserById(@Req() req: any, @Param('id') id: number) {
    const companyId = req.user?.company_id;
    return this.usersService.getUserById(companyId, id);
  }

  @UseGuards(AuthGuard)
  @Post('create')
  @RequirePermissions('users.create')
  async createUser(@Req() req: any, @Body() payload: any) {
    const companyId = req.user?.company_id;
    return this.usersService.createUser(companyId, payload);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  async updateUser(
    @Req() req: any,
    @Param('id') id: number,
    @Body() payload: any,
  ) {
    const companyId = req.user?.company_id;
    return this.usersService.updateUser(companyId, id, payload);
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async deleteUser(@Req() req: any, @Param('id') id: number) {
    const companyId = req.user?.company_id;
    return this.usersService.softDeleteUser(companyId, id);
  }
}
