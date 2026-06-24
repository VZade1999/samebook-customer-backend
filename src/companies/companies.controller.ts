import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { CompanyService } from './companies.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CreateCompanyDto } from './dto/createCompany.dto';
import { CompaniesListDto } from './companies-list.dto';
import { UpdateCompanyDto } from './dto/updateCompany.dto';
import { AuthGuard } from './../middlewares/auth.guard';

@Controller('companies')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/create')
  @UseGuards(AuthGuard)
  @UsePipes(ValidationPipe)
  async createCompany(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateCompanyDto,
  ) {
    const log = this.appLogger.forContext('CompanyController', 'create', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.companyService.createCompany(body);
      if (!response.success) {
        log.warn(`Company not created — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company created successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in createCompany', error);
      return errorRes(res, error);
    }
  }

  @Get('/list')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async companiesList(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: CompaniesListDto,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'companiesList',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.getCompaniesList(query);
      if (!response.success) {
        log.warn(`Companies list rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Companies list response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in companiesList', error);
      return errorRes(res, error);
    }
  }

  @Get('/details/:id')
  @UseGuards(AuthGuard)
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
      const response = await this.companyService.getCompanyById(id);
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
  @UseGuards(AuthGuard)
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
      const response = await this.companyService.getCompanyAddresses(id);
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
  @UseGuards(AuthGuard)
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
      const response = await this.companyService.getCompanyLocations(id);
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

  @Post('/delete/:id')
  @UseGuards(AuthGuard)
  async deleteCompany(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'CompanyController',
      'deleteCompany',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        companyId: id,
      },
    );

    log.info('Request received');
    try {
      const response = await this.companyService.deleteCompany(id);
      if (!response.success) {
        log.warn(`Company delete rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Company deleted successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deleteCompany', error);
      return errorRes(res, error);
    }
  }

  @Post('/update-company/:id')
  @UseGuards(AuthGuard)
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
      const response = await this.companyService.updateCompany(id, body);
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
}
