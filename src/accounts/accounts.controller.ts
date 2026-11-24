import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { successRes } from 'src/Util/response.util';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { ModuleGuard } from 'src/company-modules/module.guard';
import { RequireModule } from 'src/company-modules/require-module.decorator';
import { ACCOUNTS_MODULE, ACCOUNTS_PERMS as P } from './ledger.rules';
import { LedgerError, LedgerUser } from './ledger-db';
import { LedgerService } from './ledger.service';
import { MoneyService } from './money.service';
import { NotesService } from './notes.service';
import { ReportsService } from './reports.service';

/**
 * Accounts — the ledger: totals, customer and supplier ledgers (statements),
 * books settings and opening balances. Each route checks "any of" its
 * permissions itself (PermissionsGuard would need all of them).
 */
@Controller('ledger')
@UseGuards(AuthGuard, ModuleGuard)
@RequireModule(ACCOUNTS_MODULE)
export class AccountsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly money: MoneyService,
    private readonly notes: NotesService,
    private readonly reports: ReportsService,
    private readonly appLogger: AppLogger,
  ) {}

  private user(req: Request): LedgerUser {
    const u: any = (req as any).user;
    if (!u?.user_id || !u?.company_id) throw new UnauthorizedException('Please sign in again');
    return { company_id: Number(u.company_id), user_id: Number(u.user_id), permissions: u.permissions || [] };
  }

  private need(user: LedgerUser, ...anyOf: string[]) {
    if (!anyOf.some((p) => user.permissions.includes(p))) {
      throw new LedgerError(403, "You don't have permission for this — ask your Admin to give your role access in Roles");
    }
  }

  private async send(res: Response, op: string, fn: () => Promise<any>, message = 'OK') {
    try {
      const data = await fn();
      const msg = data && typeof data === 'object' && typeof data.message === 'string' ? data.message : message;
      return successRes(res, msg, data);
    } catch (err) {
      if (err instanceof LedgerError) return res.status(err.status).json({ success: false, message: err.message, data: null });
      if (err instanceof UnauthorizedException) throw err;
      this.appLogger.forContext('AccountsController', op).error(`${op} failed`, err);
      return res.status(500).json({ success: false, message: 'Something went wrong. Try again.', data: null });
    }
  }

  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'summary', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.ledger.summary(u);
    });
  }

  @Get('/parties')
  parties(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'parties', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record);
      return this.ledger.parties(u, query);
    });
  }

  @Get('/parties/:type/:id')
  statement(@Req() req: Request, @Res() res: Response, @Param('type') type: string, @Param('id', ParseIntPipe) id: number, @Query() query: any) {
    return this.send(res, 'statement', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record);
      return this.ledger.statement(u, type, id, query);
    });
  }

  @Get('/warnings')
  warnings(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'warnings', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.ledger.warnings(u);
    });
  }

  @Get('/settings')
  getSettings(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'getSettings', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.ledger.getSettings(u);
    });
  }

  @Put('/settings')
  saveSettings(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'saveSettings', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.ledger.saveSettings(u, body);
    });
  }

  @Get('/openings')
  openings(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'openings', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record);
      return this.ledger.openings(u, query);
    });
  }

  @Put('/openings')
  saveOpenings(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'saveOpenings', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.ledger.saveOpenings(u, body);
    });
  }

  @Post('/recheck')
  recheck(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'recheck', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.ledger.recheck(u);
    });
  }

  // ── Money received from customers ──────────────────────────────────────────

  @Get('/customers/:id/open-invoices')
  openInvoices(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'openInvoices', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record);
      return this.money.openInvoices(u, id);
    });
  }

  @Get('/receipts')
  receipts(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'receipts', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record);
      return this.money.receipts(u, query);
    });
  }

  @Post('/receipts')
  receive(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'receive', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.receive(u, body);
    });
  }

  @Post('/receipts/apply-advance')
  applyAdvance(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'applyAdvance', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.applyAdvance(u, body);
    });
  }

  @Post('/receipts/:id/cancel')
  cancelReceipt(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelReceipt', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.cancelReceipt(u, id, body);
    });
  }

  // ── Expenses ───────────────────────────────────────────────────────────────

  @Get('/expense-heads')
  expenseHeads(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'expenseHeads', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.expenseHeads(u);
    });
  }

  @Get('/expenses')
  expenses(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'expenses', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.expenses(u, query);
    });
  }

  @Post('/expenses')
  addExpense(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'addExpense', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.addExpense(u, body);
    });
  }

  @Post('/expenses/:id/cancel')
  cancelExpense(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelExpense', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.cancelExpense(u, id, body);
    });
  }

  // ── Transfers, journals, entries ───────────────────────────────────────────

  @Post('/transfers')
  transfer(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'transfer', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.transfer(u, body);
    });
  }

  @Post('/journals')
  journal(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'journal', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.journal(u, body);
    });
  }

  @Get('/entries/of/:kind/:id')
  entryOf(@Req() req: Request, @Res() res: Response, @Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'entryOf', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.entryOf(u, kind, id);
    });
  }

  @Get('/entries/:id')
  entry(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'entry', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.entry(u, id);
    });
  }

  @Post('/entries/:id/cancel')
  cancelEntry(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelEntry', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.cancelEntry(u, id, body);
    });
  }

  // ── Chart of accounts and books ────────────────────────────────────────────

  @Get('/accounts')
  accounts(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'accounts', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.accounts(u);
    });
  }

  @Post('/accounts')
  addAccount(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'addAccount', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.money.addAccount(u, body);
    });
  }

  @Get('/accounts/:id/statement')
  accountStatement(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query() query: any) {
    return this.send(res, 'accountStatement', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.accountStatement(u, id, query);
    });
  }

  // ── Credit notes, debit notes, refunds ─────────────────────────────────────

  @Get('/notes')
  notesList(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'notes', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.notes.notes(u, query);
    });
  }

  @Get('/notes/:kind/:id')
  note(@Req() req: Request, @Res() res: Response, @Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'note', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.notes.note(u, kind, id);
    });
  }

  @Get('/note-invoices')
  noteInvoices(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'noteInvoices', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.noteInvoices(u, query);
    });
  }

  @Get('/note-invoices/:id')
  invoiceForNote(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'invoiceForNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.invoiceForNote(u, id);
    });
  }

  @Get('/note-bills')
  noteBills(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'noteBills', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.noteBills(u, query);
    });
  }

  @Get('/note-bills/:id')
  billForNote(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'billForNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.billForNote(u, id);
    });
  }

  @Post('/credit-notes')
  createCreditNote(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'createCreditNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.createCreditNote(u, body);
    });
  }

  @Post('/credit-notes/:id/cancel')
  cancelCreditNote(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelCreditNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.cancelCreditNote(u, id, body);
    });
  }

  @Post('/debit-notes')
  createDebitNote(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'createDebitNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.createDebitNote(u, body);
    });
  }

  @Post('/debit-notes/:id/cancel')
  cancelDebitNote(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelDebitNote', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.cancelDebitNote(u, id, body);
    });
  }

  @Post('/refunds')
  refund(@Req() req: Request, @Res() res: Response, @Body() body: any) {
    return this.send(res, 'refund', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.refund(u, body);
    });
  }

  @Post('/refunds/:id/cancel')
  cancelRefund(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.send(res, 'cancelRefund', async () => {
      const u = this.user(req);
      this.need(u, P.record);
      return this.notes.cancelRefund(u, id, body);
    });
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Get('/reports/:name')
  report(@Req() req: Request, @Res() res: Response, @Param('name') name: string, @Query() query: any) {
    return this.send(res, 'report', async () => {
      const u = this.user(req);
      if (name === 'outstanding') this.need(u, P.view, P.reports);
      else this.need(u, P.reports);
      if (name === 'profit-loss') return this.reports.profitLoss(u, query);
      if (name === 'balance-sheet') return this.reports.balanceSheetReport(u, query);
      if (name === 'trial-balance') return this.reports.trialBalance(u, query);
      if (name === 'gst') return this.reports.gst(u, query);
      if (name === 'outstanding') return this.reports.outstanding(u, query);
      throw new LedgerError(404, 'No such report');
    });
  }

  @Get('/daybook')
  dayBook(@Req() req: Request, @Res() res: Response, @Query() query: any) {
    return this.send(res, 'dayBook', async () => {
      const u = this.user(req);
      this.need(u, P.view, P.record, P.reports);
      return this.money.dayBook(u, query);
    });
  }
}
