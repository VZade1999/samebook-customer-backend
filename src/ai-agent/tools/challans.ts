import { isIsoDate } from '../../dashboard/dashboard.rules';
import { idOf, intIn, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal, fromResult } from './types';

const STATES = ['draft', 'dispatched', 'delivered', 'invoiced', 'cancelled', 'to_invoice'];

const challanId = (args: Record<string, any>) => {
  const id = idOf(args.id);
  if (!id) throw new ToolRefusal('Which challan? Find it first to get its id');
  return id;
};

async function brief(ctx: ToolContext, id: number) {
  const c = await ctx.s.lookup.challanBrief(ctx.user.company_id, id);
  if (!c) throw new ToolRefusal('That delivery challan was not found');
  return c;
}

const requester = (ctx: ToolContext) => ({ companyId: ctx.user.company_id, userId: ctx.user.user_id });

export const challanTools: AiTool[] = [
  {
    name: 'find_challans',
    group: 'Delivery challans',
    label: 'Find delivery challans',
    description:
      'Search delivery challans by number, customer, vehicle or quotation number. status: draft, dispatched, delivered, invoiced, cancelled, to_invoice (dispatched or delivered but not invoiced yet).',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string', enum: STATES },
        customer_id: { type: 'number' },
        from: { type: 'string', description: 'Challan date from (YYYY-MM-DD)' },
        to: { type: 'string', description: 'Challan date to (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['challans.view'],
    kind: 'read',
    async run(args, ctx) {
      const d = await ctx.s.lookup.challans(ctx.user.company_id, {
        search: textOf(args.search, 80),
        state: STATES.includes(args.status) ? args.status : null,
        customer_id: idOf(args.customer_id),
        from: isIsoDate(args.from) ? args.from : null,
        to: isIsoDate(args.to) ? args.to : null,
        limit: intIn(args.limit, 1, 25, 10),
        today: ctx.today,
        tz: ctx.tz,
      });
      return { ok: true, data: { ...d, challans: d.challans.map((x) => ({ ...x, link: recordLink('challan', x.id) })) } };
    },
  },
  {
    name: 'challan_details',
    group: 'Delivery challans',
    label: 'Challan details',
    description: "One challan's customer, items, warehouse, transport, quotation and invoice.",
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['challans.view'],
    kind: 'read',
    async run(args, ctx) {
      const id = challanId(args);
      const c = await ctx.s.lookup.challan(ctx.user.company_id, id);
      if (!c) throw new ToolRefusal('That delivery challan was not found');
      return { ok: true, record: { type: 'challan', id, label: c.number }, data: { ...c, link: recordLink('challan', id) } };
    },
  },
  {
    name: 'dispatch_challan',
    group: 'Delivery challans',
    label: 'Dispatch challans',
    description: 'Dispatch a draft challan (goods leave; stock goes down when the challan moves stock). Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['challans.dispatch'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const c = await brief(ctx, challanId(args));
      if (c.status !== 'DRAFT') throw new ToolRefusal(`${c.number} is ${c.status.toLowerCase()} — only draft challans can be dispatched`);
      return {
        summary: `Dispatch challan ${c.number} to ${c.customer}`,
        details: [
          `${c.qty} unit${c.qty === 1 ? '' : 's'} on it.`,
          c.moves_stock ? `Stock goes down${c.from_warehouse ? ` in ${c.from_warehouse}` : ''}.` : "It doesn't change stock.",
        ],
        args: { id: c.id },
        record: { type: 'challan', id: c.id, label: c.number },
      };
    },
    async run(args, ctx) {
      const c = await brief(ctx, challanId(args));
      const r = fromResult(await ctx.s.challans.dispatchChallan(c.id, requester(ctx)), 'Could not dispatch the challan');
      return { ok: r.ok, message: r.ok ? `Challan ${c.number} dispatched` : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'challan', id: c.id, label: c.number } };
    },
  },
  {
    name: 'deliver_challan',
    group: 'Delivery challans',
    label: 'Mark challans delivered',
    description: 'Mark a dispatched challan as delivered. Needs the person to press Confirm.',
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['challans.dispatch'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const c = await brief(ctx, challanId(args));
      if (c.status !== 'DISPATCHED') throw new ToolRefusal(`${c.number} is ${c.status.toLowerCase()} — only dispatched challans can be marked delivered`);
      return {
        summary: `Mark challan ${c.number} as delivered to ${c.customer}`,
        details: [`${c.qty} unit${c.qty === 1 ? '' : 's'} on it.`],
        args: { id: c.id },
        record: { type: 'challan', id: c.id, label: c.number },
      };
    },
    async run(args, ctx) {
      const c = await brief(ctx, challanId(args));
      const r = fromResult(await ctx.s.challans.deliverChallan(c.id, requester(ctx)), 'Could not mark the challan delivered');
      return { ok: r.ok, message: r.ok ? `Challan ${c.number} marked delivered` : r.message, data: { ok: r.ok, message: r.message }, record: { type: 'challan', id: c.id, label: c.number } };
    },
  },
];
