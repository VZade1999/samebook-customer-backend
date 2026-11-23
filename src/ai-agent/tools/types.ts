import type { CustomerService } from '../../customers/customers.service';
import type { CustomerDirectoryService } from '../../customers/customer-directory.service';
import type { ProductService } from '../../products/products.service';
import type { ProductCatalogService } from '../../products/product-catalog.service';
import type { StockService } from '../../stock/stock.service';
import type { QuotationService } from '../../quotations/quotations.service';
import type { DeliveryChallanService } from '../../delivery-challan/delivery-challan.service';
import type { InvoiceService } from '../../invoice/invoice.service';
import type { DashboardService } from '../../dashboard/dashboard.service';
import type { CompanyService } from '../../companies/companies.service';
import type { AiLookupService } from '../ai-lookup.service';
import type { PurchaseOrdersService } from '../../purchases/purchase-orders.service';
import type { SuppliersService } from '../../purchases/suppliers.service';
import type { PurchaseBillsService } from '../../purchases/purchase-bills.service';
import type { RecordType, ToolKind } from '../ai-agent.rules';

/** The signed-in person, from their login token (never from the AI). */
export interface AiUser {
  company_id: number;
  user_id: number;
  permissions: string[];
  roles?: string[];
  email?: string;
}

/** Everything the abilities may call, injected once by the AI module. */
export interface AiServices {
  customers: CustomerService;
  directory: CustomerDirectoryService;
  products: ProductService;
  catalog: ProductCatalogService;
  stock: StockService;
  quotations: QuotationService;
  challans: DeliveryChallanService;
  invoices: InvoiceService;
  dashboard: DashboardService;
  company: CompanyService;
  lookup: AiLookupService;
  /** Purchases (add-on): purchase orders with goods received, suppliers, supplier bills. */
  purchaseOrders: PurchaseOrdersService;
  suppliers: SuppliersService;
  bills: PurchaseBillsService;
}

export interface ToolContext {
  user: AiUser;
  /** Today in the person's time zone (YYYY-MM-DD). */
  today: string;
  /** Minutes east of UTC. */
  tz: number;
  can: (permission: string) => boolean;
  /** May see money totals (invoices.view + invoices.insides). */
  money: boolean;
  s: AiServices;
}

export interface ToolRecord {
  type: RecordType;
  id: number;
  label: string;
}

/** What an ability returns: `data` goes to the AI; `message` and `record` to the person. */
export interface ToolOutput {
  ok: boolean;
  message?: string;
  data?: unknown;
  /** The record created / changed / shown, for the "Open" link under the reply. */
  record?: ToolRecord;
}

/** A risky action, checked and described before it waits for Confirm. */
export interface Prepared {
  /** One line on the card: "Delete customer Sharma Traders". */
  summary: string;
  /** A few lines of detail under it. */
  details?: string[];
  /** The exact arguments that will run on Confirm. */
  args: Record<string, any>;
  record?: ToolRecord;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

export interface AiTool {
  name: string;
  /** Group and label for "What I can do" (e.g. Customers → "Delete customers"). */
  group: string;
  label: string;
  /** What the AI reads to decide when to use it. Keep it short: it is sent with every message. */
  description: string;
  parameters: JsonSchemaObject;
  /** Same permissions as the matching page or button (all required). */
  permissions: string[];
  /** read = look-up; write = runs at once (logged); confirm = waits for the person's Confirm. */
  kind: ToolKind;
  /** Add-on the ability belongs to, if any. */
  module?: string;
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolOutput>;
  /** Confirm abilities only: validate, look up names, and describe what will happen. Throw ToolRefusal to stop. */
  prepare?(args: Record<string, any>, ctx: ToolContext): Promise<Prepared>;
}

/** A plain-language refusal ("That quotation was not found"), shown to the AI and the person. */
export class ToolRefusal extends Error {}

/** Reads a service result ({ success, message, data }) as a tool outcome. */
export const fromResult = (r: any, fallback: string): { ok: boolean; message: string; data: any } => ({
  ok: !!r?.success,
  message: String(r?.message || fallback),
  data: r?.data ?? null,
});
