import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';

import { AppLogger } from '../common/logger/logger.service';
import { DocumentType } from '../common/enums/document-type.enum';
import { generateDocumentNumber } from '../common/utils/document-number.util';
import { InvoiceService } from '../invoice/invoice.service';
import {
  ChallanItemDto,
  ChallanListDto,
  CreateChallanDto,
  UpdateChallanDto,
} from './dto/challan.dto';

// Delivery Challan (CGST Rule 55). A challan accompanies goods moved without
// (or before) a sale; it is NOT a tax invoice, so no GST is computed here.
//
// Every business-rule violation is raised as a ChallanError inside the
// service; `run()` turns it into a { success:false, statusCode } result and
// `inTransaction()` guarantees the transaction is rolled back on any throw,
// so there is no early-return path that can leak an open transaction.

class ChallanError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChallanServiceResult {
  success: boolean;
  message: string;
  data?: any;
  statusCode?: number;
}

export interface ChallanRequester {
  companyId: number;
  userId: number;
}

const NOT_FOUND = 'Delivery challan not found';
const EPS = 1e-9;

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round3 = (n: number) =>
  Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

const isWholeQty = (n: number) => Math.abs(Number(n) - Math.round(Number(n))) < 1e-9;

const isLockConflict = (error: any) => {
  const code = error?.original?.code ?? error?.parent?.code ?? error?.code;
  const errno = error?.original?.errno ?? error?.parent?.errno ?? error?.errno;
  return (
    code === 'ER_LOCK_DEADLOCK' ||
    code === 'ER_LOCK_WAIT_TIMEOUT' ||
    errno === 1213 ||
    errno === 1205
  );
};

