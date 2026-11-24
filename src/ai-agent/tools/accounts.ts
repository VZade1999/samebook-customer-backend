import { isIsoDate } from '../../dashboard/dashboard.rules';
import { ACCOUNTS_MODULE, GST_RATES, PAYMENT_MODES } from '../../accounts/ledger.rules';
import { LedgerError } from '../../accounts/ledger-db';
import { intIn, textOf } from '../ai-agent.rules';
import { type AiTool, type ToolContext, ToolRefusal } from './types';

// Accounts (the add-on): the books kept from invoices, bills, receipts and
// expenses — balances, a party's statement, profit & loss, and recording an
// expense. The same services and checks as the Accounts pages.

const PERIOD: Record<string, string> = { this_fy: 'fy', last_fy: 'last_fy', this_month: 'month', last_month: 'last_month', all: 'all' };
const PAID_BY: Record<string, string> = { cash: 'CASH', upi: 'UPI', bank_transfer: 'BANK_TRANSFER', cheque: 'CHEQUE', card: 'CARD' };
const CASH_LIMIT = 10000;

/** The person, as the Accounts services take it. */
const lu = (ctx: ToolContext) => ({ company_id: ctx.user.company_id, user_id: ctx.user.user_id, permissions: ctx.user.permissions });

/** An Accounts refusal ("Choose a GST rate…") goes back to the AI and the person as is. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LedgerError) throw new ToolRefusal(e.message);
    throw e;
  }
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ledgerLink = (type: 'customer' | 'supplier', id: number) => `/app/ledger?party=${type}:${id}`;

/** A customer or supplier by name, from the ledger list. */
async function partyOf(ctx: ToolContext, type: 'customer' | 'supplier', raw: unknown) {
  const name = textOf(raw, 200);
  if (!name) throw new ToolRefusal(`Which ${type}?`);
  const r = await guard(() => ctx.s.ledger.parties(lu(ctx), { type, q: name, limit: 6 }));
  const exact = r.rows.find((x) => x.name.toLowerCase() === name.toLowerCase()) || (r.rows.length === 1 ? r.rows[0] : null);
  if (!exact) {
    throw new ToolRefusal(r.rows.length ? `Several ${type}s match "${name}": ${r.rows.map((x) => x.name).join(', ')} — which one?` : `No ${type} called "${name}"`);
  }
  return exact;
}

