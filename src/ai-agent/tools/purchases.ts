import { isIsoDate } from '../../dashboard/dashboard.rules';
import { PURCHASES_MODULE } from '../../purchases/purchase.rules';
import { PurchaseError } from '../../purchases/purchase-db';
import { idOf, intIn, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal } from './types';

// Purchases (the add-on): purchase orders, goods received and supplier bills.
// The same services and checks as the Purchases pages; a store keeper who can
// only receive goods never sees prices.

const PO_STATUS: Record<string, string> = {
  all: 'ALL',
  draft: 'DRAFT',
  waiting_approval: 'PENDING_APPROVAL',
  to_send: 'TO_SEND',
  to_receive: 'TO_RECEIVE',
  late: 'LATE',
  received: 'RECEIVED',
  closed: 'CLOSED',
  cancelled: 'CANCELLED',
};
const BILL_STATUS: Record<string, string> = { to_pay: 'UNPAID', overdue: 'OVERDUE', due_soon: 'DUE_SOON', msme: 'MSME', paid: 'PAID', all: 'ALL' };
const WORD: Record<string, string> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'waiting for approval',
  APPROVED: 'approved, not sent yet',
  SENT: 'sent to the supplier',
  PARTLY_RECEIVED: 'part received',
  RECEIVED: 'everything received',
  CLOSED: 'closed early',
  CANCELLED: 'cancelled',
};

/** The person, as the Purchases services take it. */
const pu = (ctx: ToolContext) => ({ company_id: ctx.user.company_id, user_id: ctx.user.user_id, permissions: ctx.user.permissions });

/** A Purchases refusal ("only 40 left to receive…") goes back to the AI and the person as is. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PurchaseError) throw new ToolRefusal(e.message);
    throw e;
  }
}

/** A PO by id, or by its number ("PO/26-27/0007", or the last digits). */
async function poIdOf(ctx: ToolContext, args: Record<string, any>): Promise<number> {
  const id = idOf(args.id);
  if (id) return id;
  const num = textOf(args.po_number, 40);
  if (!num) throw new ToolRefusal('Which purchase order? Give its number');
  const r = await guard(() => ctx.s.purchaseOrders.list(pu(ctx), { q: num, status: 'ALL', limit: 6 }));
  const exact = r.rows.find((x) => x.po_number.toLowerCase() === num.toLowerCase()) || (r.rows.length === 1 ? r.rows[0] : null);
  if (!exact) {
    throw new ToolRefusal(r.rows.length ? `Several POs match "${num}": ${r.rows.map((x) => x.po_number).join(', ')} — which one?` : `No purchase order matches "${num}"`);
  }
  return exact.id;
}

const qty = (v: unknown, unit?: string | null) => `${Number(v)}${unit ? ` ${unit}` : ''}`;

