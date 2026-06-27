import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { Request, Response } from 'express';

import { AppLogger } from '../common/logger/logger.service';



import { CustomerService } from './customers.service';

import { AuthGuard } from './../middlewares/auth.guard';



import { CreateCustomerDto } from './dto/createCustomer.dto';

import { UpdateCustomerDto } from './dto/updateCustomer.dto';

import { CustomersListDto } from './customers-list.dto';
import { errorRes, failedRes, successRes } from '../Util/response.util';
import { GetUser } from '../common/decorators/get-user.decorator';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';

@Controller('customer')
@UseGuards(AuthGuard)
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,

    private readonly appLogger: AppLogger,
  ) {}

  // =====================================================
  // CREATE CUSTOMER
  // =====================================================
  @UseGuards(AuthGuard)
  @Post("/create")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      forbidNonWhitelisted: true,
    }),
  )
  async createCustomer(
    @Req() req: Request,

    @Res() res: Response,

    @Body() body: CreateCustomerDto,

    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'CustomerController',
      'createCustomer',
      {
        ip:
          req.ip ??
          req.socket?.remoteAddress ??
          'unknown',
      },
    );

    log.info('Create customer request received');

    try {
      if (!currentUser) {
        log.warn('Unauthorized request');

        throw new UnauthorizedException(
          'User authentication required',
        );
      }

      const response =
        await this.customerService.createCustomer(
          body,
          currentUser,
        );

      if (!response.success) {
        log.warn(
          `Customer creation failed — ${response.message}`,
        );

        return failedRes(
          res,
          response.message,
        );
      }

      log.info(
        'Customer created successfully',
      );

      return successRes(
        res,
        response.message,
        response.data,
      );
    } catch (error: any) {
      if (
        error instanceof
        HttpException
      ) {
        log.warn(
          'Handled HTTP exception in createCustomer',
          {
            message:
              error.message,

            status:
              error.getStatus(),
          },
        );

        throw error;
      }

      log.error(
        'Unhandled error in createCustomer',
        error,
      );

      return errorRes(res, error);
    }
  }

  // =====================================================
  // GET CUSTOMERS LIST
  // =====================================================
  @UseGuards(AuthGuard)
  @Get('/list')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      forbidNonWhitelisted: true,
    }),
  )
  async getCustomersList(
    @Req() req: Request,

    @Res() res: Response,

    @Query() query: CustomersListDto,

    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'CustomerController',
      'getCustomersList',
      {
        ip:
          req.ip ??
          req.socket?.remoteAddress ??
          'unknown',
      },
    );

    log.info(
      'Get customers list request received',
    );

    try {
      if (!currentUser) {
        log.warn('Unauthorized request');

        throw new UnauthorizedException(
          'User authentication required',
        );
      }

      const response =
        await this.customerService.getCustomersList(
          query,
          currentUser,
        );

      if (!response.success) {
        log.warn(
          `Customers list failed — ${response.message}`,
        );

        return failedRes(
          res,
          response.message,
        );
      }

      log.info(
        'Customers list fetched successfully',
      );

      return successRes(
        res,
        response.message,
        response.data,
      );
    } catch (error: any) {
      if (
        error instanceof
        HttpException
      ) {
        log.warn(
          'Handled HTTP exception in getCustomersList',
          {
            message:
              error.message,

            status:
              error.getStatus(),
          },
        );

        throw error;
      }

      log.error(
        'Unhandled error in getCustomersList',
        error,
      );

      return errorRes(res, error);
    }
  }

  // =====================================================
  // GET CUSTOMER DETAILS
  // =====================================================
  @UseGuards(AuthGuard)
  @Get('/:id')
  async getCustomerDetails(
    @Req() req: Request,

    @Res() res: Response,

    @Param('id', ParseIntPipe)
    id: number,

    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'CustomerController',
      'getCustomerDetails',
      {
        customerId: id,
      },
    );

    log.info(
      'Get customer details request received',
    );

    try {
      if (!currentUser) {
        throw new UnauthorizedException(
          'User authentication required',
        );
      }

      const response =
        await this.customerService.getCustomerDetails(
          id,
          currentUser,
        );

      if (!response.success) {
        log.warn(
          `Customer details fetch failed — ${response.message}`,
        );

        return failedRes(
          res,
          response.message,
        );
      }

      return successRes(
        res,
        response.message,
        response.data,
      );
    } catch (error: any) {
      if (
        error instanceof
        HttpException
      ) {
        throw error;
      }

      log.error(
        'Unhandled error in getCustomerDetails',
        error,
      );

      return errorRes(res, error);
    }
  }

  // =====================================================
  // UPDATE CUSTOMER
  // =====================================================
  @UseGuards(AuthGuard)
  @Put('/:id')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,

      forbidNonWhitelisted: true,
    }),
  )
  async updateCustomer(
    @Req() req: Request,

    @Res() res: Response,

    @Param('id', ParseIntPipe)
    id: number,

    @Body() body: UpdateCustomerDto,

    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'CustomerController',
      'updateCustomer',
      {
        customerId: id,
      },
    );

    log.info(
      'Update customer request received',
    );

    try {
      if (!currentUser) {
        throw new UnauthorizedException(
          'User authentication required',
        );
      }

      const response =
        await this.customerService.updateCustomer(
          id,
          body,
          currentUser,
        );

      if (!response.success) {
        log.warn(
          `Customer update failed — ${response.message}`,
        );

        return failedRes(
          res,
          response.message,
        );
      }

      log.info(
        'Customer updated successfully',
      );

      return successRes(
        res,
        response.message,
        response.data,
      );
    } catch (error: any) {
      if (
        error instanceof
        HttpException
      ) {
        throw error;
      }

      log.error(
        'Unhandled error in updateCustomer',
        error,
      );

      return errorRes(res, error);
    }
  }

  // =====================================================
  // DELETE CUSTOMER
  // =====================================================
  @UseGuards(AuthGuard)
  @Delete('/:id')
  async deleteCustomer(
    @Req() req: Request,

    @Res() res: Response,

    @Param('id', ParseIntPipe)
    id: number,

    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'CustomerController',
      'deleteCustomer',
      {
        customerId: id,
      },
    );

    log.info(
      'Delete customer request received',
    );

    try {
      if (!currentUser) {
        throw new UnauthorizedException(
          'User authentication required',
        );
      }

      const response =
        await this.customerService.deleteCustomer(
          id,
          currentUser,
        );

      if (!response.success) {
        log.warn(
          `Customer delete failed — ${response.message}`,
        );

        return failedRes(
          res,
          response.message,
        );
      }

      log.info(
        'Customer deleted successfully',
      );

      return successRes(
        res,
        response.message,
        response.data,
      );
    } catch (error: any) {
      if (
        error instanceof
        HttpException
      ) {
        throw error;
      }

      log.error(
        'Unhandled error in deleteCustomer',
        error,
      );

      return errorRes(res, error);
    }
  }
}