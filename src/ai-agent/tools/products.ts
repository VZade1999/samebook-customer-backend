import { COUNT_REASONS, LINES_MAX, QTY_MAX } from '../../stock/stock.rules';
import { idOf, inr, intIn, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal, fromResult } from './types';

const FILTERS = ['all', 'quoted', 'never', 'no_price', 'no_hsn', 'duplicates', 'low_stock', 'new', 'archived'];
const SORTS = ['recent', 'name', 'quoted', 'last_quoted', 'price_high', 'price_low'];
const STOCK_STATUS = ['all', 'in', 'low', 'out'];
const STOCK_SORTS = ['name', 'stock_high', 'stock_low', 'value'];
const MOVE_TYPES = ['OPENING', 'RECEIVED', 'COUNTED', 'MOVED', 'DISPATCHED', 'DISPATCH_CANCELLED'];
const MAX_LINES = Math.min(50, LINES_MAX);

const productId = (args: Record<string, any>) => {
  const id = idOf(args.id);
  if (!id) throw new ToolRefusal('Which product? Find it first to get its id');
  return id;
};

const money = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ToolRefusal('Prices must be zero or more');
  return Math.round(n * 100) / 100;
};

const gst = (v: unknown) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ToolRefusal(`${v}% isn't a GST rate`);
  return Math.round(n * 100) / 100;
};

/** Stock lines from the AI: whole quantities, known products, no repeats. */
function stockLines(raw: unknown, key: 'qty' | 'counted') {
  if (!Array.isArray(raw) || !raw.length) throw new ToolRefusal('Say which products and how many');
  if (raw.length > MAX_LINES) throw new ToolRefusal(`At most ${MAX_LINES} products at a time`);
  const seen = new Set<number>();
  return raw.map((l: any) => {
    const product_id = idOf(l?.product_id);
    if (!product_id) throw new ToolRefusal('Each line needs a product id — find the products first');
    if (seen.has(product_id)) throw new ToolRefusal('A product is listed twice — put it on one line');
    seen.add(product_id);
    const n = Number(l?.[key]);
    if (!Number.isInteger(n)) throw new ToolRefusal('Stock is kept in whole units');
    if (key === 'qty' ? n <= 0 : n < 0) throw new ToolRefusal(key === 'qty' ? 'Quantities must be more than 0' : 'A count can’t be below 0');
    if (n > QTY_MAX) throw new ToolRefusal('That quantity is too large');
    const unit_cost = key === 'qty' && l?.unit_cost !== undefined && l?.unit_cost !== null ? money(l.unit_cost) : undefined;
    return { product_id, n, unit_cost };
  });
}

async function namesFor(ctx: ToolContext, ids: number[]) {
  const names = await ctx.s.lookup.productNames(ctx.user.company_id, ids);
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length) throw new ToolRefusal(`Product${missing.length > 1 ? 's' : ''} ${missing.map((id) => `#${id}`).join(', ')} not found (or archived)`);
  return names;
}

async function warehouseOf(ctx: ToolContext, id: unknown, what: string, allowArchived = false) {
  const wid = idOf(id);
  if (!wid) throw new ToolRefusal(`Which warehouse ${what}? Use list_warehouses to see them`);
  const w = (await ctx.s.lookup.warehouseNames(ctx.user.company_id, [wid])).get(wid);
  if (!w && !allowArchived) throw new ToolRefusal('That warehouse was not found');
  if (w && !w.active && !allowArchived) throw new ToolRefusal(`${w.name} is archived — pick an active warehouse`);
  return { id: wid, name: w?.name || `Unknown warehouse #${wid}` };
}

const unitsText = (n: number, unit: string | null | undefined) => `${n}${unit ? ` ${unit}` : ''}`;

