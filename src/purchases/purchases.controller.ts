import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { successRes } from 'src/Util/response.util';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { ModuleGuard } from 'src/company-modules/module.guard';
import { RequireModule } from 'src/company-modules/require-module.decorator';
import { PURCHASES_MODULE, PURCHASE_PERMS as P } from './purchase.rules';
import { PurchaseError, PurchaseUser } from './purchase-db';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseBillsService } from './purchase-bills.service';

const ALL = [P.view, P.create, P.approve, P.receive, P.bills];

/** Shared by the three Purchases controllers: who is asking, permission checks, answers. */
abstract class PurchasesBase {
  constructor(protected readonly appLogger: AppLogger) {}

  protected user(req: Request): PurchaseUser {
    const u: any = (req as any).user;
    if (!u?.user_id || !u?.company_id) throw new UnauthorizedException('Please sign in again');
    return { company_id: Number(u.company_id), user_id: Number(u.user_id), permissions: u.permissions || [] };
  }

  /** Allowed when the person has any of these permissions. */
  protected need(user: PurchaseUser, ...anyOf: string[]) {
    if (!anyOf.some((p) => user.permissions.includes(p))) {
      throw new PurchaseError(403, "You don't have permission for this — ask your Admin to give your role access in Roles");
    }
  }

  protected async send(res: Response, op: string, fn: () => Promise<any>, message = 'OK') {
    try {
      const data = await fn();
      const msg = data && typeof data === 'object' && typeof data.message === 'string' ? data.message : message;
      return successRes(res, msg, data);
    } catch (err) {
      if (err instanceof PurchaseError) return res.status(err.status).json({ success: false, message: err.message, data: null });
      if (err instanceof UnauthorizedException) throw err;
      this.appLogger.forContext(this.constructor.name, op).error(`${op} failed`, err);
      return res.status(500).json({ success: false, message: 'Something went wrong. Try again.', data: null });
    }
  }
}

const ids = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);

/** Suppliers: who you buy from. */
@Controller('suppliers')
@UseGuards(AuthGuard, ModuleGuard)
@RequireModule(PURCHASES_MODULE)
export class SuppliersController extends PurchasesBase {
  constructor(
    private readonly suppliers: SuppliersService,
    appLogger: AppLogger,
  ) {
    super(appLogger);
  }

  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'summary', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.create, P.bills);
      return this.suppliers.summary(u);
    });
  }

  @Get('/options')
  options(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'options', async () => {
      const u = this.user(req);
      this.need(u, ...ALL);
      return this.suppliers.options(u, query);
    });
  }

  @Get('/')
  list(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'list', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.create, P.bills);
      return this.suppliers.list(u, query);
    });
  }

  @Get('/:id')
  get(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'get', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.create, P.bills);
      return this.suppliers.get(u, id);
    });
  }

  @Post('/')
  create(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(
      res,
      'create',
      async () => {
        const u = this.user(req);
        this.need(u, P.create);
        return this.suppliers.create(u, body);
      },
      'Supplier added',
    );
  }

  @Put('/:id')
  update(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(
      res,
      'update',
      async () => {
        const u = this.user(req);
        this.need(u, P.create);
        return this.suppliers.update(u, id, body);
      },
      'Supplier saved',
    );
  }

  @Post('/:id/archive')
  archive(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(
      res,
      'archive',
      async () => {
        const u = this.user(req);
        this.need(u, P.create);
        return this.suppliers.archive(u, id);
      },
      'Supplier archived',
    );
  }

  @Post('/:id/restore')
  restore(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(
      res,
      'restore',
      async () => {
        const u = this.user(req);
        this.need(u, P.create);
        return this.suppliers.restore(u, id);
      },
      'Supplier restored',
    );
  }
}

/** Purchase orders, approval, goods received (GRN) and Purchase settings. */
@Controller('purchase-orders')
@UseGuards(AuthGuard, ModuleGuard)
@RequireModule(PURCHASES_MODULE)
export class PurchaseOrdersController extends PurchasesBase {
  constructor(
    private readonly orders: PurchaseOrdersService,
    appLogger: AppLogger,
  ) {
    super(appLogger);
  }