export const purchaseTools: AiTool[] = [
  {
    name: 'find_purchase_orders',
    group: 'Purchases',
    label: 'Find purchase orders',
    description:
      'Purchase orders to suppliers, newest first, with how much has arrived. status: to_receive (goods still to come), late (past the expected date), waiting_approval, to_send, draft, received, closed, cancelled, all. Also gives the open totals.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'PO number, supplier name or supplier ref' },
        status: { type: 'string', enum: Object.keys(PO_STATUS) },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['purchases.view'],
    kind: 'read',
    module: PURCHASES_MODULE,
    async run(args, ctx) {
      const [list, summary] = await Promise.all([
        guard(() => ctx.s.purchaseOrders.list(pu(ctx), { q: textOf(args.search, 80), status: PO_STATUS[args.status] || 'ALL', limit: intIn(args.limit, 1, 25, 10) })),
        guard(() => ctx.s.purchaseOrders.summary(pu(ctx))),
      ]);
      return {
        ok: true,
        data: {
          open_value: summary.open_value,
          waiting_approval: summary.pending,
          to_send: summary.to_send,
          to_receive: summary.to_receive,
          late: summary.late,
          total: list.total,
          purchase_orders: list.rows.map((r) => ({
            id: r.id,
            po_number: r.po_number,
            supplier: r.supplier_name,
            date: r.po_date,
            expected: r.expected_date,
            status: WORD[r.status] || r.status,
            late: r.late || undefined,
            arrived_pct: r.received_pct,
            total: r.grand_total,
            link: recordLink('purchase_order', r.id),
          })),
        },
      };
    },
  },
  {
    name: 'purchase_order_details',
    group: 'Purchases',
    label: 'Purchase order details',
    description: "One PO: supplier, status, each item ordered / arrived / still to come, rates and GST, totals, goods received notes and supplier bills.",
    parameters: { type: 'object', properties: { id: { type: 'number' }, po_number: { type: 'string' } } },
    permissions: ['purchases.view'],
    kind: 'read',
    module: PURCHASES_MODULE,
    async run(args, ctx) {
      const id = await poIdOf(ctx, args);
      const po = await guard(() => ctx.s.purchaseOrders.get(pu(ctx), id));
      return {
        ok: true,
        record: { type: 'purchase_order', id: po.id, label: po.po_number },
        data: {
          po_number: po.po_number,
          supplier: po.supplier?.name,
          supplier_gstin: po.supplier?.gstin || 'unregistered',
          status: WORD[po.status] || po.status,
          amendment: po.revision || undefined,
          date: po.po_date,
          expected: po.expected_date,
          deliver_to: po.ship_to?.name,
          gst: po.tax_type === 'INTRA_STATE' ? 'CGST + SGST' : po.tax_type === 'INTER_STATE' ? 'IGST' : 'none',
          for_quotation: po.quotation?.number,
          items: po.lines.map((l) => ({ item: l.item_name, ordered: qty(l.qty, l.unit), arrived: l.received, to_come: l.pending, billed: l.billed, rate: l.rate, gst_rate: l.gst_rate, amount: l.amount })),
          taxable: po.taxable_amount,
          tax: po.money_hidden ? null : Math.round(((po.cgst_amount || 0) + (po.sgst_amount || 0) + (po.igst_amount || 0)) * 100) / 100,
          total: po.grand_total,
          payment_terms: po.payment_terms,
          goods_received: po.receipts
            .filter((r) => r.status === 'RECEIVED')
            .map((r) => ({ grn: r.grn_number, date: r.receipt_date, warehouse: r.warehouse_name, items: r.lines.map((x) => `${qty(x.accepted_qty, x.unit)} ${x.item_name}${x.rejected_qty ? ` (${x.rejected_qty} rejected)` : ''}`).join(', ') })),
          bills: po.bills.map((b) => ({ bill_number: b.bill_number, total: b.grand_total, still_due: b.balance_amount, status: b.status.toLowerCase().replace('_', ' ') })),
          link: recordLink('purchase_order', po.id),
        },
      };
    },
  },
  {
    name: 'find_supplier_bills',
    group: 'Purchases',
    label: 'Supplier bills to pay',
    description:
      'What you owe suppliers: their bills with the amount due and the pay-by date (micro / small MSME suppliers within 45 days). status: to_pay, overdue, due_soon (next 7 days), msme, paid, all. Also gives totals.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Bill number, supplier name or PO number' },
        status: { type: 'string', enum: Object.keys(BILL_STATUS) },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['purchases.view'],
    kind: 'read',
    module: PURCHASES_MODULE,
    async run(args, ctx) {
      const [list, summary] = await Promise.all([
        guard(() => ctx.s.bills.list(pu(ctx), { q: textOf(args.search, 80), status: BILL_STATUS[args.status] || 'UNPAID', limit: intIn(args.limit, 1, 25, 10) })),
        guard(() => ctx.s.bills.summary(pu(ctx))),
      ]);
      return {
        ok: true,
        data: {
          to_pay: summary.to_pay,
          overdue: summary.overdue,
          due_in_7_days: summary.due_soon,
          owed_to_msme: summary.msme,
          gst_credit_at_risk: summary.itc_risk || undefined,
          bills: list.rows.map((b) => ({
            bill_number: b.bill_number,
            supplier: b.supplier_name,
            po: b.po_number || undefined,
            bill_date: b.bill_date,
            pay_by: b.pay_by,
            due: b.balance_amount,
            total: b.grand_total,
            status: b.status.toLowerCase().replace('_', ' '),
            overdue_days: b.alerts?.overdue_days || undefined,
            msme: b.msme || undefined,
            link: recordLink('supplier_bill', b.id),
          })),
        },
      };
    },
  },
  {
    name: 'draft_purchase_order',
    group: 'Purchases',
    label: 'Draft purchase orders',
    description:
      'Make a DRAFT purchase order to a supplier (never sent or approved — the person checks and submits it). items: product names from the product list with qty; rate is optional (the last purchase price is used). GST works itself out.',
    parameters: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: "Supplier's name" },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              qty: { type: 'number' },
              rate: { type: 'number', description: 'Price per unit before GST (optional)' },
              gst_rate: { type: 'number' },
            },
            required: ['product', 'qty'],
          },
        },
        expected_date: { type: 'string', description: 'Expected delivery (YYYY-MM-DD)' },
        note: { type: 'string' },
      },
      required: ['supplier', 'items'],
    },
    permissions: ['purchases.create'],
    kind: 'write',
    module: PURCHASES_MODULE,
    async run(args, ctx) {
      const name = textOf(args.supplier, 200);
      if (!name) throw new ToolRefusal('Which supplier?');
      const found = await guard(() => ctx.s.suppliers.options(pu(ctx), { q: name }));
      const supplier = found.find((s) => s.name.toLowerCase() === name.toLowerCase()) || (found.length === 1 ? found[0] : null);
      if (!supplier) {
        throw new ToolRefusal(found.length ? `Several suppliers match "${name}": ${found.slice(0, 5).map((s) => s.name).join(', ')} — which one?` : `No supplier called "${name}" — add it on the Suppliers page first`);
      }
      const raw: any[] = Array.isArray(args.items) ? args.items.slice(0, 50) : [];
      if (!raw.length) throw new ToolRefusal('What should be ordered? Give the products and quantities');
      const matches = await ctx.s.purchaseOrders.matchProducts(pu(ctx), raw.map((i) => String(i?.product ?? '')));
      const picked: any[] = [];
      for (const i of raw) {
        const label = String(i?.product ?? '').trim();
        const m = matches.get(label);
        const p = m?.exact || (m?.options.length === 1 ? m.options[0] : null);
        if (!p && m?.options.length) throw new ToolRefusal(`"${label}" matches several products: ${m.options.map((o: any) => o.name).join(', ')} — which one?`);
        picked.push({ i, p, label });
      }
      const last = await ctx.s.purchaseOrders.lastBought(pu(ctx), picked.filter((x) => x.p).map((x) => Number(x.p.id)));
      const lastOf = new Map(last.map((l) => [l.product_id, l]));
      const items = picked.map(({ i, p, label }) => {
        const l = p ? lastOf.get(Number(p.id)) : undefined;
        const rate = i?.rate !== undefined && i?.rate !== null ? Number(i.rate) : l ? l.rate : p && Number(p.cost_price) > 0 ? Number(p.cost_price) : null;
        if (rate === null) throw new ToolRefusal(`What rate for ${p ? p.name : label}? There's no earlier purchase price`);
        return {
          product_id: p ? Number(p.id) : null,
          item_name: p ? p.name : label,
          qty: Number(i?.qty),
          rate,
          discount_percent: l?.discount_percent ?? 0,
          ...(i?.gst_rate !== undefined && i?.gst_rate !== null ? { gst_rate: Number(i.gst_rate) } : l ? { gst_rate: l.gst_rate } : {}),
        };
      });
      const po = await guard(() =>
        ctx.s.purchaseOrders.create(pu(ctx), {
          supplier_id: supplier.id,
          expected_date: isIsoDate(args.expected_date) ? args.expected_date : null,
          notes: textOf(args.note, 500),
          items,
          submit: false,
        }),
      );
      return {
        ok: true,
        message: `Draft ${po.po_number} saved for ${supplier.name}`,
        record: { type: 'purchase_order', id: po.id, label: po.po_number },
        data: {
          po_number: po.po_number,
          status: 'draft — open it to check, then submit or approve',
          supplier: supplier.name,
          gst: po.tax_type === 'INTRA_STATE' ? 'CGST + SGST' : po.tax_type === 'INTER_STATE' ? 'IGST' : 'none',
          items: po.lines.map((l) => ({ item: l.item_name, qty: qty(l.qty, l.unit), rate: l.rate, gst_rate: l.gst_rate })),
          total: po.grand_total,
          link: recordLink('purchase_order', po.id),
        },
      };
    },
  },
  {
    name: 'receive_goods',
    group: 'Purchases',
    label: 'Receive goods on a PO',
    description:
      'Goods arrived against a purchase order: record them (a goods received note) so they go into stock. Give the PO number and the items with quantities, or all_pending=true for everything still to come. Rejected goods stay out of stock. Needs the person to press Confirm.',
    parameters: {
      type: 'object',
      properties: {
        po_number: { type: 'string' },
        id: { type: 'number' },
        all_pending: { type: 'boolean' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { item: { type: 'string' }, qty: { type: 'number' }, rejected: { type: 'number' }, reason: { type: 'string' } },
            required: ['item', 'qty'],
          },
        },
        supplier_bill_no: { type: 'string' },
        vehicle_number: { type: 'string' },
      },
    },
    permissions: ['purchases.receive'],
    kind: 'confirm',
    module: PURCHASES_MODULE,
    async prepare(args, ctx) {
      const id = await poIdOf(ctx, args);
      const po = await guard(() => ctx.s.purchaseOrders.get(pu(ctx), id));
      if (!po.can.receive) throw new ToolRefusal(`${po.po_number} is ${WORD[po.status] || po.status} — goods can't be received on it`);
      const lines: { po_item_id: number; received_qty: number; rejected_qty: number; reject_reason: string | null; text: string }[] = [];
      if (args.all_pending === true) {
        for (const l of po.lines) if (l.pending > 0) lines.push({ po_item_id: l.id, received_qty: l.pending, rejected_qty: 0, reject_reason: null, text: `${qty(l.pending, l.unit)} ${l.item_name}` });
      } else {
        for (const it of Array.isArray(args.items) ? args.items.slice(0, 50) : []) {
          const want = String(it?.item ?? '').trim().toLowerCase();
          const l = po.lines.find((x) => x.item_name.toLowerCase() === want) || po.lines.find((x) => x.item_name.toLowerCase().includes(want));
          if (!l) throw new ToolRefusal(`"${it?.item}" isn't on ${po.po_number} — it has ${po.lines.map((x) => x.item_name).join(', ')}`);
          const got = Number(it?.qty);
          const rejected = Number(it?.rejected || 0);
          if (!(got > 0)) throw new ToolRefusal(`How many ${l.item_name} arrived?`);
          if (got - rejected > l.pending + 1e-9) throw new ToolRefusal(`${l.item_name}: only ${qty(l.pending, l.unit)} is still to come`);
          lines.push({
            po_item_id: l.id,
            received_qty: got,
            rejected_qty: rejected,
            reject_reason: rejected ? textOf(it?.reason, 200) || 'Rejected on arrival' : null,
            text: `${qty(got - rejected, l.unit)} ${l.item_name}${rejected ? ` (+${rejected} rejected)` : ''}`,
          });
        }
      }
      if (!lines.length) throw new ToolRefusal('Nothing to receive — say which items and how many arrived');
      return {
        summary: `Receive goods on ${po.po_number} from ${po.supplier?.name}`,
        details: [...lines.map((l) => l.text), `Into ${po.ship_to?.name || 'the default warehouse'}`, ...(args.supplier_bill_no ? [`Supplier bill ${args.supplier_bill_no}`] : [])],
        args: {
          id,
          lines: lines.map(({ text, ...l }) => l),
          supplier_invoice_no: textOf(args.supplier_bill_no, 50),
          vehicle_number: textOf(args.vehicle_number, 32),
        },
        record: { type: 'purchase_order', id, label: po.po_number },
      };
    },
    async run(args, ctx) {
      const r = await guard(() =>
        ctx.s.purchaseOrders.receive(pu(ctx), Number(args.id), {
          lines: args.lines,
          supplier_invoice_no: args.supplier_invoice_no,
          vehicle_number: args.vehicle_number,
        }),
      );
      return {
        ok: true,
        message: r.message,
        record: { type: 'purchase_order', id: r.id, label: r.po_number },
        data: { grn: r.grn?.grn_number, po_status: WORD[r.status] || r.status, link: recordLink('purchase_order', r.id) },
      };
    },
  },
];
