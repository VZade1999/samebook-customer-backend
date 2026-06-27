import {
  Body,
  Controller,
  Delete,
  Get,
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

import { successRes, failedRes, errorRes } from '../Util/response.util';

import { QuotationService } from './quotations.service';

import { CreateQuotationDto } from './dto/createQuotation.dto';

import { UpdateQuotationDto } from './dto/updateQuotation.dto';
import { QuotationsListDto } from './dto/quotationsList.dto';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';
import { GetUser } from '../common/decorators/get-user.decorator';
import { AuthGuard } from 'src/middlewares/auth.guard';

@Controller('quotation')
export class QuotationController {
  constructor(
    private readonly quotationService: QuotationService,
    private readonly appLogger: AppLogger,
  ) {}

  // GET QUOTATION LIST
    @UseGuards(AuthGuard)
  @Get('/list')
  async getQuotations(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: QuotationsListDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'QuotationController',
      'getQuotations',
      {
        ip: req.ip,
      },
    );// Debug log to check the value of currentUser
    try { // Ensure currentUser is defined
      if (!currentUser) {
        log.warn('Unauthorized request');

        throw new UnauthorizedException('User authentication required');
      }
      const response = await this.quotationService.getQuotations(
        query,
        currentUser,
      );

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Get quotations failed', error);

      return errorRes(res, error);
    }
  }

  
  // GET QUOTATION LIST FOR INVOICE
    @UseGuards(AuthGuard)
  @Get('/list-for-invoice')
  async getQuotationsForInvoice(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: QuotationsListDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    const log = this.appLogger.forContext(
      'QuotationController',
      'getQuotationsForInvoice',
      {
        ip: req.ip,
      },
    );
       try {

      if (!currentUser) {
        log.warn('Unauthorized request');

        throw new UnauthorizedException('User authentication required');
      }
      const response = await this.quotationService.getQuotationsListForInvoice(
        query,
        currentUser,
      );

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Get quotations list for invoice failed', error);

      return errorRes(res, error);
    }

    }


  // CREATE QUOTATION
  @UseGuards(AuthGuard)
  @Post()
  @UsePipes(ValidationPipe)
  async createQuotation(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CreateQuotationDto,
  ) {
    const log = this.appLogger.forContext(
      'QuotationController',
      'createQuotation',
      {
        ip: req.ip,
      },
    );

    try {
      const response = await this.quotationService.createQuotation(body);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Create quotation failed', error);

      return errorRes(res, error);
    }
  }

  // UPDATE QUOTATION
  @UseGuards(AuthGuard)
  @Put('/:id')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateQuotation(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateQuotationDto,
    
  ) {
    const log = this.appLogger.forContext(
      'QuotationController',
      'updateQuotation',
      {
        quotationId: id,
      },
    );

    try {
      const response = await this.quotationService.updateQuotation(id, body);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Update quotation failed', error);

      return errorRes(res, error);
    }
  }

  // GET QUOTATION DETAILS
  @UseGuards(AuthGuard)
  @Get('/:id')
  async getQuotationDetails(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    try {
      const response = await this.quotationService.getQuotationDetails(id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }

  // GET QUOTATION HISTORY
  @UseGuards(AuthGuard)
  @Get('/:id/history')
  async getQuotationHistory(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    try {
      const response = await this.quotationService.getQuotationHistory(id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }

  // GET TIMELINE
  @UseGuards(AuthGuard)
  @Get('/:id/timeline')
  async getQuotationTimeline(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    try {
      const response = await this.quotationService.getQuotationTimeline(id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }

  // SEND QUOTATION
  @UseGuards(AuthGuard)
  @Post('/:id/send')
  async sendQuotation(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('user_id') user_id?: number,
  ) {
    try {
      const response = await this.quotationService.sendQuotation(id, user_id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }
  @UseGuards(AuthGuard)
    @Post('/:id/approve')
  async approveQuotation(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('user_id') user_id?: number,
  ) {
    try {
      const response = await this.quotationService.approveQuotation(id, user_id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }

  // DELETE QUOTATION
  @UseGuards(AuthGuard)
  @Delete('/:id')
  async deleteQuotation(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body('user_id') user_id: number,
  ) {
    try {
      const response = await this.quotationService.deleteQuotation(id, user_id);

      if (!response.success) {
        return failedRes(res, response.message);
      }

      return successRes(res, response.message, response.data);
    } catch (error) {
      return errorRes(res, error);
    }
  }
}
