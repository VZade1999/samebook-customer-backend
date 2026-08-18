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
import { WarehousesService, WarehouseRequester } from './warehouses.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CreateWarehouseDto } from './dto/createWarehouse.dto';
import { UpdateWarehouseDto } from './dto/updateWarehouse.dto';
import { AuthGuard } from './../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

// Self-service only: every route here resolves to the caller's own company
// (req.user.company_id, set by AuthGuard from the JWT) — there is no
// cross-company listing, creation, or deletion in this app.
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly warehousesService: WarehousesService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/list')
  @RequirePermissions('warehouses.view')
  async listWarehouses(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('WarehousesController', 'listWarehouses', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.warehousesService.listWarehouses(this.getRequester(req));
      log.info('Warehouses list response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in listWarehouses', error);
      return errorRes(res, error);
    }
  }

  @Post('/create')
  @RequirePermissions('warehouses.create')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createWarehouse(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateWarehouseDto,
  ) {
    const log = this.appLogger.forContext('WarehousesController', 'createWarehouse', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.warehousesService.createWarehouse(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Warehouse create rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Warehouse created successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in createWarehouse', error);
      return errorRes(res, error);
    }
  }

  @Post('/update/:id')
  @RequirePermissions('warehouses.edit')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateWarehouse(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateWarehouseDto,
  ) {
    const log = this.appLogger.forContext('WarehousesController', 'updateWarehouse', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      warehouseId: id,
    });

    log.info('Request received');
    try {
      const response = await this.warehousesService.updateWarehouse(id, body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Warehouse update rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Warehouse updated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateWarehouse', error);
      return errorRes(res, error);
    }
  }

  @Post('/delete/:id')
  @RequirePermissions('warehouses.delete')
  async deleteWarehouse(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext('WarehousesController', 'deleteWarehouse', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      warehouseId: id,
    });

    log.info('Request received');
    try {
      const response = await this.warehousesService.deleteWarehouse(id, this.getRequester(req));
      if (!response.success) {
        log.warn(`Warehouse delete rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Warehouse deleted successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deleteWarehouse', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): WarehouseRequester {
    const user = (req as any).user;
    return { companyId: user?.company_id };
  }
}
