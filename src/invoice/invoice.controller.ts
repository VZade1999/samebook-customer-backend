import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
import { CancelInvoiceDto, DirectInvoiceDto, DispatchDto, FromChallansDto, PreviewBillDto } from './dto/billing.dto';
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

  // What can be billed for a quotation or a challan (lines left, challans waiting).
  @RequirePermissions('invoices.create')
  @Get('/billable')
  async billable(@Query('quotation_id') quotationId: string, @Query('challan_id') challanId: string, @GetUser() currentUser: CurrentUser) {
    return this.invoiceService.billable({ quotation_id: quotationId, challan_id: challanId }, currentUser.company_id);
  }

  // The invoice a "Make invoice" would create — nothing is saved.
  @RequirePermissions('invoices.create')
  @Post('/preview')
  async previewBill(
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: PreviewBillDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.previewBill(body, currentUser.company_id);
  }

  // An invoice without a quotation (walk-in sale, or challans made without one).
  @RequirePermissions('invoices.create')
  @Post('/direct')
  async createDirectInvoice(
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: DirectInvoiceDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.createDirectInvoice(body, currentUser.user_id, currentUser.company_id);
  }

  // Invoice from one or more dispatched / delivered challans of one customer.
  @RequirePermissions('invoices.create')
  @Post('/from-challans')
  async createFromChallans(
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: FromChallansDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.createFromChallans(body, currentUser.user_id, currentUser.company_id);
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

  // Dispatch details (vehicle, transporter, LR, e-way bill) of an invoice that travels with the goods.
  @RequirePermissions('invoices.edit')
  @Put('/:id/dispatch')
  async updateDispatch(
    @Param('id', ParseIntPipe) invoiceId: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: DispatchDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.updateDispatch(invoiceId, body, currentUser.user_id, currentUser.company_id);
  }

  // Cancel (no payments recorded): its challans go back to "ready to invoice".
  @RequirePermissions('invoices.delete')
  @Post('/:id/cancel')
  async cancelInvoice(
    @Param('id', ParseIntPipe) invoiceId: number,
    @Body(new ValidationPipe({ transform: true, whitelist: true })) body: CancelInvoiceDto,
    @GetUser() currentUser: CurrentUser,
  ) {
    return this.invoiceService.cancelInvoice(invoiceId, body, currentUser.user_id, currentUser.company_id);
  }
}
