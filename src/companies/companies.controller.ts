import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { CompanyService, CompanyRequester } from './companies.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { UpdateCompanyDto } from './dto/updateCompany.dto';
import { AuthGuard } from './../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

// Self-service only: every route here resolves to the caller's own company
// (req.user.company_id, set by AuthGuard from the JWT) — there is no
// cross-company listing, creation, or deletion in this app.
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('companies')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/details/:id')
  @RequirePermissions('companies.view')
  async companyDetails(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'companyDetails',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        companyId: id,
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.getCompanyById(
        id,
        this.getRequester(req),
      );
      if (!response.success) {
        log.warn(`Company details rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company details response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in companyDetails', error);
      return errorRes(res, error);
    }
  }

  @Get('/:id/addresses')
  @RequirePermissions('companies.view')
  async companyAddresses(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'companyAddresses',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        companyId: id,
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.getCompanyAddresses(
        id,
        this.getRequester(req),
      );
      if (!response.success) {
        log.warn(`Company addresses rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company addresses response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in companyAddresses', error);
      return errorRes(res, error);
    }
  }

  @Get('/:id/locations')
  @RequirePermissions('companies.view')
  async companyLocations(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'companyLocations',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        companyId: id,
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.getCompanyLocations(
        id,
        this.getRequester(req),
      );
      if (!response.success) {
        log.warn(`Company locations rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company locations response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in companyLocations', error);
      return errorRes(res, error);
    }
  }

  @Post('/update-company/:id')
  @RequirePermissions('companies.edit')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateCompany(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCompanyDto,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'updateCompany',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        companyId: id,
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.updateCompany(
        id,
        body,
        this.getRequester(req),
      );
      if (!response.success) {
        log.warn(`Company update rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company updated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateCompany', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): CompanyRequester {
    const user = (req as any).user;
    return { companyId: user?.company_id };
  }
}
