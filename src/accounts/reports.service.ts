import { Injectable } from '@nestjs/common';
import { LedgerDb, LedgerUser, bad } from './ledger-db';
import { LedgerSyncService } from './ledger-sync.service';
import { AccountMove, GROUPS, GroupCode, P, R, balanceSheet, fyLabel, gstByMonth, isIsoDate, parseRange, profitAndLoss } from './ledger.rules';

const LIVE = `COALESCE(i.status, '') NOT IN ('CANCELLED', 'SUPERSEDED')`;
const r2 = (p: number | null) => (p === null ? null : R(p));
const rowsOut = (rows: { id: number; code: string | null; name: string; paise: number }[]) => rows.map((x) => ({ id: x.id, code: x.code, name: x.name, amount: R(x.paise) }));

/**
 * Accounts, step 4 — reports from the books: profit & loss, balance sheet,
 * trial balance, GST by month (the GSTR-3B view) and outstanding by age.
 * Every report first brings the books up to date.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: LedgerDb,
    private readonly books: LedgerSyncService,
  ) {}

  private async period(c: number, query: any) {
    const s = await this.books.ensure(c);
    const today = this.db.today();
    const range = parseRange(query || {}, { today, booksStart: s.books_start });
    if (!range.ok) throw bad(range.message);
    return { booksStart: s.books_start, today, from: range.from, to: range.to, preset: range.preset };
  }

  /** Each account's movement (debit − credit) in a period, opening balances left out. */
  private async moves(c: number, from: string, to: string): Promise<AccountMove[]> {
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code, COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal
         FROM ledger_accounts a JOIN ledger_lines l ON l.account_id = a.id AND l.company_id = a.company_id JOIN ledger_entries e ON e.id = l.entry_id
        WHERE a.company_id = :c AND l.entry_date BETWEEN :from AND :to AND e.entry_type <> 'OPENING'
        GROUP BY a.id`,
      { c, from, to },
    );
    return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, group: r.group_code as GroupCode, paise: P(r.bal) }));
  }

  /** Each account's balance (debit − credit) on a date, opening balances included. */
  private async balances(c: number, asOn: string): Promise<AccountMove[]> {
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code, COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal
         FROM ledger_accounts a JOIN ledger_lines l ON l.account_id = a.id AND l.company_id = a.company_id
        WHERE a.company_id = :c AND l.entry_date <= :d
        GROUP BY a.id`,
      { c, d: asOn },
    );
    return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, group: r.group_code as GroupCode, paise: P(r.bal) }));
  }

  /** Today's stock at cost price; products in stock without a cost aren't valued (and are counted). */
  private async stockValue(c: number) {
    const r = await this.db.one(
      `SELECT COALESCE(SUM(CASE WHEN cost_price > 0 THEN stock_quantity * cost_price END), 0) AS v,
              COALESCE(SUM(COALESCE(cost_price, 0) <= 0), 0) AS unvalued, COUNT(*) AS items
         FROM products WHERE company_id = :c AND is_active = 1 AND stock_quantity > 0`,
      { c },
    );
    return { paise: P(r?.v), unvalued: Number(r?.unvalued || 0), items: Number(r?.items || 0) };
  }

  /** The opening stock typed in (Openings → Other accounts → Stock in hand). */
  private async openingStock(c: number) {
    const r = await this.db.one(
      `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS v FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id
        WHERE l.company_id = :c AND a.code = 'STOCK' AND e.entry_type = 'OPENING'`,
      { c },
    );
    return P(r?.v);
  }

  /**
   * Stock counts in a period only from the books' first day up to today: the
   * opening stock you entered, and today's stock at cost. Otherwise neither
   * (purchases then count in full) — said so on the report.
   */
  private async stock(c: number, from: string, to: string, booksStart: string, today: string) {
    if (from !== booksStart || to !== today) return { opening: null, closing: null, unvalued: 0, items: 0 };
    const [os, cs] = await Promise.all([this.openingStock(c), this.stockValue(c)]);
    return { opening: os, closing: cs.paise, unvalued: cs.unvalued, items: cs.items };
  }

  async profitLoss(u: LedgerUser, query: any) {
    const c = u.company_id;
    const p = await this.period(c, query);
    const [moves, stock] = await Promise.all([this.moves(c, p.from, p.to), this.stock(c, p.from, p.to, p.booksStart, p.today)]);
    const pl = profitAndLoss(moves, { opening: stock.opening, closing: stock.closing });
    return {
      period: { from: p.from, to: p.to, preset: p.preset, fy: fyLabel(p.to) },
      books_start: p.booksStart,
      sales: rowsOut(pl.sales),
      direct_incomes: rowsOut(pl.direct_incomes),
      purchases: rowsOut(pl.purchases),
      direct_expenses: rowsOut(pl.direct_expenses),
      indirect_incomes: rowsOut(pl.indirect_incomes),
      indirect_expenses: rowsOut(pl.indirect_expenses),
      opening_stock: r2(pl.opening_stock),
      closing_stock: r2(pl.closing_stock),
      stock_counted: stock.closing !== null,
      unvalued_products: stock.unvalued,
      totals: Object.fromEntries(Object.entries(pl.totals).map(([k, v]) => [k, R(v)])),
      gross_profit: R(pl.gross_profit),
      net_profit: R(pl.net_profit),
    };
  }

  async balanceSheetReport(u: LedgerUser, query: any) {
    const c = u.company_id;
    const s = await this.books.ensure(c);
    const today = this.db.today();
    const asOn = isIsoDate(query?.date) ? query.date : today;
    if (asOn < s.books_start) throw bad(`Choose a date on or after your books start (${s.books_start})`);
    if (asOn > today) throw bad("Choose today or an earlier date");
    const [bal, moves, stock] = await Promise.all([this.balances(c, asOn), this.moves(c, s.books_start, asOn), this.stock(c, s.books_start, asOn, s.books_start, today)]);
    const pl = profitAndLoss(moves, { opening: stock.opening, closing: stock.closing });
    const bs = balanceSheet(bal, pl.net_profit, stock.closing);
    const side = (groups: typeof bs.assets) => groups.map((g) => ({ group: g.group, name: g.name, rows: rowsOut(g.rows), total: R(g.rows.reduce((t, x) => t + x.paise, 0)) }));
    return {
      as_on: asOn,
      books_start: s.books_start,
      liabilities: side(bs.liabilities),
      assets: side(bs.assets),
      total_liabilities: R(bs.total_liabilities),
      total_assets: R(bs.total_assets),
      difference: R(bs.difference),
      stock_counted: stock.closing !== null,
      unvalued_products: stock.unvalued,
      opening_difference: R(0 - bal.filter((b) => b.code === 'OPENING_DIFF').reduce((t, b) => t + b.paise, 0)),
    };
  }

  async trialBalance(u: LedgerUser, query: any) {
    const c = u.company_id;
    const p = await this.period(c, query);
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code,
              COALESCE(SUM(CASE WHEN l.entry_date < :from OR e.entry_type = 'OPENING' THEN l.debit - l.credit END), 0) AS opening,
              COALESCE(SUM(CASE WHEN l.entry_date >= :from AND e.entry_type <> 'OPENING' THEN l.debit END), 0) AS dr,
              COALESCE(SUM(CASE WHEN l.entry_date >= :from AND e.entry_type <> 'OPENING' THEN l.credit END), 0) AS cr
         FROM ledger_accounts a JOIN ledger_lines l ON l.account_id = a.id AND l.company_id = a.company_id JOIN ledger_entries e ON e.id = l.entry_id
        WHERE a.company_id = :c AND l.entry_date <= :to
        GROUP BY a.id ORDER BY a.group_code, a.name`,
      { c, from: p.from, to: p.to },
    );
    const lines = rows.map((r) => {
      const opening = P(r.opening);
      const dr = P(r.dr);
      const cr = P(r.cr);
      const closing = opening + dr - cr;
      return { id: Number(r.id), code: r.code, name: r.name, group: r.group_code as GroupCode, opening, dr, cr, closing };
    });
    const order = Object.keys(GROUPS) as GroupCode[];
    const groups = order
      .map((g) => {
        const ls = lines.filter((l) => l.group === g && (l.opening || l.dr || l.cr || l.closing));
        if (!ls.length) return null;
        const sum = (k: 'opening' | 'dr' | 'cr' | 'closing') => ls.reduce((t, l) => t + l[k], 0);
        return {
          group: g,
          name: GROUPS[g].name,
          nature: GROUPS[g].nature,
          rows: ls.map((l) => ({ id: l.id, code: l.code, name: l.name, opening: R(l.opening), debit: R(l.dr), credit: R(l.cr), closing: R(l.closing) })),
          opening: R(sum('opening')),
          debit: R(sum('dr')),
          credit: R(sum('cr')),
          closing: R(sum('closing')),
        };
      })
      .filter(Boolean);
    const closingDr = lines.reduce((t, l) => t + (l.closing > 0 ? l.closing : 0), 0);
    const closingCr = lines.reduce((t, l) => t + (l.closing < 0 ? -l.closing : 0), 0);
    return {
      period: { from: p.from, to: p.to, preset: p.preset },
      groups,
      totals: { debit: R(lines.reduce((t, l) => t + l.dr, 0)), credit: R(lines.reduce((t, l) => t + l.cr, 0)), closing_dr: R(closingDr), closing_cr: R(closingCr) },
      balanced: closingDr === closingCr,
    };
  }

  async gst(u: LedgerUser, query: any) {
    const c = u.company_id;
    const p = await this.period(c, query);
    const rows = await this.db.sel(
      `SELECT DATE_FORMAT(l.entry_date, '%Y-%m') AS ym, a.code, COALESCE(SUM(l.credit) - SUM(l.debit), 0) AS v
         FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id JOIN ledger_entries e ON e.id = l.entry_id
        WHERE l.company_id = :c AND l.entry_date BETWEEN :from AND :to AND e.entry_type <> 'OPENING'
          AND a.code IN ('OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST', 'SALES', 'TRANSPORT_INCOME', 'SALES_RETURNS', 'PURCHASES', 'FREIGHT_INWARD', 'PURCHASE_RETURNS')
        GROUP BY ym, a.code`,
      { c, from: p.from, to: p.to },
    );
    const months = gstByMonth(rows.map((r) => ({ ym: r.ym, code: r.code, paise: P(r.v) })));
    const money = (o: { cgst: number; sgst: number; igst: number }) => ({ cgst: R(o.cgst), sgst: R(o.sgst), igst: R(o.igst) });
    const sum = (k: 'sales' | 'purchases' | 'output_total' | 'input_total' | 'net') => months.reduce((t, m) => t + m[k], 0);
    return {
      period: { from: p.from, to: p.to, preset: p.preset },
      months: months.map((m) => ({ month: m.month, sales: R(m.sales), purchases: R(m.purchases), output: money(m.output), input: money(m.input), output_total: R(m.output_total), input_total: R(m.input_total), net: R(m.net) })),
      totals: { sales: R(sum('sales')), purchases: R(sum('purchases')), output: R(sum('output_total')), input: R(sum('input_total')), net: R(sum('net')) },
    };
  }

  /** Who owes you (by invoice due dates) or whom you owe (by bill due dates), by age, today. */
  async outstanding(u: LedgerUser, query: any) {
    const c = u.company_id;
    await this.books.ensure(c);
    const today = this.db.today();
    const kind = query?.kind === 'supplier' ? 'supplier' : 'customer';
    const late = (d: string) => `DATEDIFF(:today, ${d})`;
    const bucketSums = (bal: string, d: string) => `
      COALESCE(SUM(CASE WHEN ${late(d)} <= 0 THEN ${bal} END), 0) AS not_due,
      COALESCE(SUM(CASE WHEN ${late(d)} BETWEEN 1 AND 30 THEN ${bal} END), 0) AS d1_30,
      COALESCE(SUM(CASE WHEN ${late(d)} BETWEEN 31 AND 60 THEN ${bal} END), 0) AS d31_60,
      COALESCE(SUM(CASE WHEN ${late(d)} BETWEEN 61 AND 90 THEN ${bal} END), 0) AS d61_90,
      COALESCE(SUM(CASE WHEN ${late(d)} > 90 THEN ${bal} END), 0) AS d90_plus,
      COALESCE(SUM(${bal}), 0) AS total, COUNT(*) AS docs, MAX(${late(d)}) AS oldest`;
    let rows: any[];
    try {
      rows =
        kind === 'customer'
          ? await this.db.sel(
              `SELECT i.customer_id AS id, MAX(i.customer_name) AS name, ${bucketSums('i.balance_amount', 'COALESCE(i.due_date, i.invoice_date)')}
                 FROM invoices i WHERE i.company_id = :c AND ${LIVE} AND i.balance_amount > 0.004
                GROUP BY i.customer_id ORDER BY total DESC`,
              { c, today },
            )
          : await this.db.sel(
              `SELECT b.supplier_id AS id, MAX(s.name) AS name, ${bucketSums('b.balance_amount', 'COALESCE(b.due_date, b.bill_date)')}
                 FROM purchase_bills b JOIN suppliers s ON s.id = b.supplier_id
                WHERE b.company_id = :c AND b.status <> 'CANCELLED' AND b.balance_amount > 0.004
                GROUP BY b.supplier_id ORDER BY total DESC`,
              { c, today },
            );
    } catch {
      rows = [];
    }
    const keys = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'] as const;
    const out = rows.map((r) => ({
      id: Number(r.id),
      name: r.name || '—',
      docs: Number(r.docs),
      oldest_days: Math.max(0, Number(r.oldest || 0)),
      ...Object.fromEntries(keys.map((k) => [k, R(P(r[k]))])),
    }));
    const totals = Object.fromEntries(keys.map((k) => [k, R(rows.reduce((t, r) => t + P(r[k]), 0))]));
    return { kind, as_on: today, rows: out, totals };
  }
}