const normalizeJson = (value: any) => {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

interface ResolvedInput {
  challan_date: string;
  reason: string;
  quotation_id: number | null;
  customer_id: number | null;
  billing_address_id: number | null;
  shipping_address_id: number | null;
  rebuildCustomer: boolean;
  place_of_supply: string | null;
  from_warehouse_id: number | null;
  to_warehouse_id: number | null;
  transporter_name: string | null;
  vehicle_number: string | null;
  eway_bill_number: string | null;
  notes: string | null;
  affects_stock: boolean;
  items: ChallanItemDto[];
}

interface ItemRow {
  quotation_item_id: number | null;
  product_id: number | null;
  variant_id: number | null;
  item_name: string;
  description: string | null;
  hsn_code: string | null;
  quantity: number;
  unit: string | null;
  rate: number;
  value: number;
}

interface StockLine {
  product_id: number;
  variant_id: number | null;
  quantity: number;
  names: string[];
}

@Injectable()
export class DeliveryChallanService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly invoiceService: InvoiceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Model accessors
  // ---------------------------------------------------------------------------
  private get db() {
    return this.dbProvider.db;
  }
  private get Challans() {
    return this.db.delivery_challans;
  }
  private get ChallanItems() {
    return this.db.delivery_challan_items;
  }
  private get ChallanLogs() {
    return this.db.delivery_challan_activity_logs;
  }

  private getLog(operation: string, meta: Record<string, unknown> = {}) {
    return this.appLogger.forContext('DeliveryChallanService', operation, meta);
  }

  // ---------------------------------------------------------------------------
  // Infrastructure helpers
  // ---------------------------------------------------------------------------
  private async inTransaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
    const transaction: Transaction = await this.dbProvider.sequelize.transaction();
    try {
      const result = await fn(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async run(
    operation: string,
    meta: Record<string, unknown>,
    fn: () => Promise<ChallanServiceResult>,
  ): Promise<ChallanServiceResult> {
    const log = this.getLog(operation, meta);
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ChallanError) {
        log.warn(`Rejected — ${error.message}`);
        return { success: false, message: error.message, statusCode: error.statusCode };
      }
      if (error instanceof UniqueConstraintError) {
        log.warn('Rejected — challan number collision, client should retry');
        return {
          success: false,
          message: 'Challan number conflict, please try again',
          statusCode: 409,
        };
      }
      if (isLockConflict(error)) {
        log.warn('Rejected — concurrent stock update (lock conflict), client should retry');
        return {
          success: false,
          message: 'Another stock update is in progress, please try again',
          statusCode: 409,
        };
      }
      log.error(`${operation} failed`, error);
      throw error;
    }
  }

  private async logActivity(
    challanId: number,
    action: string,
    oldValue: object | null,
    newValue: object | null,
    changedBy: number,
    transaction: Transaction,
  ) {
    return this.ChallanLogs.create(
      {
        delivery_challan_id: challanId,
        action,
        old_value: oldValue ?? null,
        new_value: newValue ?? null,
        changed_by: changedBy,
      },
      { transaction },
    );
  }

  private async findChallan(
    id: number,
    companyId: number,
    transaction?: Transaction,
    lock = false,
  ) {
    const challan = await this.Challans.findOne({
      where: { id, company_id: companyId, is_active: 1 },
      transaction,
      lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
    });
    if (!challan) throw new ChallanError(404, NOT_FOUND);
    return challan;
  }

  private snapshotOf(challan: any) {
    const json = challan.toJSON();
    return {
      status: json.status,
      challan_number: json.challan_number,
      invoice_id: json.invoice_id,
    };
  }

  // ---------------------------------------------------------------------------
  // Numbering: per company, inside the caller's transaction with the company
  // row locked (same approach as quotations). The unique index
  // (company_id, challan_number) is the backstop.
  // ---------------------------------------------------------------------------
  private async generateChallanNumber(companyId: number, transaction: Transaction) {
    const company = await this.db.companies.findByPk(companyId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!company) throw new ChallanError(400, 'Company not found');

    const companyPrefix =
      company.company_prefix?.trim().toUpperCase() ||
      company.name?.trim().substring(0, 4).toUpperCase() ||
      'COMP';

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const [dailyResult] = await this.dbProvider.sequelize.query(
      `SELECT COUNT(*) AS daily_count
       FROM delivery_challans
       WHERE company_id = :companyId
         AND created_at >= :todayStart
         AND created_at < :tomorrowStart`,
      {
        replacements: { companyId, todayStart, tomorrowStart },
        transaction,
        type: QueryTypes.SELECT,
      },
    );
    const dailySequence = Number((dailyResult as any)?.daily_count || 0) + 1;

    const [overallResult] = await this.dbProvider.sequelize.query(
      `SELECT COALESCE(MAX(overall_sequence), 0) AS max_overall
       FROM delivery_challans
       WHERE company_id = :companyId`,
      {
        replacements: { companyId },
        transaction,
        type: QueryTypes.SELECT,
      },
    );
    const overallSequence = Number((overallResult as any)?.max_overall || 0) + 1;

    return {
      challanNumber: generateDocumentNumber(
        DocumentType.DELIVERY_CHALLAN,
        companyPrefix,
        dailySequence,
        overallSequence,
      ),
      overallSequence,
    };
  }

  // ---------------------------------------------------------------------------
  // Quotation helpers
  // ---------------------------------------------------------------------------
  private async loadApprovedQuotation(
    quotationId: number,
    companyId: number,
    transaction?: Transaction,
    lock = false,
  ) {
    const quotation = await this.db.quotations.findOne({
      where: { id: quotationId, company_id: companyId, status: 'APPROVED' },
      transaction,
      lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
    });
    if (!quotation) throw new ChallanError(400, 'Approved quotation not found');

    const items = await this.db.quotation_items.findAll({
      where: { quotation_id: quotation.id },
      order: [['id', 'ASC']],
      transaction,
    });
    return { quotation, items };
  }

  // Sum of challan quantities per quotation item across all live (not
  // cancelled, not deleted) challans of this quotation.
  private async getDispatchedQtyMap(
    quotationId: number,
    companyId: number,
    transaction?: Transaction,
    excludeChallanId?: number,
  ): Promise<Map<number, number>> {
    const rows: any[] = await this.dbProvider.sequelize.query(
      `SELECT dci.quotation_item_id AS quotation_item_id,
              COALESCE(SUM(dci.quantity), 0) AS qty
       FROM delivery_challan_items dci
       INNER JOIN delivery_challans dc ON dc.id = dci.delivery_challan_id
       WHERE dc.company_id = :companyId
         AND dc.quotation_id = :quotationId
         AND dc.status <> 'CANCELLED'
         AND dc.is_active = 1
         AND dci.quotation_item_id IS NOT NULL
         ${excludeChallanId ? 'AND dc.id <> :excludeChallanId' : ''}
       GROUP BY dci.quotation_item_id`,
      {
        replacements: { companyId, quotationId, excludeChallanId: excludeChallanId ?? 0 },
        transaction,
        type: QueryTypes.SELECT,
      },
    );
    const map = new Map<number, number>();
    for (const row of rows) {
      map.set(Number(row.quotation_item_id), Number(row.qty || 0));
    }
    return map;
  }

  private quotationItemRate(item: any): number {
    const discounted = Number(item.discounted_rate);
    if (item.discounted_rate != null && discounted > 0) return round2(discounted);
    return round2(Number(item.rate || 0));
  }

  private placeFromSnapshots(shipping: any, billing: any): string | null {
    return shipping?.state || billing?.state || null;
  }

  // ---------------------------------------------------------------------------
  // Customer / address snapshots (same snapshot shape quotations use: the
  // customer_addresses row as JSON)
  // ---------------------------------------------------------------------------
  private async buildCustomerPart(
    customerId: number,
    billingAddressId: number | null,
    shippingAddressId: number | null,
    companyId: number,
    transaction: Transaction,
  ) {
    const customer = await this.db.customers.findOne({
      where: { id: customerId, company_id: companyId },
      include: [{ model: this.db.customer_addresses, as: 'addresses' }],
      transaction,
    });
    if (!customer) throw new ChallanError(400, 'Customer not found');

    const all: any[] = (customer as any).addresses || [];
    const active = all.filter((a) => Number(a.is_active ?? 1) === 1);

    const pick = (id: number | null, preferredType: string) => {
      if (id != null) {
        const found = all.find((a) => Number(a.id) === Number(id));
        if (!found) throw new ChallanError(400, 'Invalid address for this customer');
        return found;
      }
      return (
        active.find((a) => a.address_type === preferredType && Number(a.is_primary) === 1) ||
        active.find((a) => a.address_type === preferredType) ||
        active.find((a) => Number(a.is_primary) === 1) ||
        active[0] ||
        null
      );
    };

    const billing = pick(billingAddressId, 'BILLING');
    const shipping =
      shippingAddressId != null || billingAddressId == null
        ? pick(shippingAddressId, 'SHIPPING')
        : billing;

    const billingSnap = billing ? billing.toJSON() : null;
    const shippingSnap = shipping ? shipping.toJSON() : billingSnap;

    return {
      customer_id: Number(customer.id),
      customer_name: customer.display_name ?? null,
      customer_gst_number: customer.gst_number || billingSnap?.gst_number || null,
      billing_address_snapshot: billingSnap,
      shipping_address_snapshot: shippingSnap,
    };
  }

  // ---------------------------------------------------------------------------
  // Validation + payload resolution shared by create and update
  // ---------------------------------------------------------------------------
  private async resolvePayload(
    input: ResolvedInput,
    companyId: number,
    transaction: Transaction,
    existing?: any,
  ) {
    const isTransfer = input.reason === 'STOCK_TRANSFER';

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ChallanError(400, 'At least one item is required');
    }

    let customerPart: {
      customer_id: number | null;
      customer_name: string | null;
      customer_gst_number: string | null;
      billing_address_snapshot: any;
      shipping_address_snapshot: any;
    };

    // ---- Quotation-based challan
    if (input.quotation_id) {
      if (isTransfer) {
        throw new ChallanError(400, 'Stock transfer challans cannot be linked to a quotation');
      }
      const { quotation, items: qItems } = await this.loadApprovedQuotation(
        input.quotation_id,
        companyId,
        transaction,
        true,
      );
      const qItemMap = new Map<number, any>();
      for (const qi of qItems) qItemMap.set(Number(qi.id), qi);

      const requested = new Map<number, number>();
      for (const item of input.items) {
        if (item.quotation_item_id == null) continue;
        const qid = Number(item.quotation_item_id);
        if (!qItemMap.has(qid)) {
          throw new ChallanError(
            400,
            `Item "${item.item_name}" does not belong to the selected quotation`,
          );
        }
        requested.set(qid, (requested.get(qid) || 0) + Number(item.quantity));
      }

      const dispatched = await this.getDispatchedQtyMap(
        Number(quotation.id),
        companyId,
        transaction,
        existing ? Number(existing.id) : undefined,
      );

      const exceeded: string[] = [];
      for (const [qid, qty] of requested) {
        const qi = qItemMap.get(qid);
        const remaining = Math.max(
          0,
          round3(Number(qi.qty || 0) - Number(dispatched.get(qid) || 0)),
        );
        if (Number(qty) > remaining + EPS) {
          exceeded.push(`${qi.product_name} (remaining ${remaining}, requested ${round3(qty)})`);
        }
      }
      if (exceeded.length) {
        throw new ChallanError(
          400,
          `Quantity exceeds remaining quotation quantity: ${exceeded.join(', ')}`,
        );
      }

      customerPart = {
        customer_id: quotation.customer_id != null ? Number(quotation.customer_id) : null,
        customer_name: quotation.customer_name ?? null,
        customer_gst_number: quotation.customer_gst_number ?? null,
        billing_address_snapshot: normalizeJson(quotation.billing_address_snapshot),
        shipping_address_snapshot: normalizeJson(quotation.shipping_address_snapshot),
      };
    } else {
      // ---- Standalone challan
      if (input.items.some((i) => i.quotation_item_id != null)) {
        throw new ChallanError(400, 'quotation_item_id is only allowed on quotation-based challans');
      }
      if (!input.customer_id && !isTransfer) {
        throw new ChallanError(400, 'Customer is required');
      }
      if (input.customer_id) {
        const sameCustomer =
          existing && Number(existing.customer_id) === Number(input.customer_id);
        if (input.rebuildCustomer || !sameCustomer || existing?.quotation_id) {
          customerPart = await this.buildCustomerPart(
            Number(input.customer_id),
            input.billing_address_id,
            input.shipping_address_id,
            companyId,
            transaction,
          );
          // Same customer on edit: only the address side(s) actually sent are
          // replaced; the other side keeps its previously chosen snapshot.
          if (sameCustomer && !existing?.quotation_id) {
            if (input.billing_address_id == null) {
              customerPart.billing_address_snapshot = normalizeJson(
                existing.billing_address_snapshot,
              );
            }
            if (input.shipping_address_id == null) {
              customerPart.shipping_address_snapshot = normalizeJson(
                existing.shipping_address_snapshot,
              );
            }
          }
        } else {
          // Re-verify the stored customer still belongs to this company.
          const owned = await this.db.customers.findOne({
            where: { id: input.customer_id, company_id: companyId },
            attributes: ['id'],
            transaction,
          });
          if (!owned) throw new ChallanError(400, 'Customer not found');
          customerPart = {
            customer_id: Number(existing.customer_id),
            customer_name: existing.customer_name ?? null,
            customer_gst_number: existing.customer_gst_number ?? null,
            billing_address_snapshot: normalizeJson(existing.billing_address_snapshot),
            shipping_address_snapshot: normalizeJson(existing.shipping_address_snapshot),
          };
        }
      } else {
        customerPart = {
          customer_id: null,
          customer_name: null,
          customer_gst_number: null,
          billing_address_snapshot: null,
          shipping_address_snapshot: null,
        };
      }
    }

    // ---- Warehouses
    const fromId = input.from_warehouse_id ? Number(input.from_warehouse_id) : null;
    const toId = isTransfer && input.to_warehouse_id ? Number(input.to_warehouse_id) : null;
    if (isTransfer) {
      if (!fromId || !toId) {
        throw new ChallanError(400, 'Stock transfer requires both source and destination warehouses');
      }
      if (fromId === toId) {
        throw new ChallanError(400, 'Source and destination warehouses must be different');
      }
    }
    const warehouseIds = [fromId, toId].filter((x): x is number => x != null);
    let toWarehouse: any = null;
    if (warehouseIds.length) {
      const found = await this.db.warehouses.findAll({
        where: { id: { [Op.in]: warehouseIds }, company_id: companyId, is_active: 1 },
        transaction,
      });
      const foundIds = new Set(found.map((w: any) => Number(w.id)));
      if (!warehouseIds.every((id) => foundIds.has(id))) {
        throw new ChallanError(400, 'Warehouse not found');
      }
      toWarehouse = toId ? found.find((w: any) => Number(w.id) === toId) : null;
    }

    // ---- Products / variants
    const productIds = [
      ...new Set(
        input.items.filter((i) => i.product_id != null).map((i) => Number(i.product_id)),
      ),
    ];
    if (productIds.length) {
      const products = await this.db.products.findAll({
        where: { id: { [Op.in]: productIds }, company_id: companyId },
        attributes: ['id'],
        transaction,
      });
      if (products.length !== productIds.length) {
        throw new ChallanError(400, 'Product not found');
      }
    }
    const variantItems = input.items.filter((i) => i.variant_id != null);
    if (variantItems.length) {
      if (variantItems.some((i) => i.product_id == null)) {
        throw new ChallanError(400, 'variant_id requires product_id');
      }
      const variantIds = [...new Set(variantItems.map((i) => Number(i.variant_id)))];
      const variants = await this.db.product_variants.findAll({
        where: { id: { [Op.in]: variantIds } },
        attributes: ['id', 'product_id'],
        transaction,
      });
      const variantProduct = new Map<number, number>(
        variants.map((v: any) => [Number(v.id), Number(v.product_id)]),
      );
      for (const item of variantItems) {
        if (variantProduct.get(Number(item.variant_id)) !== Number(item.product_id)) {
          throw new ChallanError(400, `Invalid variant for item "${item.item_name}"`);
        }
      }
    }

    // ---- Items + totals (server-computed)
    const itemRows: ItemRow[] = input.items.map((item) => {
      const quantity = round3(Number(item.quantity));
      const rate = round2(Number(item.rate ?? 0));
      return {
        quotation_item_id: item.quotation_item_id != null ? Number(item.quotation_item_id) : null,
        product_id: item.product_id != null ? Number(item.product_id) : null,
        variant_id: item.variant_id != null ? Number(item.variant_id) : null,
        item_name: String(item.item_name).trim(),
        description: item.description ?? null,
        hsn_code: item.hsn_code ?? null,
        quantity,
        unit: item.unit ?? null,
        rate,
        value: round2(quantity * rate),
      };
    });
    if (itemRows.some((r) => !r.item_name)) {
      throw new ChallanError(400, 'Item name is required');
    }
    if (itemRows.some((r) => !(r.quantity > 0))) {
      throw new ChallanError(400, 'Item quantity must be greater than zero');
    }
    // product_inventory.stock_level is an INTEGER column: lines that move
    // stock must use whole quantities, otherwise MySQL would silently round.
    if (input.affects_stock && fromId != null) {
      const fractional = itemRows.filter(
        (r) => r.product_id != null && !isWholeQty(r.quantity),
      );
      if (fractional.length) {
        throw new ChallanError(
          400,
          `Quantity must be a whole number for stock-tracked items: ${fractional
            .map((r) => r.item_name)
            .join(', ')}`,
        );
      }
    }

    const totalQuantity = round3(itemRows.reduce((s, r) => s + Number(r.quantity), 0));
    const totalValue = round2(itemRows.reduce((s, r) => s + Number(r.value), 0));

    const placeOfSupply =
      input.place_of_supply ||
      this.placeFromSnapshots(
        customerPart.shipping_address_snapshot,
        customerPart.billing_address_snapshot,
      ) ||
      (toWarehouse?.state ?? null);

    const header = {
      challan_date: input.challan_date,
      reason: input.reason,
      quotation_id: input.quotation_id ? Number(input.quotation_id) : null,
      ...customerPart,
      place_of_supply: placeOfSupply,
      from_warehouse_id: fromId,
      to_warehouse_id: toId,
      transporter_name: input.transporter_name,
      vehicle_number: input.vehicle_number,
      eway_bill_number: input.eway_bill_number,
      notes: input.notes,
      affects_stock: input.affects_stock ? 1 : 0,
      total_quantity: totalQuantity,
      total_value: totalValue,
    };

    return { header, itemRows };
  }

  // ---------------------------------------------------------------------------
  // Stock movement
  // ---------------------------------------------------------------------------
  private aggregateStockLines(items: any[]): StockLine[] {
    const map = new Map<string, StockLine>();
    for (const item of items) {
      if (item.product_id == null) continue;
      const productId = Number(item.product_id);
      const variantId = item.variant_id != null ? Number(item.variant_id) : null;
      const key = `${productId}:${variantId ?? ''}`;
      const line = map.get(key) || {
        product_id: productId,
        variant_id: variantId,
        quantity: 0,
        names: [],
      };
      line.quantity = round3(line.quantity + Number(item.quantity));
      if (!line.names.includes(item.item_name)) line.names.push(item.item_name);
      map.set(key, line);
    }
    // Deterministic lock order to avoid deadlocks between concurrent movements.
    return [...map.values()].sort(
      (a, b) => a.product_id - b.product_id || (a.variant_id ?? 0) - (b.variant_id ?? 0),
    );
  }

  private async lockInventoryRow(
    line: StockLine,
    warehouseId: number,
    transaction: Transaction,
  ) {
    return this.db.product_inventory.findOne({
      where: {
        product_id: line.product_id,
        variant_id: line.variant_id,
        warehouse_id: warehouseId,
        is_active: 1,
      },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  // Removes stock from a warehouse; rejects the whole movement (caller's
  // transaction rolls back) if any line is short.
  private async decrementStock(
    lines: StockLine[],
    warehouseId: number,
    transaction: Transaction,
    errorPrefix: string,
  ) {
    const fractional = lines.filter((l) => !isWholeQty(l.quantity));
    if (fractional.length) {
      throw new ChallanError(
        400,
        `Quantity must be a whole number for stock-tracked items: ${fractional
          .map((l) => l.names.join(' / '))
          .join(', ')}`,
      );
    }
    const rows: Array<{ row: any; line: StockLine }> = [];
    const short: string[] = [];
    const needVariant: string[] = [];
    for (const line of lines) {
      const row = await this.lockInventoryRow(line, warehouseId, transaction);
      if (!row && line.variant_id == null) {
        // Stock may be held per variant: the challan line must name one.
        const variantRow = await this.db.product_inventory.findOne({
          where: {
            product_id: line.product_id,
            warehouse_id: warehouseId,
            is_active: 1,
            variant_id: { [Op.ne]: null },
          },
          attributes: ['id'],
          transaction,
        });
        if (variantRow) {
          needVariant.push(line.names.join(' / '));
          continue;
        }
      }
      const available = row ? Number(row.stock_level || 0) : 0;
      if (!row || available + EPS < line.quantity) {
        short.push(`${line.names.join(' / ')} (available ${available}, required ${line.quantity})`);
      } else {
        rows.push({ row, line });
      }
    }
    if (needVariant.length) {
      throw new ChallanError(
        400,
        `Stock for these items is tracked per variant — please select a variant: ${needVariant.join(', ')}`,
      );
    }
    if (short.length) {
      throw new ChallanError(400, `${errorPrefix}: ${short.join(', ')}`);
    }
    for (const { row, line } of rows) {
      await row.update(
        { stock_level: round3(Number(row.stock_level || 0) - line.quantity) },
        { transaction },
      );
    }
  }

  private async incrementStock(
    lines: StockLine[],
    warehouseId: number,
    transaction: Transaction,
  ) {
    for (const line of lines) {
      const row = await this.lockInventoryRow(line, warehouseId, transaction);
      if (row) {
        await row.update(
          { stock_level: round3(Number(row.stock_level || 0) + line.quantity) },
          { transaction },
        );
      } else {
        await this.db.product_inventory.create(
          {
            product_id: line.product_id,
            variant_id: line.variant_id ?? undefined,
            warehouse_id: warehouseId,
            stock_level: line.quantity,
            is_active: 1,
          },
          { transaction },
        );
      }
    }
  }

  // Locks every existing inventory row a movement touches, in one global
  // order (warehouse_id, product_id, variant_id), before any change is
  // applied — so dispatch/cancel of opposite-direction transfers cannot
  // acquire locks in conflicting orders.
  private async lockAllInventoryRows(
    lines: StockLine[],
    warehouseIds: number[],
    transaction: Transaction,
  ) {
    const sorted = [...new Set(warehouseIds)].sort((a, b) => a - b);
    for (const warehouseId of sorted) {
      for (const line of lines) {
        await this.lockInventoryRow(line, warehouseId, transaction);
      }
    }
  }

  private async assertWarehouseActive(
    warehouseId: number,
    companyId: number,
    transaction: Transaction,
    label: string,
  ) {
    const wh = await this.db.warehouses.findOne({
      where: { id: warehouseId, company_id: companyId, is_active: 1 },
      transaction,
    });
    if (!wh) throw new ChallanError(400, `${label} warehouse is not available`);
  }

  // ---------------------------------------------------------------------------
  // Read endpoints
  // ---------------------------------------------------------------------------
  private listIncludes() {
    return [
      { model: this.db.warehouses, as: 'from_warehouse', attributes: ['id', 'name'] },
      { model: this.db.warehouses, as: 'to_warehouse', attributes: ['id', 'name'] },
      { model: this.db.quotations, as: 'quotation', attributes: ['id', 'quotation_number'] },
      { model: this.db.invoices, as: 'invoice', attributes: ['id', 'invoice_number'] },
    ];
  }

  private flatten(json: any) {
    const { from_warehouse, to_warehouse, quotation, invoice, ...rest } = json;
    return {
      ...rest,
      billing_address_snapshot: normalizeJson(rest.billing_address_snapshot),
      shipping_address_snapshot: normalizeJson(rest.shipping_address_snapshot),
      from_warehouse_name: from_warehouse?.name ?? null,
      to_warehouse_name: to_warehouse?.name ?? null,
      quotation_number: quotation?.quotation_number ?? null,
      invoice_number: invoice?.invoice_number ?? null,
    };
  }

  async listChallans(query: ChallanListDto, req: ChallanRequester) {
    return this.run('listChallans', { companyId: req.companyId }, async () => {
      const page = Number(query.page) > 0 ? Number(query.page) : 1;
      const limit = Math.min(100, Number(query.limit) > 0 ? Number(query.limit) : 10);
      const offset = (page - 1) * limit;

      const where: any = { company_id: req.companyId, is_active: 1 };
      if (query.status) where.status = query.status;
      if (query.reason) where.reason = query.reason;
      if (query.customer_id) where.customer_id = Number(query.customer_id);
      if (query.quotation_id) where.quotation_id = Number(query.quotation_id);
      if (query.from_date || query.to_date) {
        where.challan_date = {
          ...(query.from_date && { [Op.gte]: query.from_date.substring(0, 10) }),
          ...(query.to_date && { [Op.lte]: query.to_date.substring(0, 10) }),
        };
      }
      const search = query.search?.trim();
      if (search) {
        const like = { [Op.like]: `%${search}%` };
        where[Op.or] = [
          { challan_number: like },
          { customer_name: like },
          { vehicle_number: like },
          { eway_bill_number: like },
          { transporter_name: like },
        ];
      }

      const [counts, result] = await Promise.all([
        this.Challans.findAll({
          attributes: [
            'status',
            [this.dbProvider.sequelize.fn('COUNT', this.dbProvider.sequelize.col('id')), 'count'],
          ],
          where: { company_id: req.companyId, is_active: 1 },
          group: ['status'],
          raw: true,
        }),
        this.Challans.findAndCountAll({
          where,
          include: this.listIncludes(),
          order: [
            ['challan_date', 'DESC'],
            ['id', 'DESC'],
          ],
          limit,
          offset,
          distinct: true,
        }),
      ]);

      const statusCounts: Record<string, number> = {
        DRAFT: 0,
        DISPATCHED: 0,
        DELIVERED: 0,
        INVOICED: 0,
        CANCELLED: 0,
      };
      for (const row of counts as any[]) statusCounts[row.status] = Number(row.count);

      const total = Number(result.count) || 0;
      return {
        success: true,
        message: 'Delivery challans fetched successfully',
        data: {
          rows: result.rows.map((r: any) => this.flatten(r.toJSON())),
          pagination: {
            total,
            page,
            limit,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
          },
          statusCounts,
        },
      };
    });
  }

  async getChallanDetails(id: number, req: ChallanRequester) {
    return this.run('getChallanDetails', { companyId: req.companyId, challanId: id }, async () => {
      const challan = await this.Challans.findOne({
        where: { id, company_id: req.companyId, is_active: 1 },
        include: [
          ...this.listIncludes(),
          { model: this.ChallanItems, as: 'items' },
          {
            model: this.ChallanLogs,
            as: 'activity',
            include: [
              {
                model: this.db.users,
                as: 'changed_by_user',
                attributes: ['id', 'first_name', 'last_name', 'email'],
              },
            ],
          },
        ],
        order: [
          [{ model: this.ChallanItems, as: 'items' }, 'id', 'ASC'],
          [{ model: this.ChallanLogs, as: 'activity' }, 'id', 'DESC'],
        ],
      });
      if (!challan) throw new ChallanError(404, NOT_FOUND);

      return {
        success: true,
        message: 'Delivery challan fetched successfully',
        data: this.flatten(challan.toJSON()),
      };
    });
  }

  async getChallanActivity(id: number, req: ChallanRequester) {
    return this.run('getChallanActivity', { companyId: req.companyId, challanId: id }, async () => {
      await this.findChallan(id, req.companyId);
      const logs = await this.ChallanLogs.findAll({
        where: { delivery_challan_id: id },
        include: [
          {
            model: this.db.users,
            as: 'changed_by_user',
            attributes: ['id', 'first_name', 'last_name', 'email'],
          },
        ],
        order: [['id', 'DESC']],
      });
      return { success: true, message: 'Activity fetched successfully', data: logs };
    });
  }

  async getQuotationRemaining(quotationId: number, req: ChallanRequester) {
    return this.run(
      'getQuotationRemaining',
      { companyId: req.companyId, quotationId },
      async () => {
        const { quotation, items } = await this.loadApprovedQuotation(
          quotationId,
          req.companyId,
        );
        const dispatched = await this.getDispatchedQtyMap(Number(quotation.id), req.companyId);

        // Quotation items carry no product_id; link to the catalog by name
        // within the company (same heuristic quotations use for catalog sync).
        const names = [
          ...new Set(
            items
              .map((i: any) => String(i.product_name || '').trim())
              .filter((n: string) => n.length > 0),
          ),
        ];
        const productByName = new Map<string, number>();
        if (names.length) {
          const products = await this.db.products.findAll({
            where: { company_id: req.companyId, is_active: 1, name: { [Op.in]: names } },
            attributes: ['id', 'name'],
            order: [['id', 'ASC']],
          });
          for (const p of products) {
            const key = String(p.name).trim().toLowerCase();
            if (!productByName.has(key)) productByName.set(key, Number(p.id));
          }
        }

        const billing = normalizeJson(quotation.billing_address_snapshot);
        const shipping = normalizeJson(quotation.shipping_address_snapshot);

        return {
          success: true,
          message: 'Remaining quantities fetched successfully',
          data: {
            quotation: {
              id: Number(quotation.id),
              quotation_number: quotation.quotation_number,
              status: quotation.status,
              has_invoice: Boolean(quotation.has_invoice),
              customer_id: quotation.customer_id != null ? Number(quotation.customer_id) : null,
              customer_name: quotation.customer_name ?? null,
              customer_gst_number: quotation.customer_gst_number ?? null,
              billing_address_snapshot: billing,
              shipping_address_snapshot: shipping,
              place_of_supply: this.placeFromSnapshots(shipping, billing),
            },
            items: items.map((qi: any) => {
              const ordered = round3(Number(qi.qty || 0));
              const done = round3(Number(dispatched.get(Number(qi.id)) || 0));
              return {
                quotation_item_id: Number(qi.id),
                product_id:
                  productByName.get(String(qi.product_name || '').trim().toLowerCase()) ?? null,
                variant_id: null,
                item_name: qi.product_name,
                description: qi.description ?? null,
                hsn_code: qi.hsn_code ?? null,
                unit: qi.unit ?? null,
                rate: this.quotationItemRate(qi),
                ordered_qty: ordered,
                dispatched_qty: done,
                remaining_qty: Math.max(0, round3(ordered - done)),
              };
            }),
          },
        };
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  async createChallan(body: CreateChallanDto, req: ChallanRequester) {
    return this.run('createChallan', { companyId: req.companyId }, async () => {
      const input: ResolvedInput = {
        challan_date: body.challan_date.substring(0, 10),
        reason: body.reason,
        quotation_id: body.quotation_id ?? null,
        customer_id: body.customer_id ?? null,
        billing_address_id: body.billing_address_id ?? null,
        shipping_address_id: body.shipping_address_id ?? null,
        rebuildCustomer: true,
        place_of_supply: body.place_of_supply ?? null,
        from_warehouse_id: body.from_warehouse_id ?? null,
        to_warehouse_id: body.to_warehouse_id ?? null,
        transporter_name: body.transporter_name ?? null,
        vehicle_number: body.vehicle_number ?? null,
        eway_bill_number: body.eway_bill_number ?? null,
        notes: body.notes ?? null,
        affects_stock: body.affects_stock ?? true,
        items: body.items,
      };

      const challanId = await this.inTransaction(async (transaction) => {
        const { header, itemRows } = await this.resolvePayload(
          input,
          req.companyId,
          transaction,
        );
        const { challanNumber, overallSequence } = await this.generateChallanNumber(
          req.companyId,
          transaction,
        );

        const challan = await this.Challans.create(
          {
            ...header,
            company_id: req.companyId,
            challan_number: challanNumber,
            overall_sequence: overallSequence,
            status: 'DRAFT',
            created_by: req.userId,
            updated_by: req.userId,
            is_active: 1,
          },
          { transaction },
        );
        await this.ChallanItems.bulkCreate(
          itemRows.map((r) => ({ ...r, delivery_challan_id: challan.id })),
          { transaction },
        );
        await this.logActivity(
          challan.id,
          'CREATED',
          null,
          {
            challan_number: challanNumber,
            reason: header.reason,
            quotation_id: header.quotation_id,
            total_quantity: header.total_quantity,
            total_value: header.total_value,
            items: itemRows.length,
          },
          req.userId,
          transaction,
        );
        return Number(challan.id);
      });

      const details = await this.getChallanDetails(challanId, req);
      return {
        success: true,
        message: 'Delivery challan created successfully',
        data: details.data,
      };
    });
  }

  async updateChallan(id: number, body: UpdateChallanDto, req: ChallanRequester) {
    return this.run('updateChallan', { companyId: req.companyId, challanId: id }, async () => {
      await this.inTransaction(async (transaction) => {
        const existing = await this.findChallan(id, req.companyId, transaction, true);
        if (existing.status !== 'DRAFT') {
          throw new ChallanError(400, 'Only draft challans can be edited');
        }

        const pick = <T>(value: T | undefined, fallback: T): T =>
          value !== undefined ? value : fallback;

        let items: ChallanItemDto[];
        if (body.items !== undefined) {
          items = body.items;
        } else {
          const rows = await this.ChallanItems.findAll({
            where: { delivery_challan_id: id },
            order: [['id', 'ASC']],
            transaction,
          });
          items = rows.map((r: any) => ({
            quotation_item_id: r.quotation_item_id ?? undefined,
            product_id: r.product_id ?? undefined,
            variant_id: r.variant_id ?? undefined,
            item_name: r.item_name,
            description: r.description ?? undefined,
            hsn_code: r.hsn_code ?? undefined,
            quantity: Number(r.quantity),
            unit: r.unit ?? undefined,
            rate: Number(r.rate || 0),
          }));
        }

        const existingDate =
          existing.challan_date instanceof Date
            ? existing.challan_date.toISOString().substring(0, 10)
            : String(existing.challan_date).substring(0, 10);

        const sameId = (a: any, b: any) =>
          (a == null ? null : Number(a)) === (b == null ? null : Number(b));
        const customerChanged =
          body.customer_id !== undefined && !sameId(body.customer_id, existing.customer_id);
        const quotationChanged =
          body.quotation_id !== undefined && !sameId(body.quotation_id, existing.quotation_id);
        const addressSent = body.billing_address_id != null || body.shipping_address_id != null;

        const input: ResolvedInput = {
          challan_date: body.challan_date ? body.challan_date.substring(0, 10) : existingDate,
          reason: body.reason ?? existing.reason,
          quotation_id: pick(body.quotation_id, existing.quotation_id ?? null) ?? null,
          customer_id: pick(body.customer_id, existing.customer_id ?? null) ?? null,
          billing_address_id: body.billing_address_id ?? null,
          shipping_address_id: body.shipping_address_id ?? null,
          // Snapshots are rebuilt only when the customer actually changes or
          // an address id is sent (re-sending the same customer_id is a no-op).
          rebuildCustomer: customerChanged || addressSent,
          // An explicit place_of_supply wins; otherwise it is re-derived only
          // when the customer/address/quotation changes.
          place_of_supply:
            body.place_of_supply !== undefined
              ? body.place_of_supply
              : customerChanged || addressSent || quotationChanged
                ? null
                : existing.place_of_supply ?? null,
          from_warehouse_id: pick(body.from_warehouse_id, existing.from_warehouse_id ?? null) ?? null,
          to_warehouse_id: pick(body.to_warehouse_id, existing.to_warehouse_id ?? null) ?? null,
          transporter_name: pick(body.transporter_name, existing.transporter_name ?? null) ?? null,
          vehicle_number: pick(body.vehicle_number, existing.vehicle_number ?? null) ?? null,
          eway_bill_number: pick(body.eway_bill_number, existing.eway_bill_number ?? null) ?? null,
          notes: pick(body.notes, existing.notes ?? null) ?? null,
          affects_stock:
            body.affects_stock !== undefined
              ? body.affects_stock
              : Number(existing.affects_stock ?? 1) === 1,
          items,
        };

        const { header, itemRows } = await this.resolvePayload(
          input,
          req.companyId,
          transaction,
          existing,
        );

        const before = existing.toJSON();
        await existing.update({ ...header, updated_by: req.userId }, { transaction });

        if (body.items !== undefined) {
          await this.ChallanItems.destroy({ where: { delivery_challan_id: id }, transaction });
          await this.ChallanItems.bulkCreate(
            itemRows.map((r) => ({ ...r, delivery_challan_id: id })),
            { transaction },
          );
        }

        const changed: Record<string, any> = {};
        const previous: Record<string, any> = {};
        for (const key of Object.keys(header)) {
          const a = JSON.stringify(before[key] ?? null);
          const b = JSON.stringify((header as any)[key] ?? null);
          if (a !== b) {
            previous[key] = before[key] ?? null;
            changed[key] = (header as any)[key] ?? null;
          }
        }
        if (body.items !== undefined) changed.items_replaced = itemRows.length;

        await this.logActivity(id, 'UPDATED', previous, changed, req.userId, transaction);
      });

      const details = await this.getChallanDetails(id, req);
      return {
        success: true,
        message: 'Delivery challan updated successfully',
        data: details.data,
      };
    });
  }

  async dispatchChallan(id: number, req: ChallanRequester) {
    return this.run('dispatchChallan', { companyId: req.companyId, challanId: id }, async () => {
      await this.inTransaction(async (transaction) => {
        const challan = await this.findChallan(id, req.companyId, transaction, true);
        if (challan.status !== 'DRAFT') {
          throw new ChallanError(400, 'Only draft challans can be dispatched');
        }

        const items = await this.ChallanItems.findAll({
          where: { delivery_challan_id: id },
          transaction,
        });
        const lines = this.aggregateStockLines(items);
        const fromId = challan.from_warehouse_id ? Number(challan.from_warehouse_id) : null;
        const toId = challan.to_warehouse_id ? Number(challan.to_warehouse_id) : null;
        const movesStock = Number(challan.affects_stock) === 1 && fromId != null;

        if (movesStock && lines.length) {
          await this.assertWarehouseActive(fromId as number, req.companyId, transaction, 'Source');
          if (challan.reason === 'STOCK_TRANSFER' && toId) {
            await this.assertWarehouseActive(toId, req.companyId, transaction, 'Destination');
          }
          await this.lockAllInventoryRows(
            lines,
            challan.reason === 'STOCK_TRANSFER' && toId ? [fromId as number, toId] : [fromId as number],
            transaction,
          );
          await this.decrementStock(
            lines,
            fromId as number,
            transaction,
            'Insufficient stock in source warehouse',
          );
          if (challan.reason === 'STOCK_TRANSFER' && toId) {
            await this.incrementStock(lines, toId, transaction);
          }
        }

        const before = this.snapshotOf(challan);
        await challan.update(
          { status: 'DISPATCHED', dispatched_at: new Date(), updated_by: req.userId },
          { transaction },
        );
        await this.logActivity(
          id,
          'DISPATCHED',
          before,
          {
            status: 'DISPATCHED',
            stock_moved: movesStock && lines.length > 0,
            from_warehouse_id: fromId,
            to_warehouse_id: toId,
          },
          req.userId,
          transaction,
        );
      });

      const details = await this.getChallanDetails(id, req);
      return { success: true, message: 'Delivery challan dispatched', data: details.data };
    });
  }

  async deliverChallan(id: number, req: ChallanRequester) {
    return this.run('deliverChallan', { companyId: req.companyId, challanId: id }, async () => {
      await this.inTransaction(async (transaction) => {
        const challan = await this.findChallan(id, req.companyId, transaction, true);
        if (challan.status !== 'DISPATCHED') {
          throw new ChallanError(400, 'Only dispatched challans can be marked delivered');
        }
        const before = this.snapshotOf(challan);
        await challan.update(
          { status: 'DELIVERED', delivered_at: new Date(), updated_by: req.userId },
          { transaction },
        );
        await this.logActivity(id, 'DELIVERED', before, { status: 'DELIVERED' }, req.userId, transaction);
      });

      const details = await this.getChallanDetails(id, req);
      return { success: true, message: 'Delivery challan marked as delivered', data: details.data };
    });
  }

  async cancelChallan(id: number, reason: string | undefined, req: ChallanRequester) {
    return this.run('cancelChallan', { companyId: req.companyId, challanId: id }, async () => {
      await this.inTransaction(async (transaction) => {
        const challan = await this.findChallan(id, req.companyId, transaction, true);
        if (challan.status === 'INVOICED') {
          throw new ChallanError(400, 'Invoiced challans cannot be cancelled');
        }
        if (challan.status === 'CANCELLED') {
          throw new ChallanError(400, 'Delivery challan is already cancelled');
        }
        if (!['DRAFT', 'DISPATCHED', 'DELIVERED'].includes(challan.status)) {
          throw new ChallanError(400, 'This challan cannot be cancelled');
        }

        const fromId = challan.from_warehouse_id ? Number(challan.from_warehouse_id) : null;
        const toId = challan.to_warehouse_id ? Number(challan.to_warehouse_id) : null;
        const stockWasMoved =
          challan.status !== 'DRAFT' && Number(challan.affects_stock) === 1 && fromId != null;
        let reversed = false;

        if (stockWasMoved) {
          const items = await this.ChallanItems.findAll({
            where: { delivery_challan_id: id },
            transaction,
          });
          const lines = this.aggregateStockLines(items);
          if (lines.length) {
            await this.lockAllInventoryRows(
              lines,
              challan.reason === 'STOCK_TRANSFER' && toId ? [fromId as number, toId] : [fromId as number],
              transaction,
            );
            // Reverse in the same order the dispatch applied it: take stock
            // back out of the destination first (transfer), then return it.
            if (challan.reason === 'STOCK_TRANSFER' && toId) {
              await this.decrementStock(
                lines,
                toId,
                transaction,
                'Cannot cancel — destination warehouse no longer holds the transferred stock',
              );
            }
            await this.incrementStock(lines, fromId as number, transaction);
            reversed = true;
          }
        }

        const before = this.snapshotOf(challan);
        await challan.update(
          { status: 'CANCELLED', cancelled_at: new Date(), updated_by: req.userId },
          { transaction },
        );
        await this.logActivity(
          id,
          'CANCELLED',
          before,
          { status: 'CANCELLED', reason: reason ?? null, stock_reversed: reversed },
          req.userId,
          transaction,
        );
      });

      const details = await this.getChallanDetails(id, req);
      return { success: true, message: 'Delivery challan cancelled', data: details.data };
    });
  }

  async deleteChallan(id: number, req: ChallanRequester) {
    return this.run('deleteChallan', { companyId: req.companyId, challanId: id }, async () => {
      await this.inTransaction(async (transaction) => {
        const challan = await this.findChallan(id, req.companyId, transaction, true);
        if (challan.status !== 'DRAFT') {
          throw new ChallanError(400, 'Only draft challans can be deleted');
        }
        const before = this.snapshotOf(challan);
        await challan.update({ is_active: 0, updated_by: req.userId }, { transaction });
        await this.logActivity(id, 'DELETED', before, { is_active: 0 }, req.userId, transaction);
      });
      return { success: true, message: 'Delivery challan deleted', data: { id } };
    });
  }

  async convertToInvoice(id: number, paymentDueDate: string, req: ChallanRequester) {
    return this.run('convertToInvoice', { companyId: req.companyId, challanId: id }, async () => {
      const challan = await this.findChallan(id, req.companyId);
      if (!challan.quotation_id) {
        throw new ChallanError(400, 'Only quotation-based challans can be converted');
      }
      if (!['DISPATCHED', 'DELIVERED'].includes(challan.status)) {
        throw new ChallanError(400, 'Only dispatched or delivered challans can be converted');
      }
      const quotationId = Number(challan.quotation_id);

      // Never link a cancelled invoice: INVOICED challans are terminal.
      const findInvoice = () =>
        this.db.invoices.findOne({
          where: {
            quotation_id: quotationId,
            company_id: req.companyId,
            status: { [Op.ne]: 'CANCELLED' },
          },
          attributes: ['id', 'invoice_number'],
        });
      const assertNoCancelledInvoice = async () => {
        const cancelled = await this.db.invoices.findOne({
          where: { quotation_id: quotationId, company_id: req.companyId, status: 'CANCELLED' },
          attributes: ['id'],
        });
        if (cancelled) {
          throw new ChallanError(
            400,
            "The quotation's invoice is cancelled; the challan cannot be converted",
          );
        }
      };

      let invoice = await findInvoice();
      let generated = false;
      if (!invoice) {
        await assertNoCancelledInvoice();
        // Existing invoice flow, unchanged: it runs its own transaction.
        try {
          const result: any = await this.invoiceService.generateInvoice(
            quotationId,
            { payment_due_date: paymentDueDate } as any,
            req.userId,
            req.companyId,
          );
          if (!result?.data) {
            throw new ChallanError(400, result?.message || 'Failed to generate invoice');
          }
          generated = true;
        } catch (error) {
          if (error instanceof ChallanError) throw error;
          // Lost a race with a concurrent generation: link whatever exists.
          invoice = await findInvoice();
          if (!invoice) {
            if (error instanceof HttpException) {
              const response: any = error.getResponse();
              const message =
                (typeof response === 'object' && response?.message) || error.message;
              throw new ChallanError(
                error.getStatus() >= 500 ? 500 : 400,
                Array.isArray(message) ? message.join(', ') : String(message),
              );
            }
            throw error;
          }
        }
        if (!invoice) invoice = await findInvoice();
        if (!invoice) throw new ChallanError(500, 'Invoice was not created');
      }

      const invoiceId = Number(invoice.id);
      const converted = await this.inTransaction(async (transaction) => {
        const locked = await this.findChallan(id, req.companyId, transaction, true);
        if (!['DISPATCHED', 'DELIVERED'].includes(locked.status)) {
          throw new ChallanError(400, 'Only dispatched or delivered challans can be converted');
        }
        const siblings = await this.Challans.findAll({
          where: {
            company_id: req.companyId,
            quotation_id: quotationId,
            is_active: 1,
            status: { [Op.in]: ['DISPATCHED', 'DELIVERED'] },
          },
          order: [['id', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        for (const c of siblings) {
          const before = this.snapshotOf(c);
          await c.update(
            { status: 'INVOICED', invoice_id: invoiceId, updated_by: req.userId },
            { transaction },
          );
          await this.logActivity(
            Number(c.id),
            'INVOICED',
            before,
            {
              status: 'INVOICED',
              invoice_id: invoiceId,
              invoice_number: invoice.invoice_number,
              invoice_generated: generated,
              triggered_by_challan_id: id,
            },
            req.userId,
            transaction,
          );
        }
        return siblings.map((c: any) => Number(c.id));
      });

      const details = await this.getChallanDetails(id, req);
      return {
        success: true,
        message: generated
          ? 'Invoice generated and linked to delivery challan'
          : 'Delivery challan linked to existing invoice',
        data: {
          challan: details.data,
          invoice: { id: invoiceId, invoice_number: invoice.invoice_number },
          invoice_generated: generated,
          converted_challan_ids: converted,
        },
      };
    });
  }
}
