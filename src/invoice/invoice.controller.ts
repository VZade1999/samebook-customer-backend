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
} from '@nestjs/common';

import { Request, Response } from 'express';

import { InvoiceService } from './invoice.service';

import { InvoiceListDto } from './dto/invoiceList.dto';

import { AddPaymentDto } from './dto/addPayment.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';
import { GenrateInvoice } from './dto/genrateInvoice.dto';
import { AuthGuard } from 'src/middlewares/auth.guard';

@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
  ) {}

    @UseGuards(AuthGuard)
 @Get('/list')
async getInvoices(
  @Query() query: InvoiceListDto,
  @GetUser() currentUser: CurrentUser,
) {
  return this.invoiceService.listInvoices(
    query,
    currentUser.company_id,
  );
}

  @UseGuards(AuthGuard)
@Get('/:id')
async getInvoiceDetails(
  @Param('id', ParseIntPipe)
  id: number,

  @GetUser()
  currentUser: CurrentUser,
) {
  return this.invoiceService.getInvoiceDetails(
    id,
    currentUser.company_id,
  );
}

  @UseGuards(AuthGuard)
  @Post('/generate/:quotationId')
  async generateInvoice(
    @Param(
      'quotationId',
      ParseIntPipe,
    )
    quotationId: number,
    @Body() body:GenrateInvoice,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.generateInvoice(
    quotationId,
    body,
    currentUser.user_id,
  );
  }

    @UseGuards(AuthGuard)
@Post('/:id/payments')
async addPayment(
  @Param('id', ParseIntPipe)
  invoiceId: number,

  @Body()
  payload: AddPaymentDto,

  @GetUser()
  currentUser: CurrentUser,
) {
  return this.invoiceService.addPayment(
    invoiceId,
    payload,
    currentUser.company_id,
  );
}   

  @UseGuards(AuthGuard)
  @Get('/:id/payments')
  async getPayments(
    @Param('id', ParseIntPipe)
    id: number,
  ) {}

    @UseGuards(AuthGuard)
  @Get('/:id/timeline')
async getInvoiceTimeline(
  @Param('id', ParseIntPipe)
  invoiceId: number,

  @GetUser()
  currentUser: CurrentUser,
) {
  return this.invoiceService.getInvoiceTimeline(
    invoiceId,
    currentUser.company_id,
  );
}

  @UseGuards(AuthGuard)
@Post('/:id/send')
async sendInvoice(
  @Param('id', ParseIntPipe)
  invoiceId: number,

  @GetUser()
  currentUser: CurrentUser,
) {
  return this.invoiceService.sendInvoice(
    invoiceId,
    currentUser.user_id,
    currentUser.company_id,
  );
}
}