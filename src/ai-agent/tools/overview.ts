import { isIsoDate } from '../../dashboard/dashboard.rules';
import { PERIODS, periodRange } from '../ai-agent.rules';
import { type AiTool, ToolRefusal } from './types';

/** Keeps the parts of the Dashboard an answer needs (no daily series or heatmap). */
const compact = (d: any) => ({
  period: d.range ? { from: d.range.from, to: d.range.to, compared_with: `${d.range.prev_from} to ${d.range.prev_to}` } : undefined,
  money_visible: !!d.access?.insights,
  totals_vs_previous_period: d.totals,
  right_now: d.snapshot,
  invoices: d.invoice_summary,
  receivables: d.receivables,
  payment_modes: d.payment_modes,
  quotation_funnel: d.funnel,
  challans: d.challans,
  low_stock: d.low_stock,
  top_customers: d.top_customers,
  top_products: d.top_products,
  tasks: d.tasks,
  attendance: d.attendance,
});

export const overviewTools: AiTool[] = [
  {
    name: 'business_overview',
    group: 'Overview',
    label: 'Business overview: sales, dues, pipeline, stock alerts',
    description:
      'Key figures for a period compared with the period before: sales, collections and dues (only when money is visible), quotations, challans waiting for an invoice, low stock, top customers and products. Use for "how is business", "sales this month", "compare with last month".',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: [...PERIODS], description: 'Named period (default this_month). India financial year starts in April.' },
        from: { type: 'string', description: 'Start date YYYY-MM-DD, instead of a named period' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default today)' },
      },
    },
    permissions: ['dashboard.view'],
    kind: 'read',
    async run(args, ctx) {
      const named = periodRange(args.period || 'this_month', ctx.today) || periodRange('this_month', ctx.today)!;
      const custom = isIsoDate(args.from);
      const from = custom ? args.from : named.from;
      const to = isIsoDate(args.to) ? args.to : custom ? ctx.today : named.to;
      const r: any = await ctx.s.dashboard.overview(
        { userId: ctx.user.user_id, companyId: ctx.user.company_id, permissions: ctx.user.permissions },
        { from, to, today: ctx.today, tz: String(ctx.tz) },
      );
      if (!r?.success) throw new ToolRefusal(r?.message || "Couldn't read the figures for that period");
      return { ok: true, data: compact(r.data) };
    },
  },
];
