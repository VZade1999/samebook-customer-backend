import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';

import { InvoiceService } from './invoice.service';

import { InvoiceListDto } from './dto/invoiceList.dto';

import { AddPaymentDto } from './dto/addPayment.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { CurrentUser } from '../common/interfaces/urrent-user.interface';
import { GenrateInvoice } from './dto/genrateInvoice.dto';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

// Reading needs invoices.view; making an invoice invoices.create; recording a
// payment or marking one as sent invoices.edit. Money totals (the summary)
// also need invoices.insides, the same rule as the dashboard.
@Controller('invoice')
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @RequirePermissions('invoices.view')
  @Get('/list')
  async getInvoices(@Query() query: InvoiceListDto, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.listInvoices(query, currentUser.company_id);
  }

  // Declared before '/:id' so the words are never read as an id.
  @RequirePermissions('invoices.view', 'invoices.insides')
  @Get('/summary')
  async getSummary(@Query('tz') tz: string, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.getSummary(currentUser.company_id, tz);
  }

  @RequirePermissions('invoices.create')
  @Get('/eligible-quotations')
  async eligibleQuotations(@Query('search') search: string, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.eligibleQuotations(currentUser.company_id, search);
  }

  @RequirePermissions('invoices.view')
  @Get('/:id')
  async getInvoiceDetails(@Param('id', ParseIntPipe) id: number, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.getInvoiceDetails(id, currentUser.company_id);
  }

  @RequirePermissions('invoices.create')
  @Post('/generate/:quotationId')
  async generateInvoice(
    @Param('quotationId', ParseIntPipe) quotationId: number,
    @Body(new ValidationPipe({ transform: true })) body: GenrateInvoice,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.generateInvoice(quotationId, body, currentUser.user_id, currentUser.company_id);
  }

  @RequirePermissions('invoices.edit')
  @Post('/:id/payments')
  async addPayment(
    @Param('id', ParseIntPipe) invoiceId: number,
    @Body(new ValidationPipe({ transform: true })) payload: AddPaymentDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.addPayment(invoiceId, payload, currentUser.company_id, currentUser.user_id);
  }

  @RequirePermissions('invoices.view')
  @Get('/:id/timeline')
  async getInvoiceTimeline(@Param('id', ParseIntPipe) invoiceId: number, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.getInvoiceTimeline(invoiceId, currentUser.company_id);
  }

  @RequirePermissions('invoices.edit')
  @Post('/:id/send')
  async sendInvoice(@Param('id', ParseIntPipe) invoiceId: number, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.sendInvoice(invoiceId, currentUser.user_id, currentUser.company_id);
  }
}
