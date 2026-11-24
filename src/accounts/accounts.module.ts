import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { LedgerDb } from './ledger-db';
import { LedgerSyncService } from './ledger-sync.service';
import { LedgerService } from './ledger.service';
import { MoneyService } from './money.service';
import { NotesService } from './notes.service';
import { ReportsService } from './reports.service';

/**
 * Accounts — the add-on "accounts": books of accounts recorded from invoices,
 * payments, supplier bills and supplier payments (double-entry, Tally-style
 * groups), customer and supplier ledgers, opening balances. The logger and
 * the add-on guard are global.
 */
@Module({
  controllers: [AccountsController],
  providers: [LedgerDb, LedgerSyncService, LedgerService, MoneyService, NotesService, ReportsService],
  exports: [LedgerService, LedgerSyncService, MoneyService, NotesService, ReportsService],
})
export class AccountsModule {}
