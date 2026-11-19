import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../middlewares/auth.guard';
import { PlatformGuard } from '../rbac/platform.guard';
import { InvalidatesCache } from '../common/cache/invalidates-cache';
import { PlatformService } from './platform.service';

// SameBook's own console: every company. Super Admins only (checked against
// the database on every call). Cache bumps for the company being changed are
// done in the service — the caller's own company is a different one.
@UseGuards(AuthGuard, PlatformGuard)
@InvalidatesCache()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  overview(@Req() req: any) {
    return this.platform.overview(req.user.company_id);
  }

  @Get('companies')
  companies(@Req() req: any) {
    return this.platform.companies(req.user.company_id);
  }

  @Get('companies/:id')
  company(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.platform.company(id, req.user.company_id);
  }

  /** A new company with its first Admin (default roles are created). */
  @Post('companies')
  createCompany(@Body() body: any) {
    return this.platform.createCompany(body);
  }

  @Put('companies/:id/status')
  setStatus(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.platform.setStatus(id, body?.status, req.user);
  }

  @Put('companies/:id/add-ons/:key')
  setAddOn(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Param('key') key: string, @Body() body: any) {
    return this.platform.setAddOn(id, key, !!body?.enabled, req.user);
  }

  /** Promote someone in the company ({ user_id }) or add a new Admin ({ first_name, email, password … }). */
  @Post('companies/:id/admins')
  addAdmin(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.platform.addAdmin(id, body);
  }
}