  // Fixed paths first, so they never reach the "/:id" routes.
  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'summary', async () => {
      const u = this.user(req);
      this.need(u, ...ALL);
      return this.orders.summary(u);
    });
  }

  @Get('/settings')
  settings(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'settings', async () => {
      const u = this.user(req);
      this.need(u, ...ALL);
      return this.orders.getSettings(u);
    });
  }

  // Approval limit, extra % and default terms: a company setting.
  @Put('/settings')
  saveSettings(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'saveSettings', async () => {
      const u = this.user(req);
      this.need(u, 'companies.edit');
      return this.orders.saveSettings(u, body);
    });
  }

  @Get('/receipts')
  receipts(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'receipts', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.receive);
      return this.orders.receipts(u, query);
    });
  }

  @Post('/receipts/:grnId/cancel')
  cancelReceipt(@Req() req: Request, @Res() res: Response, @Param('grnId', ParseIntPipe) grnId: number, @Body() body: any) {
    return this.send(res, 'cancelReceipt', async () => {
      const u = this.user(req);
      this.need(u, P.receive);
      return this.orders.cancelReceipt(u, grnId, body);
    });
  }

  @Get('/on-order')
  onOrder(@Req() req: Request, @Res() res: Response, @Query('ids') idList: string) {
    return this.send(res, 'onOrder', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.receive, P.create);
      return this.orders.onOrder(u, ids(idList));
    });
  }

  @Get('/last-bought')
  lastBought(@Req() req: Request, @Res() res: Response, @Query('ids') idList: string) {
    return this.send(res, 'lastBought', async () => {
      const u = this.user(req);
      this.need(u, P.view);
      return this.orders.lastBought(u, ids(idList));
    });
  }

  @Post('/preview')
  preview(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'preview', async () => {
      const u = this.user(req);
      this.need(u, P.create, P.approve);
      return this.orders.preview(u, body);
    });
  }

  @Get('/')
  list(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'list', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.receive);
      return this.orders.list(u, query);
    });
  }

  @Get('/:id')
  get(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'get', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.receive);
      return this.orders.get(u, id);
    });
  }

  @Post('/')
  create(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'create', async () => {
      const u = this.user(req);
      this.need(u, P.create);
      return this.orders.create(u, body);
    });
  }

  @Put('/:id')
  update(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'update', async () => {
      const u = this.user(req);
      this.need(u, P.create);
      return this.orders.update(u, id, body);
    });
  }

  @Post('/:id/submit')
  submit(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'submit', async () => {
      const u = this.user(req);
      this.need(u, P.create);
      return this.orders.submit(u, id);
    });
  }

  @Post('/:id/approve')
  approve(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'approve', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.approve(u, id);
    });
  }

  @Post('/:id/send-back')
  sendBack(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'sendBack', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.sendBack(u, id, body);
    });
  }

  @Post('/:id/sent')
  markSent(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'markSent', async () => {
      const u = this.user(req);
      this.need(u, P.create, P.approve);
      return this.orders.markSent(u, id);
    });
  }

  @Put('/:id/amend')
  amend(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'amend', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.amend(u, id, body);
    });
  }

  @Post('/:id/cancel')
  cancel(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancel', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.cancel(u, id, body);
    });
  }

  @Post('/:id/close')
  close(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'close', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.close(u, id, body);
    });
  }

  @Post('/:id/reopen')
  reopen(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'reopen', async () => {
      const u = this.user(req);
      this.need(u, P.approve);
      return this.orders.reopen(u, id);
    });
  }

  @Delete('/:id')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'remove', async () => {
      const u = this.user(req);
      this.need(u, P.create);
      return this.orders.remove(u, id);
    });
  }

  @Post('/:id/receive')
  receive(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'receive', async () => {
      const u = this.user(req);
      this.need(u, P.receive);
      return this.orders.receive(u, id, body);
    });
  }
}

/** Supplier bills and payments to suppliers. */
@Controller('purchase-bills')
@UseGuards(AuthGuard, ModuleGuard)
@RequireModule(PURCHASES_MODULE)
export class PurchaseBillsController extends PurchasesBase {
  constructor(
    private readonly bills: PurchaseBillsService,
    appLogger: AppLogger,
  ) {
    super(appLogger);
  }

  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'summary', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.bills);
      return this.bills.summary(u);
    });
  }

  @Get('/payments')
  payments(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'payments', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.bills);
      return this.bills.payments(u, query);
    });
  }

  @Post('/payments')
  pay(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'pay', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.pay(u, body);
    });
  }

  @Post('/payments/:id/cancel')
  cancelPayment(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelPayment', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.cancelPayment(u, id, body);
    });
  }

  @Get('/billable')
  billable(@Req() req: Request, @Res() res: Response, @Query('po_id') poId: string) {
    return this.send(res, 'billable', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.billable(u, Number(poId) || 0);
    });
  }

  @Get('/unpaid')
  unpaid(@Req() req: Request, @Res() res: Response, @Query('supplier_id') supplierId: string) {
    return this.send(res, 'unpaid', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.unpaid(u, Number(supplierId) || 0);
    });
  }

  @Post('/preview')
  preview(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'preview', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.preview(u, body);
    });
  }

  @Get('/')
  list(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'list', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.bills);
      return this.bills.list(u, query);
    });
  }

  @Get('/:id')
  get(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'get', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.bills);
      return this.bills.get(u, id);
    });
  }

  @Post('/')
  create(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'create', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.create(u, body);
    });
  }

  @Post('/:id/cancel')
  cancel(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancel', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.cancel(u, id, body);
    });
  }

  @Post('/:id/apply-advance')
  applyAdvance(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'applyAdvance', async () => {
      const u = this.user(req);
      this.need(u, P.bills);
      return this.bills.applyAdvance(u, id);
    });
  }
}
