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
} from '@nestjs/common';

import { Request, Response } from 'express';

import { InvoiceService } from './invoice.service';

import { InvoiceListDto } from './dto/invoiceList.dto';

import { AddPaymentDto } from './dto/addPayment.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { CurrentUser } from 'src/common/interfaces/urrent-user.interface';
import { GenrateInvoice } from './dto/genrateInvoice.dto';

@Controller('invoice')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
  ) {}

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

  @Get('/:id/payments')
  async getPayments(
    @Param('id', ParseIntPipe)
    id: number,
  ) {}

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