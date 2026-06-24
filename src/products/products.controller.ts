import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from '../common/logger/logger.service';

import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CreateProductDto } from './dto/createProduct.dto';

import { UpdateProductDto } from './dto/updateProduct.dto';
import { ProductsListDto } from './products-list.dto';
import { ProductService } from './products.service';
import { AuthGuard } from '../middlewares/auth.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';

@Controller('product')
@UseGuards(AuthGuard)
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/create')
  @UsePipes(ValidationPipe)
  async createProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateProductDto,
  ) {
    const log = this.appLogger.forContext('ProductController', 'create', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    try {
      const response = await this.productService.createProduct(body);
      if (!response.success) {
        log.warn(`Product not created — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product created successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in product creation', error);
      return errorRes(res, error);
    }
  }

  @Get('/list')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async productsList(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: ProductsListDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext('ProductController', 'productsList', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    try {
      const response = await this.productService.getProductsList(query, currentUser);
      if (!response.success) {
        log.warn(`Products list rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Products list response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in productsList', error);
      return errorRes(res, error);
    }
  }

  @Delete('/:id')
  @Post('/delete-product/:id')
  async deleteProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'ProductController',
      'deleteProduct',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        productId: id,
      },
    );

    log.info('Request received');

    try {
      const response = await this.productService.deleteProduct(id);
      if (!response.success) {
        log.warn(`Product deletion rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product deleted successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deleteProduct', error);
      return errorRes(res, error);
    }
  }

  @Patch('/:id/activate')
  async activateProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'ProductController',
      'activateProduct',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        productId: id,
      },
    );

    log.info('Request received');

    try {
      const response = await this.productService.activateProduct(id);
      if (!response.success) {
        log.warn(`Product activation rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product activated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in activateProduct', error);
      return errorRes(res, error);
    }
  }

  @Patch('/:id/deactivate')
  async deactivateProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'ProductController',
      'deactivateProduct',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        productId: id,
      },
    );

    log.info('Request received');

    try {
      const response = await this.productService.deactivateProduct(id);
      if (!response.success) {
        log.warn(`Product deactivation rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product deactivated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deactivateProduct', error);
      return errorRes(res, error);
    }
  }

  @Get('/:id')
  async getProductById(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext(
      'ProductController',
      'getProductById',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        productId: id,
      },
    );

    log.info('Request received');

    try {
      const response = await this.productService.getProductById(id);
      if (!response.success) {
        log.warn(`Product fetch rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product fetched successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getProductById', error);
      return errorRes(res, error);
    }
  }

  @Put('/:id')
  @Post('/update-product/:id')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateProduct(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProductDto,
  ) {
    const log = this.appLogger.forContext(
      'ProductController',
      'updateProduct',
      {
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        productId: id,
      },
    );

    log.info('Request received');

    try {
      const response = await this.productService.updateProduct(id, body);
      if (!response.success) {
        log.warn(`Product update rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Product updated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateProduct', error);
      return errorRes(res, error);
    }
  }
}
