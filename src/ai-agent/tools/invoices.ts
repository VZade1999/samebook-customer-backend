import { isIsoDate } from '../../dashboard/dashboard.rules';
import { PAYMENT_MODES } from '../../invoice/dto/addPayment.dto';
import { idOf, inr, intIn, recordLink, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal } from './types';

const STATES = ['unpaid', 'partial', 'paid', 'cancelled', 'open', 'overdue', 'due_soon'];

const invoiceId = (v: unknown) => {
  const id = idOf(v);
  if (!id) throw new ToolRefusal('Which invoice? Find it first to get its id');
  return id;
};

async function brief(ctx: ToolContext, id: number) {
  const i = await ctx.s.lookup.invoiceBrief(ctx.user.company_id, id);
  if (!i) throw new ToolRefusal('That invoice was not found');
  return i;
}

/** A payment as the invoice page accepts it. */
function payment(args: Record<string, any>, today: string) {
  const amount = Math.round(Number(args.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new ToolRefusal('The amount must be more than ₹0');
  const mode = String(args.mode || '').toUpperCase();
  if (!(PAYMENT_MODES as readonly string[]).includes(mode)) {
    throw new ToolRefusal(`How was it paid? ${PAYMENT_MODES.map((m) => m.toLowerCase().replace('_', ' ')).join(', ')}`);
  }
  const date = isIsoDate(args.date) ? args.date : today;
  if (date > today) throw new ToolRefusal("The payment date can't be in the future");
  return { amount, mode, date, reference: textOf(args.reference, 100), note: textOf(args.note, 255) };
}

export const invoiceTools: AiTool[] = [
  {
    name: 'find_invoices',
    group: 'Invoices',
    label: 'Find invoices and dues',
    description:
      'Search invoices by number, customer or quotation number. status: unpaid, partial, paid, cancelled, open (unpaid+partial), overdue (past due date), due_soon (due in 7 days). Overdue lists the oldest first.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string', enum: STATES },
        customer_id: { type: 'number' },
        from: { type: 'string', description: 'Invoice date from (YYYY-MM-DD)' },
        to: { type: 'string', description: 'Invoice date to (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['invoices.view'],
    kind: 'read',
    async run(args, ctx) {
      const d = await ctx.s.lookup.invoices(ctx.user.company_id, {
        search: textOf(args.search, 80),
        state: STATES.includes(args.status) ? args.status : null,
        customer_id: idOf(args.customer_id),
        from: isIsoDate(args.from) ? args.from : null,
        to: isIsoDate(args.to) ? args.to : null,
        limit: intIn(args.limit, 1, 25, 10),
        today: ctx.today,
        tz: ctx.tz,
      });
      // Totals across invoices follow the Dashboard rule (Insights); each invoice's own amounts are on the invoice page.
      const { billed, balance_due, ...rest } = d;
      return {
        ok: true,
        data: {
          ...rest,
          ...(ctx.money ? { billed, balance_due } : { totals_hidden: 'Totals across invoices need the Invoice insights permission' }),
          invoices: d.invoices.map((x) => ({ ...x, link: recordLink('invoice', x.id) })),
        },
      };
    },
  },
  {
    name: 'invoice_details',
    group: 'Invoices',
    label: 'Invoice details and payments',
    description: "One invoice's customer, items, totals, payments received and balance.",
    parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    permissions: ['invoices.view'],
    kind: 'read',
    async run(args, ctx) {
      const id = invoiceId(args.id);
      const i = await ctx.s.lookup.invoice(ctx.user.company_id, id);
      if (!i) throw new ToolRefusal('That invoice was not found');
      return { ok: true, record: { type: 'invoice', id, label: i.number }, data: { ...i, link: recordLink('invoice', id) } };
    },
  },
  {
    name: 'record_payment',
    group: 'Invoices',
    label: 'Record payments',
    description: `Record a payment received against an invoice (not more than its balance). mode: ${PAYMENT_MODES.join(', ')}. Needs the person to press Confirm.`,
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'number' },
        amount: { type: 'number' },
        mode: { type: 'string', enum: [...PAYMENT_MODES] },
        date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        reference: { type: 'string', description: 'UTR / cheque no.' },
        note: { type: 'string' },
      },
      required: ['invoice_id', 'amount', 'mode'],
    },
    permissions: ['invoices.edit'],
    kind: 'confirm',
    async prepare(args, ctx) {
      const inv = await brief(ctx, invoiceId(args.invoice_id));
      if (inv.state === 'cancelled') throw new ToolRefusal(`${inv.number} is cancelled`);
      if (inv.state === 'paid') throw new ToolRefusal(`${inv.number} is already paid in full`);
      const p = payment(args, ctx.today);
      if (p.amount > inv.balance + 0.005) throw new ToolRefusal(`${inv.number} has only ${inr(inv.balance)} left to pay`);
      const left = Math.round((inv.balance - p.amount) * 100) / 100;
      return {
        summary: `Record ${inr(p.amount)} by ${p.mode.toLowerCase().replace('_', ' ')} against invoice ${inv.number} (${inv.customer})`,
        details: [
          `Paid on ${p.date}${p.reference ? ` · ref ${p.reference}` : ''}`,
          left > 0 ? `Balance goes from ${inr(inv.balance)} to ${inr(left)}` : `That pays it in full (${inr(inv.total)})`,
        ],
        args: { invoice_id: inv.id, amount: p.amount, mode: p.mode, date: p.date, ...(p.reference ? { reference: p.reference } : {}), ...(p.note ? { note: p.note } : {}) },
        record: { type: 'invoice', id: inv.id, label: inv.number },
      };
    },
    async run(args, ctx) {
      const inv = await brief(ctx, invoiceId(args.invoice_id));
      const p = payment(args, ctx.today);
      const r: any = await ctx.s.invoices.addPayment(
        inv.id,
        { amount: p.amount, payment_mode: p.mode, payment_date: p.date, transaction_reference: p.reference || undefined, notes: p.note || undefined },
        ctx.user.company_id,
        ctx.user.user_id,
      );
      return {
        ok: !!r?.success,
        message: r?.message || 'Payment recorded',
        data: { ok: !!r?.success, balance: r?.data?.balance_amount, status: r?.data?.status },
        record: { type: 'invoice', id: inv.id, label: inv.number },
      };
    },
  },
];