export const productTools: AiTool[] = [
  {
    name: 'find_products',
    group: 'Products & stock',
    label: 'Find products',
    description:
      'Search products by name, HSN, SKU or category. Returns price, GST, unit, stock in each warehouse and the last quoted rate. Filters: low_stock, never (never quoted), no_price, no_hsn, duplicates, new, archived.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        filter: { type: 'string', enum: FILTERS },
        category_id: { type: 'number' },
        warehouse_id: { type: 'number', description: 'Only products kept in this warehouse' },
        sort: { type: 'string', enum: SORTS },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['products.view'],
    kind: 'read',
    async run(args, ctx) {
      const d = await ctx.s.catalog.catalog(ctx.user.company_id, ctx.user.permissions, {
        search: textOf(args.search, 100) || '',
        filter: FILTERS.includes(args.filter) ? args.filter : 'all',
        category: idOf(args.category_id) ? String(args.category_id) : '',
        warehouse: idOf(args.warehouse_id) ? String(args.warehouse_id) : '',
        sort: SORTS.includes(args.sort) ? args.sort : args.search ? 'name' : 'recent',
        limit: intIn(args.limit, 1, 25, 10),
        page: 1,
      });
      return {
        ok: true,
        data: {
          total: d.pagination.total,
          products: d.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            hsn: p.hsn || undefined,
            unit: p.unit || undefined,
            price: p.price,
            gst_percent: p.gst,
            cost: p.cost || undefined,
            category: p.category || undefined,
            stock: p.places.length ? p.places.reduce((s: number, x: any) => s + x.qty, 0) : undefined,
            min_stock: p.min_stock || undefined,
            kept_in: p.places.length ? p.places.map((x: any) => ({ warehouse: x.name, warehouse_id: x.warehouse_id, qty: x.qty, rack: x.bin || undefined })) : undefined,
            last_quoted_rate: p.last_rate ?? undefined,
            quotations: p.quoted || undefined,
            archived: p.active ? undefined : true,
            link: recordLink('product', p.id),
          })),
        },
      };
    },
  },
  {
    name: 'product_details',
    group: 'Products & stock',
    label: 'Product details: rates, buyers, stock',
    description: "One product's price, rates quoted (low/high/last), main buyers, recent quotations/challans/invoices, stock per warehouse and latest stock changes.",
    parameters: { type: 'object', properties: { id: { type: 'number', description: 'Product id' } }, required: ['id'] },
    permissions: ['products.view'],
    kind: 'read',
    async run(args, ctx) {
      const id = productId(args);
      const c = await ctx.s.catalog.catalog(ctx.user.company_id, ctx.user.permissions, { id: String(id) });
      const p: any = c.products[0];
      if (!p) throw new ToolRefusal('That product was not found');
      const a: any = await ctx.s.catalog.activity(ctx.user.company_id, id, ctx.user.permissions);
      return {
        ok: true,
        record: { type: 'product', id, label: p.name },
        data: {
          id,
          name: p.name,
          hsn: p.hsn || undefined,
          unit: p.unit || undefined,
          price: p.price,
          gst_percent: p.gst,
          cost: p.cost || undefined,
          category: p.category || undefined,
          sku: p.sku || undefined,
          min_stock: p.min_stock || undefined,
          archived: p.active ? undefined : true,
          quoted: a.quotations
            ? { count: a.quotations.count, customers: a.quotations.customers, rates: a.quotations.rates, buyers: a.quotations.buyers?.slice(0, 5), recent: a.quotations.recent?.slice(0, 5) }
            : undefined,
          invoiced: a.invoices ? { count: a.invoices.count, qty: a.invoices.qty, amount: a.invoices.amount ?? undefined, last: a.invoices.last } : undefined,
          dispatched: a.challans ? { count: a.challans.count, qty: a.challans.qty } : undefined,
          stock: a.stock?.map((x: any) => ({ warehouse: x.name, warehouse_id: x.warehouse_id, qty: x.qty, rack: x.bin || undefined, default: x.is_default || undefined })),
          latest_stock_changes: a.history?.slice(0, 5).map((m: any) => ({ at: m.at, type: m.type, qty: m.quantity, balance: m.balance_after, warehouse: m.warehouse, by: m.by || undefined })),
          link: recordLink('product', id),
        },
      };
    },
  },
  {
    name: 'create_product',
    group: 'Products & stock',
    label: 'Add products',
    description:
      'Add a product. Check with find_products first (names must be unique). opening_stock needs the "Manage stock" permission and goes to warehouse_id (default warehouse if not given).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: { type: 'number', description: 'Selling price per unit, before GST' },
        unit: { type: 'string', description: 'e.g. NOS, MTR, KG, BOX' },
        hsn: { type: 'string', description: 'HSN code' },
        gst_percent: { type: 'number', description: 'e.g. 18' },
        cost_price: { type: 'number' },
        category_id: { type: 'number' },
        sku: { type: 'string' },
        description: { type: 'string' },
        min_stock: { type: 'number', description: 'Low-stock alert level' },
        opening_stock: { type: 'number' },
        warehouse_id: { type: 'number' },
        rack: { type: 'string', description: 'Rack / shelf in the warehouse' },
      },
      required: ['name', 'price'],
    },
    permissions: ['products.create'],
    kind: 'write',
    async run(args, ctx) {
      const name = textOf(args.name, 200);
      if (!name) throw new ToolRefusal('Give the product a name');
      const opening = args.opening_stock !== undefined ? Number(args.opening_stock) : 0;
      if (!Number.isInteger(opening) || opening < 0) throw new ToolRefusal('Opening stock must be a whole number');
      const data: any = {
        name,
        price: money(args.price) ?? 0,
        unit: textOf(args.unit, 20)?.toUpperCase() || undefined,
        product_code: textOf(args.hsn, 20) || undefined,
        tax_percentage: gst(args.gst_percent),
        cost_price: money(args.cost_price),
        category_id: idOf(args.category_id) || undefined,
        sku: textOf(args.sku, 64) || undefined,
        description: textOf(args.description, 1000) || undefined,
        minimum_stock: args.min_stock !== undefined ? intIn(args.min_stock, 0, QTY_MAX, 0) : undefined,
        stock_quantity: opening,
        warehouse_id: idOf(args.warehouse_id) || undefined,
        bin_location: textOf(args.rack, 64) || undefined,
      };
      const r = fromResult(await ctx.s.products.createProduct(data, ctx.user), 'Could not add the product');
      const id = Number(r.data?.id) || null;
      return {
        ok: r.ok,
        message: r.ok ? `Added product ${name}` : r.message,
        record: r.ok && id ? { type: 'product', id, label: name } : undefined,
        data: r.ok ? { id, name, link: id ? recordLink('product', id) : undefined } : { error: r.message },
      };
    },
  },
  {
    name: 'update_product',
    group: 'Products & stock',
    label: 'Edit products',
    description: "Change a product's name, price, unit, HSN, GST, cost, category, SKU, description or low-stock level. Stock itself changes only through receive_stock / move_stock / count_stock.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
        price: { type: 'number' },
        unit: { type: 'string' },
        hsn: { type: 'string' },
        gst_percent: { type: 'number' },
        cost_price: { type: 'number' },
        category_id: { type: 'number' },
        sku: { type: 'string' },
        description: { type: 'string' },
        min_stock: { type: 'number' },
      },
      required: ['id'],
    },
    permissions: ['products.edit'],
    kind: 'write',
    async run(args, ctx) {
      const id = productId(args);
      const names = await namesFor(ctx, [id]);
      const data: any = {};
      if (args.name !== undefined) data.name = textOf(args.name, 200) || undefined;
      if (args.price !== undefined) data.price = money(args.price);
      if (args.unit !== undefined) data.unit = textOf(args.unit, 20)?.toUpperCase();
      if (args.hsn !== undefined) data.product_code = textOf(args.hsn, 20);
      if (args.gst_percent !== undefined) data.tax_percentage = gst(args.gst_percent);
      if (args.cost_price !== undefined) data.cost_price = money(args.cost_price);
      if (args.category_id !== undefined) data.category_id = idOf(args.category_id);
      if (args.sku !== undefined) data.sku = textOf(args.sku, 64);
      if (args.description !== undefined) data.description = textOf(args.description, 1000);
      if (args.min_stock !== undefined) data.minimum_stock = intIn(args.min_stock, 0, QTY_MAX, 0);
      Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
      if (!Object.keys(data).length) throw new ToolRefusal('Nothing to change — say what should change');
      const r = fromResult(await ctx.s.products.updateProduct(id, data, ctx.user), 'Could not update the product');
      const label = data.name || names.get(id)!.name;
      return {
        ok: r.ok,
        message: r.ok ? `Updated product ${label}` : r.message,
        record: r.ok ? { type: 'product', id, label } : undefined,
        data: r.ok ? { id, updated: Object.keys(data), link: recordLink('product', id) } : { error: r.message },
      };
    },
  },
  {
    name: 'archive_product',
    group: 'Products & stock',
    label: 'Archive products',
    description: 'Archive (hide) a product. It stays on old documents and can be restored on the Products page. Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['products.delete'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const id = productId(args);
      const p = (await namesFor(ctx, [id])).get(id)!;
      return {
        summary: `Archive product ${p.name}`,
        details: ['It disappears from pickers and lists.', 'Old quotations, challans and invoices keep it; you can restore it from Products → Archived.'],
        args: { id },
        record: { type: 'product', id, label: p.name },
      };
    },
    async run(args, ctx) {
      const id = productId(args);
      const p = (await namesFor(ctx, [id])).get(id)!;
      const r = fromResult(await ctx.s.products.deleteProduct(id, ctx.user), 'Could not archive the product');
      return { ok: r.ok, message: r.ok ? `Archived product ${p.name}` : r.message, data: { ok: r.ok, message: r.message } };
    },
  },
  {
    name: 'stock_levels',
    group: 'Products & stock',
    label: 'Stock levels by warehouse',
    description: 'Stock of tracked products in each warehouse, with low / out status and stock value at cost. status: low, out, in, all.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string', enum: STOCK_STATUS },
        warehouse_id: { type: 'number' },
        category_id: { type: 'number' },
        sort: { type: 'string', enum: STOCK_SORTS },
        limit: { type: 'number', description: 'Rows (default 15, max 30)' },
      },
    },
    permissions: ['products.view'],
    kind: 'read',
    async run(args, ctx) {
      const d: any = await ctx.s.stock.levels(ctx.user.company_id, {
        search: textOf(args.search, 80) || '',
        status: STOCK_STATUS.includes(args.status) ? args.status : 'all',
        warehouse: idOf(args.warehouse_id) ? String(args.warehouse_id) : '',
        category: idOf(args.category_id) ? String(args.category_id) : '',
        sort: STOCK_SORTS.includes(args.sort) ? args.sort : args.status === 'low' || args.status === 'out' ? 'stock_low' : 'name',
        limit: intIn(args.limit, 1, 30, 15),
        page: 1,
      });
      const whName = new Map<number, string>(d.warehouses.map((w: any) => [w.id, w.name]));
      return {
        ok: true,
        data: {
          summary: d.stats,
          matching: d.pagination.total,
          products: d.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            unit: p.unit || undefined,
            total: p.total,
            min_stock: p.min || undefined,
            status: p.status,
            value_at_cost: p.value || undefined,
            kept_in: p.places.map((x: any) => ({ warehouse: whName.get(x.warehouse_id) || `Warehouse #${x.warehouse_id}`, warehouse_id: x.warehouse_id, qty: x.qty, rack: x.bin || undefined })),
            link: recordLink('product', p.id),
          })),
        },
      };
    },
  },
  {
    name: 'list_warehouses',
    group: 'Products & stock',
    label: 'Warehouses and what they hold',
    description: 'Every warehouse with its address, products, units, stock value, alerts and last change. Also stock left in archived or deleted warehouses.',
    parameters: { type: 'object', properties: {} },
    permissions: ['warehouses.view'],
    kind: 'read',
    async run(_args, ctx) {
      const d: any = await ctx.s.stock.warehouses(ctx.user.company_id);
      const card = (w: any) => ({
        id: w.id,
        name: w.name,
        default: w.is_default || undefined,
        place: [w.city, w.state].filter(Boolean).join(', ') || undefined,
        products: w.products,
        units: w.units,
        value_at_cost: w.value || undefined,
        low_stock_alerts: w.alerts || undefined,
        last_change: w.last_change || undefined,
        link: recordLink('warehouse', w.id),
      });
      return { ok: true, data: { warehouses: d.warehouses.map(card), stock_elsewhere: d.elsewhere.length ? d.elsewhere.map(card) : undefined } };
    },
  },
  {
    name: 'stock_history',
    group: 'Products & stock',
    label: 'Stock history',
    description: 'Who received, moved, counted or dispatched stock, newest first. Filter by product, warehouse, type or the last N days.',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'number' },
        warehouse_id: { type: 'number' },
        type: { type: 'string', enum: MOVE_TYPES },
        days: { type: 'number', description: 'Only the last N days' },
        search: { type: 'string', description: 'Product name, bill no. or note' },
        limit: { type: 'number', description: 'Rows (default 15, max 30)' },
      },
    },
    permissions: ['products.view'],
    kind: 'read',
    async run(args, ctx) {
      const d: any = await ctx.s.stock.history(ctx.user.company_id, {
        product: idOf(args.product_id) ? String(args.product_id) : '',
        warehouse: idOf(args.warehouse_id) ? String(args.warehouse_id) : '',
        type: MOVE_TYPES.includes(args.type) ? args.type : '',
        days: idOf(args.days) ? String(Math.min(3650, Number(args.days))) : '',
        search: textOf(args.search, 80) || '',
        limit: intIn(args.limit, 1, 30, 15),
        page: 1,
      });
      return {
        ok: true,
        data: {
          total: d.pagination.total,
          changes: d.movements.map((m: any) => ({
            at: m.at,
            type: m.type,
            product: m.product.name,
            product_id: m.product.id,
            qty: m.quantity,
            balance_after: m.balance_after,
            warehouse: m.warehouse?.name,
            other_warehouse: m.other_warehouse || undefined,
            reason: m.reason || undefined,
            reference: m.reference?.no || undefined,
            note: m.note || undefined,
            by: m.by || undefined,
          })),
        },
      };
    },
  },
  {
    name: 'receive_stock',
    group: 'Products & stock',
    label: 'Receive stock',
    description:
      'Goods arrived from a supplier: add stock to one warehouse. unit_cost (optional) becomes the product cost price. Needs the person to press Confirm.',
    parameters: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'number' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { product_id: { type: 'number' }, qty: { type: 'number' }, unit_cost: { type: 'number' } },
            required: ['product_id', 'qty'],
          },
        },
        bill_no: { type: 'string', description: "Supplier's bill / invoice number" },
        note: { type: 'string' },
      },
      required: ['warehouse_id', 'lines'],
    },
    permissions: ['stock.manage'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const w = await warehouseOf(ctx, args.warehouse_id, 'did the goods arrive at');
      const lines = stockLines(args.lines, 'qty');
      const names = await namesFor(ctx, lines.map((l) => l.product_id));
      const units = lines.reduce((s, l) => s + l.n, 0);
      return {
        summary: `Receive ${units} unit${units === 1 ? '' : 's'} of ${lines.length} product${lines.length === 1 ? '' : 's'} into ${w.name}`,
        details: [
          ...lines.slice(0, 8).map((l) => {
            const p = names.get(l.product_id)!;
            return `${p.name}: +${unitsText(l.n, p.unit)}${l.unit_cost !== undefined ? ` at ${inr(l.unit_cost)} (new cost price)` : ''}`;
          }),
          ...(lines.length > 8 ? [`…and ${lines.length - 8} more`] : []),
          ...(textOf(args.bill_no) ? [`Bill no. ${textOf(args.bill_no, 64)}`] : []),
        ],
        args: {
          warehouse_id: w.id,
          bill_no: textOf(args.bill_no, 64) || undefined,
          note: textOf(args.note, 255) || undefined,
          lines: lines.map((l) => ({ product_id: l.product_id, qty: l.n, ...(l.unit_cost !== undefined ? { unit_cost: l.unit_cost } : {}) })),
        },
        record: { type: 'warehouse', id: w.id, label: w.name },
      };
    },
    async run(args, ctx) {
      const w = await warehouseOf(ctx, args.warehouse_id, 'did the goods arrive at');
      const lines = stockLines(args.lines, 'qty');
      await ctx.s.stock.receive(ctx.user.company_id, ctx.user.user_id, {
        warehouse_id: w.id,
        reference_no: textOf(args.bill_no, 64),
        note: textOf(args.note, 255),
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.n, unit_cost: l.unit_cost ?? null })),
      });
      const units = lines.reduce((s, l) => s + l.n, 0);
      return { ok: true, message: `Received ${units} unit${units === 1 ? '' : 's'} into ${w.name}`, data: { ok: true }, record: { type: 'warehouse', id: w.id, label: w.name } };
    },
  },
  {
    name: 'move_stock',
    group: 'Products & stock',
    label: 'Move stock between warehouses',
    description: 'Move stock from one warehouse to another (it must be there). Needs the person to press Confirm.',
    parameters: {
      type: 'object',
      properties: {
        from_warehouse_id: { type: 'number' },
        to_warehouse_id: { type: 'number' },
        lines: {
          type: 'array',
          items: { type: 'object', properties: { product_id: { type: 'number' }, qty: { type: 'number' } }, required: ['product_id', 'qty'] },
        },
        note: { type: 'string' },
      },
      required: ['from_warehouse_id', 'to_warehouse_id', 'lines'],
    },
    permissions: ['stock.manage'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const from = await warehouseOf(ctx, args.from_warehouse_id, 'is the stock in now', true);
      const to = await warehouseOf(ctx, args.to_warehouse_id, 'should it go to');
      if (from.id === to.id) throw new ToolRefusal('Pick two different warehouses');
      const lines = stockLines(args.lines, 'qty');
      const names = await namesFor(ctx, lines.map((l) => l.product_id));
      const have = await ctx.s.lookup.stockIn(from.id, lines.map((l) => l.product_id));
      const short = lines.filter((l) => (have.get(l.product_id) || 0) < l.n);
      if (short.length) {
        throw new ToolRefusal(
          `Not enough in ${from.name}: ${short.map((l) => `${names.get(l.product_id)!.name} (has ${have.get(l.product_id) || 0}, needs ${l.n})`).join(', ')}`,
        );
      }
      const units = lines.reduce((s, l) => s + l.n, 0);
      return {
        summary: `Move ${units} unit${units === 1 ? '' : 's'} from ${from.name} to ${to.name}`,
        details: [
          ...lines.slice(0, 8).map((l) => {
            const p = names.get(l.product_id)!;
            return `${p.name}: ${unitsText(l.n, p.unit)} (${from.name} keeps ${(have.get(l.product_id) || 0) - l.n})`;
          }),
          ...(lines.length > 8 ? [`…and ${lines.length - 8} more`] : []),
        ],
        args: { from_warehouse_id: from.id, to_warehouse_id: to.id, note: textOf(args.note, 255) || undefined, lines: lines.map((l) => ({ product_id: l.product_id, qty: l.n })) },
        record: { type: 'warehouse', id: to.id, label: to.name },
      };
    },
    async run(args, ctx) {
      const from = await warehouseOf(ctx, args.from_warehouse_id, 'is the stock in now', true);
      const to = await warehouseOf(ctx, args.to_warehouse_id, 'should it go to');
      const lines = stockLines(args.lines, 'qty');
      await ctx.s.stock.move(ctx.user.company_id, ctx.user.user_id, {
        from_warehouse_id: from.id,
        to_warehouse_id: to.id,
        note: textOf(args.note, 255),
        lines: lines.map((l) => ({ product_id: l.product_id, qty: l.n })),
      });
      const units = lines.reduce((s, l) => s + l.n, 0);
      return { ok: true, message: `Moved ${units} unit${units === 1 ? '' : 's'} from ${from.name} to ${to.name}`, data: { ok: true }, record: { type: 'warehouse', id: to.id, label: to.name } };
    },
  },
  {
    name: 'count_stock',
    group: 'Products & stock',
    label: 'Count stock (set to what is on the shelf)',
    description:
      'Set stock in one warehouse to what was counted; the difference is recorded with a reason (COUNTED, DAMAGED, LOST, FOUND, RETURNED, OTHER). Needs the person to press Confirm.',
    parameters: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'number' },
        lines: {
          type: 'array',
          items: { type: 'object', properties: { product_id: { type: 'number' }, counted: { type: 'number' } }, required: ['product_id', 'counted'] },
        },
        reason: { type: 'string', enum: [...COUNT_REASONS] },
        note: { type: 'string' },
      },
      required: ['warehouse_id', 'lines'],
    },
    permissions: ['stock.manage'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const w = await warehouseOf(ctx, args.warehouse_id, 'did you count', true);
      const lines = stockLines(args.lines, 'counted');
      const names = await namesFor(ctx, lines.map((l) => l.product_id));
      const have = await ctx.s.lookup.stockIn(w.id, lines.map((l) => l.product_id));
      const changed = lines.filter((l) => (have.get(l.product_id) || 0) !== l.n);
      if (!changed.length) throw new ToolRefusal(`Nothing to change — ${w.name} already shows those numbers`);
      const reason = (COUNT_REASONS as readonly string[]).includes(String(args.reason)) ? String(args.reason) : 'COUNTED';
      return {
        summary: `Set stock of ${changed.length} product${changed.length === 1 ? '' : 's'} in ${w.name} to what was counted`,
        details: [
          ...changed.slice(0, 8).map((l) => {
            const p = names.get(l.product_id)!;
            const was = have.get(l.product_id) || 0;
            const diff = l.n - was;
            return `${p.name}: ${was} → ${unitsText(l.n, p.unit)} (${diff > 0 ? '+' : ''}${diff})`;
          }),
          ...(changed.length > 8 ? [`…and ${changed.length - 8} more`] : []),
          `Reason: ${reason.toLowerCase()}`,
        ],
        args: { warehouse_id: w.id, reason, note: textOf(args.note, 255) || undefined, lines: changed.map((l) => ({ product_id: l.product_id, counted: l.n })) },
        record: { type: 'warehouse', id: w.id, label: w.name },
      };
    },
    async run(args, ctx) {
      const w = await warehouseOf(ctx, args.warehouse_id, 'did you count', true);
      const lines = stockLines(args.lines, 'counted');
      await ctx.s.stock.count(ctx.user.company_id, ctx.user.user_id, {
        warehouse_id: w.id,
        reason: (COUNT_REASONS as readonly string[]).includes(String(args.reason)) ? String(args.reason) : 'COUNTED',
        note: textOf(args.note, 255),
        lines: lines.map((l) => ({ product_id: l.product_id, counted: l.n })),
      });
      return { ok: true, message: `Stock in ${w.name} set to the count`, data: { ok: true }, record: { type: 'warehouse', id: w.id, label: w.name } };
    },
  },
];