export const accountTools: AiTool[] = [
  {
    name: 'business_books',
    group: 'Accounts',
    label: 'Cash, bank and balances',
    description:
      'From the books: money in cash and each bank, what customers owe you, what you owe suppliers, advances, and cash-limit warnings (269ST / 40A(3)).',
    parameters: { type: 'object', properties: {} },
    permissions: ['accounts.view'],
    kind: 'read',
    module: ACCOUNTS_MODULE,
    async run(_args, ctx) {
      const s = await guard(() => ctx.s.ledger.summary(lu(ctx)));
      return {
        ok: true,
        data: {
          financial_year: s.fy,
          books_start: s.books_start,
          cash_and_bank: s.cash + s.bank,
          accounts: s.money.map((m: any) => ({ name: m.name, balance: m.balance })),
          you_will_get: s.you_get,
          customers_owing: s.customers_owing,
          advances_from_customers: s.advances_received || undefined,
          you_owe: s.you_owe,
          suppliers_owed: s.suppliers_owed,
          advances_to_suppliers: s.advances_paid || undefined,
          cash_limit_warnings: s.warnings || undefined,
          opening_balances_differ_by: s.opening_difference?.amount ? s.opening_difference.amount : undefined,
          link: '/app/cash-bank',
        },
      };
    },
  },
  {
    name: 'find_ledger_balances',
    group: 'Accounts',
    label: 'Who owes you, whom you owe',
    description:
      "Balances from the books, biggest first: who: customers (they owe you) or suppliers (you owe them). filter: due (default), advance (paid ahead), all. Use party_ledger_details for one party's entries.",
    parameters: {
      type: 'object',
      properties: {
        who: { type: 'string', enum: ['customers', 'suppliers'] },
        filter: { type: 'string', enum: ['due', 'advance', 'all'] },
        search: { type: 'string', description: 'Name, GSTIN or phone' },
        limit: { type: 'number', description: 'Rows (default 10, max 25)' },
      },
    },
    permissions: ['accounts.view'],
    kind: 'read',
    module: ACCOUNTS_MODULE,
    async run(args, ctx) {
      const type = args.who === 'suppliers' ? 'supplier' : 'customer';
      const r = await guard(() =>
        ctx.s.ledger.parties(lu(ctx), { type, filter: ['due', 'advance', 'all'].includes(args.filter) ? args.filter : 'due', q: textOf(args.search, 80), limit: intIn(args.limit, 1, 25, 10) }),
      );
      return {
        ok: true,
        data: {
          total: r.total,
          [type === 'customer' ? 'customers' : 'suppliers']: r.rows.map((p) => ({
            name: p.name,
            balance: p.balance.amount,
            meaning: p.balance.words,
            last_entry: p.last_date,
            link: ledgerLink(type, p.id),
          })),
        },
      };
    },
  },
  {
    name: 'party_ledger_details',
    group: 'Accounts',
    label: 'A customer’s or supplier’s ledger',
    description:
      'One customer or supplier statement of account from the books: opening, entries (invoices, payments, notes) with running balance, closing. The person sends it as PDF or on WhatsApp from the link.',
    parameters: {
      type: 'object',
      properties: {
        who: { type: 'string', enum: ['customer', 'supplier'] },
        name: { type: 'string' },
        period: { type: 'string', enum: Object.keys(PERIOD), description: 'Default this_fy' },
      },
      required: ['name'],
    },
    permissions: ['accounts.view'],
    kind: 'read',
    module: ACCOUNTS_MODULE,
    async run(args, ctx) {
      const type = args.who === 'supplier' ? 'supplier' : 'customer';
      const p = await partyOf(ctx, type, args.name);
      const st = await guard(() => ctx.s.ledger.statement(lu(ctx), type, p.id, { range: PERIOD[args.period] || 'fy' }));
      const rows = st.rows.slice(-15);
      const closing = st.closing;
      return {
        ok: true,
        record: { type: type === 'customer' ? 'customer_ledger' : 'supplier_ledger', id: p.id, label: p.name },
        data: {
          name: p.name,
          period: `${st.period.from} to ${st.period.to}`,
          opening: `${inr(st.opening.amount)} ${st.opening.side || ''}`.trim(),
          entries: st.rows.length,
          last_entries: rows.map((r) => ({ date: r.date, what: [r.type_word, r.number].filter(Boolean).join(' '), debit: r.debit || undefined, credit: r.credit || undefined, balance: `${inr(r.balance.amount)} ${r.balance.side || ''}`.trim() })),
          closing: `${inr(closing.amount)} ${closing.side || ''}`.trim(),
          meaning: closing.words,
          message_to_send:
            type === 'customer' && closing.value > 0
              ? `Dear ${p.name}, as per our books your balance as on ${st.period.to} is ${inr(closing.amount)}. Kindly arrange the payment. Statement attached. — ${st.company?.name || ''}`.trim()
              : undefined,
          link: ledgerLink(type, p.id),
          how_to_send: 'Open the link, then PDF or WhatsApp',
        },
      };
    },
  },
  {
    name: 'business_profit_and_loss',
    group: 'Accounts',
    label: 'Profit & loss',
    description:
      'Profit & loss from the books: sales, cost of goods sold, expenses by head, gross and net profit. period: this_fy (default; stock counted), last_fy, this_month, last_month. A single month counts purchases in full (no stock change).',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: Object.keys(PERIOD) } } },
    permissions: ['accounts.reports'],
    kind: 'read',
    module: ACCOUNTS_MODULE,
    async run(args, ctx) {
      const pl = await guard(() => ctx.s.reports.profitLoss(lu(ctx), { range: PERIOD[args.period] || 'fy' }));
      const rows = (list: { name: string; amount: number }[]) => list.map((r) => ({ name: r.name, amount: r.amount }));
      return {
        ok: true,
        data: {
          period: `${pl.period.from} to ${pl.period.to}`,
          sales: pl.totals.sales,
          other_income: pl.totals.direct_incomes + pl.totals.indirect_incomes || undefined,
          purchases: pl.totals.purchases,
          direct_expenses: pl.totals.direct_expenses || undefined,
          opening_stock: pl.stock_counted ? pl.opening_stock : undefined,
          closing_stock: pl.stock_counted ? pl.closing_stock : undefined,
          stock_counted: pl.stock_counted,
          // Given ready-made so the AI doesn't work it out (opening stock + purchases + direct expenses − closing stock).
          cost_of_goods_sold: Math.round((pl.totals.sales + pl.totals.direct_incomes - pl.gross_profit) * 100) / 100,
          gross_profit: pl.gross_profit,
          expenses: rows(pl.indirect_expenses),
          total_expenses: pl.totals.indirect_expenses,
          net_profit: pl.net_profit,
          products_without_cost: pl.unvalued_products || undefined,
          link: '/app/accounts-reports?r=profit-loss',
        },
      };
    },
  },
  {
    name: 'record_expense',
    group: 'Accounts',
    label: 'Record expenses',
    description:
      'Record money spent (rent, salary, electricity, fuel, repairs…) in the books. head: the expense head name. amount: before GST. GST credit only with the payee’s GSTIN. paid_by: cash, upi, bank_transfer, cheque, card. Needs the person to press Confirm.',
    parameters: {
      type: 'object',
      properties: {
        head: { type: 'string', description: 'e.g. Rent, Salaries, Electricity' },
        amount: { type: 'number' },
        paid_by: { type: 'string', enum: Object.keys(PAID_BY) },
        date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        payee: { type: 'string' },
        payee_gstin: { type: 'string' },
        gst_rate: { type: 'number', enum: GST_RATES },
        bill_number: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['head', 'amount', 'paid_by'],
    },
    permissions: ['accounts.record'],
    kind: 'confirm',
    module: ACCOUNTS_MODULE,
    async prepare(args, ctx) {
      const want = String(textOf(args.head, 100) || '').toLowerCase();
      if (!want) throw new ToolRefusal('What was it for (rent, salary, electricity…)?');
      const heads = (await guard(() => ctx.s.money.expenseHeads(lu(ctx)))).rows;
      const head =
        heads.find((h) => h.name.toLowerCase() === want) ||
        (heads.filter((h) => h.name.toLowerCase().includes(want) || want.includes(h.name.toLowerCase())).length === 1
          ? heads.find((h) => h.name.toLowerCase().includes(want) || want.includes(h.name.toLowerCase()))
          : null);
      if (!head) throw new ToolRefusal(`Which expense head? You have: ${heads.map((h) => h.name).join(', ')}`);
      const amount = Number(args.amount);
      if (!(amount > 0) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new ToolRefusal('Give the amount (above zero, at most 2 decimals)');
      const mode = PAID_BY[String(args.paid_by || '').toLowerCase()];
      if (!mode || !(PAYMENT_MODES as readonly string[]).includes(mode)) throw new ToolRefusal('How was it paid — cash, UPI, bank transfer, cheque or card?');
      const gstRate = args.gst_rate === undefined || args.gst_rate === null ? 0 : Number(args.gst_rate);
      if (!GST_RATES.includes(gstRate)) throw new ToolRefusal('GST rate: 0, 5, 12, 18 or 28%');
      const gstin = textOf(args.payee_gstin, 15)?.toUpperCase() || null;
      if (gstRate > 0 && !gstin) throw new ToolRefusal("GST credit needs the payee's GSTIN — give it, or record it with GST 0%");
      if (args.date !== undefined && args.date !== null && args.date !== '' && !isIsoDate(args.date)) throw new ToolRefusal('Give the date as YYYY-MM-DD');
      const date = isIsoDate(args.date) ? String(args.date) : ctx.today;
      const total = Math.round(amount * (100 + gstRate)) / 100;
      const payee = textOf(args.payee, 150);
      return {
        summary: `Record ${inr(total)} for ${head.name}${payee ? ` paid to ${payee}` : ''}`,
        details: [
          `${inr(amount)}${gstRate ? ` + GST ${gstRate}% (credit claimed)` : ' — no GST credit'}`,
          `Paid by ${String(args.paid_by).replace('_', ' ')} on ${date}${mode === 'CASH' ? '' : ' (from your default bank)'}`,
          ...(args.bill_number ? [`Bill ${textOf(args.bill_number, 60)}`] : []),
          ...(mode === 'CASH' && total > CASH_LIMIT ? ['Over ₹10,000 in cash to one person in a day is not tax-deductible (Section 40A(3))'] : []),
        ],
        args: {
          account_id: head.id,
          amount,
          mode,
          date,
          payee,
          payee_gstin: gstin,
          gst_rate: gstRate,
          bill_number: textOf(args.bill_number, 60),
          notes: textOf(args.note, 500),
        },
      };
    },
    async run(args, ctx) {
      const r = await guard(() => ctx.s.money.addExpense(lu(ctx), args));
      return {
        ok: true,
        message: r.message,
        record: { type: 'expense', id: r.id, label: r.number },
        data: { number: r.number, total: r.total, gst_credit: r.gst_credit || undefined, warning: r.warning || undefined, link: `/app/expenses?open=expense:${r.id}` },
      };
    },
  },
];
