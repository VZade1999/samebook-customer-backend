import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AppLogger } from '../common/logger/logger.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CompanyModulesService, ModulesRequester } from './company-modules.service';
import { ConnectModuleDto } from './dto/connect-module.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('companies/modules')
export class CompanyModulesController {
  constructor(
    private readonly modules: CompanyModulesService,
    private readonly appLogger: AppLogger,
  ) {}

  // Any logged-in user may see which modules their company has (the UI uses
  // it to show/hide features); only managers can change them.
  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    try {
      const data = await this.modules.list(this.requester(req).companyId);
      return successRes(res, 'Company modules fetched', data);
    } catch (error) {
      this.appLogger.forContext('CompanyModulesController', 'list', {}).error('list failed', error);
      return errorRes(res, error);
    }
  }

  @Post('/:key/connect')
  @RequirePermissions('company.modules.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async connect(
    @Req() req: Request,
    @Res() res: Response,
    @Param('key') key: string,
    @Body() body: ConnectModuleDto,
  ) {
    try {
      const r = await this.modules.connect(key, this.requester(req), body?.grant_role_ids ?? []);
      if (!r.success) return failedRes(res, r.message, r.status);
      return successRes(res, r.message, r.data);
    } catch (error) {
      this.appLogger
        .forContext('CompanyModulesController', 'connect', { key })
        .error('connect failed', error);
      return errorRes(res, error);
    }
  }

  @Post('/:key/disconnect')
  @RequirePermissions('company.modules.manage')
  async disconnect(@Req() req: Request, @Res() res: Response, @Param('key') key: string) {
    try {
      const r = await this.modules.disconnect(key, this.requester(req));
      if (!r.success) return failedRes(res, r.message, r.status);
      return successRes(res, r.message, r.data);
    } catch (error) {
      this.appLogger
        .forContext('CompanyModulesController', 'disconnect', { key })
        .error('disconnect failed', error);
      return errorRes(res, error);
    }
  }

  private requester(req: Request): ModulesRequester {
    const u = (req as any).user || {};
    return { userId: u.user_id, companyId: u.company_id, roles: u.roles || [] };
  }
}
