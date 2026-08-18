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
import { CategoriesService, CategoryRequester } from './categories.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CreateCategoryDto } from './dto/createCategory.dto';
import { UpdateCategoryDto } from './dto/updateCategory.dto';
import { AuthGuard } from './../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

// Self-service only: every route here resolves to the caller's own company
// (req.user.company_id, set by AuthGuard from the JWT) — there is no
// cross-company listing, creation, or deletion in this app.
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/list')
  @RequirePermissions('categories.view')
  async listCategories(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('CategoriesController', 'listCategories', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.categoriesService.listCategories(this.getRequester(req));
      log.info('Categories list response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in listCategories', error);
      return errorRes(res, error);
    }
  }

  @Post('/create')
  @RequirePermissions('categories.create')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createCategory(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateCategoryDto,
  ) {
    const log = this.appLogger.forContext('CategoriesController', 'createCategory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.categoriesService.createCategory(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Category create rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Category created successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in createCategory', error);
      return errorRes(res, error);
    }
  }

  @Post('/update/:id')
  @RequirePermissions('categories.edit')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateCategory(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCategoryDto,
  ) {
    const log = this.appLogger.forContext('CategoriesController', 'updateCategory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      categoryId: id,
    });

    log.info('Request received');
    try {
      const response = await this.categoriesService.updateCategory(id, body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Category update rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Category updated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateCategory', error);
      return errorRes(res, error);
    }
  }

  @Post('/delete/:id')
  @RequirePermissions('categories.delete')
  async deleteCategory(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext('CategoriesController', 'deleteCategory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      categoryId: id,
    });

    log.info('Request received');
    try {
      const response = await this.categoriesService.deleteCategory(id, this.getRequester(req));
      if (!response.success) {
        log.warn(`Category delete rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Category deleted successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deleteCategory', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): CategoryRequester {
    const user = (req as any).user;
    return { companyId: user?.company_id };
  }
}
