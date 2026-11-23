import { Module } from '@nestjs/common';
import { PurchaseBillsController, PurchaseOrdersController, SuppliersController } from './purchases.controller';
import { PurchaseDb } from './purchase-db';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseBillsService } from './purchase-bills.service';

/**
 * Purchases — the add-on "purchases": suppliers, purchase orders with
 * approval, goods received into stock (GRN), supplier bills and payments.
 * Numbering (DocumentSeriesService), notifications, the logger and the add-on
 * guard are global.
 */
@Module({
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseBillsController],
  providers: [PurchaseDb, SuppliersService, PurchaseOrdersService, PurchaseBillsService],
  exports: [SuppliersService, PurchaseOrdersService, PurchaseBillsService],
})
export class PurchasesModule {}
