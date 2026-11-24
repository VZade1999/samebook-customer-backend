import { Injectable } from '@nestjs/common';
import { LedgerDb, LedgerUser, bad, can, notFound } from './ledger-db';
import { LedgerSyncService } from './ledger-sync.service';
import {
  OPENABLE_GROUPS,
  ACCOUNTS_PERMS,
  ENTRY_WORD,
  EntryType,
  GROUPS,
  P,
  PARTY_FILTERS,
  PartyType,
  R,
  SourceType,
  balanceWords,
  bankLabel,
  cashWarnings,
  drCr,
  fyLabel,
  openingPosting,
  openingTarget,
  pageOf,
  parseOpenings,
  parseRange,
  parseSettings,
  partyTypeOf,
  searchText,
  withRunningBalance,
} from './ledger.rules';

const MAX_ROWS = 5000;

/** A balance (paise, debit − credit) as the screens show it. */
const balanceOf = (type: PartyType | null, paise: number) => ({
  ...drCr(paise),
  value: R(paise),
  words: type ? balanceWords(type, paise) : null,
});

/**
 * Accounts: what the ledger screens read — totals, customers' and suppliers'
 * balances, a party's statement — plus the books' settings and opening
 * balances. Every read first brings the books up to date (LedgerSyncService).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly db: LedgerDb,
    private readonly books: LedgerSyncService,
  ) {}

  /** The money picture: what customers owe, what you owe suppliers, cash and bank. */
  async summary(u: LedgerUser) {
    const c = u.company_id;
    const s = await this.books.ensure(c);
    const parties = await this.db.sel(
      `SELECT party_type,
              COALESCE(SUM(CASE WHEN bal > 0 THEN bal END), 0) AS pos, COALESCE(SUM(CASE WHEN bal < 0 THEN -bal END), 0) AS neg,
              SUM(bal > 0) AS npos, SUM(bal < 0) AS nneg
         FROM (SELECT party_type, party_id, SUM(debit) - SUM(credit) AS bal FROM ledger_lines
                WHERE company_id = :c AND party_type IS NOT NULL GROUP BY party_type, party_id) x
        GROUP BY party_type`,
      { c },
    );
    const of = (t: string) => parties.find((p) => p.party_type === t) || { pos: 0, neg: 0, npos: 0, nneg: 0 };
    const cust = of('CUSTOMER');
    const sup = of('SUPPLIER');
    const money = await this.moneyAccounts(c);
    const diff = await this.db.one(
      `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
        WHERE l.company_id = :c AND a.code = 'OPENING_DIFF'`,
      { c },
    );
    const today = this.db.today();
    return {
      books_start: s.books_start,
      fy: fyLabel(today),
      today,
      you_get: R(P(cust.pos)),
      customers_owing: Number(cust.npos) || 0,
      advances_received: R(P(cust.neg)),
      you_owe: R(P(sup.neg)),
      suppliers_owed: Number(sup.nneg) || 0,
      advances_paid: R(P(sup.pos)),
      cash: R(money.filter((m) => m.group === 'CASH_IN_HAND').reduce((a, m) => a + P(m.balance), 0)),
      bank: R(money.filter((m) => m.group === 'BANK_ACCOUNTS').reduce((a, m) => a + P(m.balance), 0)),
      money,
      opening_difference: balanceOf(null, P(diff?.bal)),
      warnings: (await this.cashWarningList(c)).length,
      can: { record: can(u, ACCOUNTS_PERMS.record), reports: can(u, ACCOUNTS_PERMS.reports) },
    };
  }

  /** Cash in hand and each bank, with balances. */
  private async moneyAccounts(c: number) {
    const rows = await this.db.sel(
      `SELECT a.id, a.code, a.name, a.group_code, a.bank_account_id, COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal
         FROM ledger_accounts a LEFT JOIN ledger_lines l ON l.account_id = a.id AND l.company_id = a.company_id
        WHERE a.company_id = :c AND a.group_code IN ('CASH_IN_HAND', 'BANK_ACCOUNTS') AND a.is_active = 1
        GROUP BY a.id ORDER BY a.group_code = 'CASH_IN_HAND' DESC, a.name`,
      { c },
    );
    return rows.map((r) => ({ id: Number(r.id), code: r.code, name: r.name, group: r.group_code, bank_account_id: r.bank_account_id ? Number(r.bank_account_id) : null, balance: R(P(r.bal)) }));
  }

  /** Customers or suppliers with their balances, most owed first. */
  async parties(u: LedgerUser, query: any) {
    const c = u.company_id;
    const type = partyTypeOf(query?.type) || 'CUSTOMER';
    await this.books.ensure(c);
    const { limit, offset, page } = pageOf(query?.page, query?.limit);
    const q = searchText(query?.q);
    const filter = (PARTY_FILTERS as readonly string[]).includes(String(query?.filter)) ? String(query.filter) : 'all';
    const owed = type === 'CUSTOMER' ? 'b.bal > 0' : 'b.bal < 0';
    const ahead = type === 'CUSTOMER' ? 'b.bal < 0' : 'b.bal > 0';
    const where = [
      'COALESCE(b.bal, 0) <> 0 OR p.is_active = 1',
      filter === 'due' ? owed : filter === 'advance' ? ahead : filter === 'settled' ? 'COALESCE(b.bal, 0) = 0' : null,
      q ? (type === 'CUSTOMER' ? 'p.display_name LIKE :like OR p.company_name LIKE :like OR p.gst_number LIKE :like OR p.phone LIKE :like' : 'p.name LIKE :like OR p.legal_name LIKE :like OR p.gstin LIKE :like OR p.phone LIKE :like') : null,
    ]
      .filter(Boolean)
      .map((w) => `(${w})`)
      .join(' AND ');
    const from =
      type === 'CUSTOMER'
        ? `FROM customers p LEFT JOIN (SELECT party_id, SUM(debit) - SUM(credit) AS bal, MAX(entry_date) AS last_date FROM ledger_lines
                                        WHERE company_id = :c AND party_type = 'CUSTOMER' GROUP BY party_id) b ON b.party_id = p.id
           WHERE p.company_id = :c AND ${where}`
        : `FROM suppliers p LEFT JOIN (SELECT party_id, SUM(debit) - SUM(credit) AS bal, MAX(entry_date) AS last_date FROM ledger_lines
                                        WHERE company_id = :c AND party_type = 'SUPPLIER' GROUP BY party_id) b ON b.party_id = p.id
           WHERE p.company_id = :c AND ${where}`;
    const name = type === 'CUSTOMER' ? 'COALESCE(NULLIF(p.display_name, \'\'), p.company_name)' : 'p.name';
    const gstin = type === 'CUSTOMER' ? 'p.gst_number' : 'p.gstin';
    const order = filter === 'due' ? (type === 'CUSTOMER' ? 'b.bal DESC' : 'b.bal ASC') : filter === 'advance' ? (type === 'CUSTOMER' ? 'b.bal ASC' : 'b.bal DESC') : 'COALESCE(b.bal, 0) = 0, ABS(COALESCE(b.bal, 0)) DESC';
    const params = { c, like: `%${q}%`, limit, offset };
    const [rows, total] = await Promise.all([
      this.db.sel(
        `SELECT p.id, ${name} AS name, ${gstin} AS gstin, p.phone, p.is_active, COALESCE(b.bal, 0) AS bal, DATE_FORMAT(b.last_date, '%Y-%m-%d') AS last_date
           ${from} ORDER BY ${order}, ${name} LIMIT :limit OFFSET :offset`,
        params,
      ),
      this.db.one(`SELECT COUNT(*) AS n ${from}`, params),
    ]);
    return {
      type,
      rows: rows.map((r) => ({
        id: Number(r.id),
        name: r.name || '—',
        gstin: r.gstin || null,
        phone: r.phone || null,
        is_active: Number(r.is_active) === 1,
        last_date: r.last_date,
        balance: balanceOf(type, P(r.bal)),
      })),
      total: Number(total?.n || 0),
      page,
      limit,
    };
  }

  /** One customer's or supplier's statement for a period: opening, each entry with the running balance, closing. */
  async statement(u: LedgerUser, typeRaw: string, id: number, query: any) {
    const c = u.company_id;
    const type = partyTypeOf(typeRaw);
    if (!type) throw bad('Choose customer or supplier');
    const s = await this.books.ensure(c);
    const today = this.db.today();
    const range = parseRange(query || {}, { today, booksStart: s.books_start });
    if (!range.ok) throw bad(range.message);
    const party = await this.partyInfo(c, type, id);
    const where = `l.company_id = :c AND l.party_type = :t AND l.party_id = :id`;
    const params = { c, t: type, id, from: range.from, to: range.to };
    // Opening balances (dated the books' start, never after a period's start) are part of the opening, not rows.
    const [opening, rows] = await Promise.all([
      this.db.one(
        `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
          WHERE ${where} AND (l.entry_date < :from OR e.entry_type = 'OPENING')`,
        params,
      ),
      this.db.sel(
        `SELECT e.id AS entry_id, DATE_FORMAT(l.entry_date, '%Y-%m-%d') AS d, e.entry_type, e.number, e.narration, e.source_type, e.source_id,
                CASE WHEN e.source_type = 'INVOICE_PAYMENT' THEN (SELECT p.invoice_id FROM invoice_payments p WHERE p.id = e.source_id) ELSE e.source_id END AS doc_id,
                l.debit, l.credit
           FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
          WHERE ${where} AND l.entry_date BETWEEN :from AND :to AND e.entry_type <> 'OPENING'
          ORDER BY l.entry_date, e.created_at, e.id, l.id
          LIMIT ${MAX_ROWS + 1}`,
        params,
      ),
    ]);
    if (rows.length > MAX_ROWS) throw bad(`More than ${MAX_ROWS.toLocaleString('en-IN')} entries — choose a shorter period`);
    const run = withRunningBalance(
      P(opening?.bal),
      rows.map((r) => ({
        entry_id: Number(r.entry_id),
        entry_date: r.d,
        entry_type: r.entry_type as EntryType,
        number: r.number,
        narration: r.narration,
        source_type: r.source_type as SourceType,
        source_id: r.source_id === null ? null : Number(r.source_id),
        debit: P(r.debit),
        credit: P(r.credit),
      })),
    );
    const docIds = new Map(rows.map((r) => [Number(r.entry_id), r.doc_id === null ? null : Number(r.doc_id)]));
    const saved = await this.db.one(
      `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS bal FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id AND l.party_type = :t
        WHERE e.company_id = :c AND e.source_type = :src AND e.source_id = :id`,
      { c, t: type, id, src: type === 'CUSTOMER' ? 'OPENING_CUSTOMER' : 'OPENING_SUPPLIER' },
    );
    const openingPaise = P(saved?.bal);
    return {
      company: await this.letterhead(c),
      /** The opening balance saved for this party on the books' start date (0 = none). */
      party_opening: { amount: R(Math.abs(openingPaise)), side: openingPaise > 0 ? 'Dr' : openingPaise < 0 ? 'Cr' : type === 'CUSTOMER' ? 'Dr' : 'Cr' },
      party,
      period: { from: range.from, to: range.to, preset: range.preset },
      books_start: s.books_start,
      opening: balanceOf(type, run.opening),
      rows: run.rows.map((r) => ({
        entry_id: r.entry_id,
        date: r.entry_date,
        type: r.entry_type,
        type_word: ENTRY_WORD[r.entry_type] || r.entry_type,
        number: r.number,
        narration: r.narration,
        source_type: r.source_type,
        doc_id: docIds.get(r.entry_id) ?? null,
        debit: R(r.debit),
        credit: R(r.credit),
        balance: balanceOf(type, r.balance),
      })),
      totals: { debit: R(run.debit), credit: R(run.credit) },
      closing: balanceOf(type, run.closing),
    };
  }

  /** The company's name, address and GSTIN for a statement's letterhead. */
  private async letterhead(c: number) {
    const co = await this.db.one(`SELECT name, legal_name, gst_no, primary_email, primary_phone FROM companies WHERE id = :c`, { c });
    const a = await this.db.one(
      `SELECT line_1, line_2, city, state, postal_code FROM company_addresses WHERE company_id = :c AND COALESCE(is_active, 1) = 1
        ORDER BY (LOWER(type) = 'office') DESC, is_default DESC, id LIMIT 1`,
      { c },
    );
    return {
      name: co?.name || 'Your company',
      legal_name: co?.legal_name || null,
      gstin: co?.gst_no || null,
      phone: co?.primary_phone || null,
      email: co?.primary_email || null,
      address_lines: a ? [a.line_1, a.line_2, [a.city, a.state, a.postal_code].filter(Boolean).join(', ')].filter(Boolean) : [],
    };
  }

  private async partyInfo(c: number, type: PartyType, id: number) {
    if (type === 'CUSTOMER') {
      const p = await this.db.one(
        `SELECT id, COALESCE(NULLIF(display_name, ''), company_name) AS name, company_name, gst_number AS gstin, phone, email FROM customers WHERE id = :id AND company_id = :c`,
        { id, c },
      );
      if (!p) throw notFound('Customer');
      const a = await this.db.one(
        `SELECT address_line_1, address_line_2, city, state, postal_code FROM customer_addresses
          WHERE customer_id = :id AND COALESCE(is_active, 1) = 1 ORDER BY address_type = 'BILLING' DESC, is_primary DESC, id LIMIT 1`,
        { id },
      );
      const contact = await this.db.one(
        `SELECT TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS name, phone, email FROM customer_contacts
          WHERE customer_id = :id AND COALESCE(is_active, 1) = 1 ORDER BY is_primary DESC, id LIMIT 1`,
        { id },
      );
      return { type, id: Number(p.id), name: p.name || '—', gstin: p.gstin || null, phone: p.phone || contact?.phone || null, email: p.email || contact?.email || null, address: addressLines(a) };
    }
    const p = await this.db.one(`SELECT id, name, gstin, phone, email, state FROM suppliers WHERE id = :id AND company_id = :c`, { id, c });
    if (!p) throw notFound('Supplier');
    const a = await this.db.one(
      `SELECT address_line_1, address_line_2, city, state, postal_code FROM supplier_addresses WHERE supplier_id = :id ORDER BY is_primary DESC, id LIMIT 1`,
      { id },
    );
    return { type, id: Number(p.id), name: p.name, gstin: p.gstin || null, phone: p.phone || null, email: p.email || null, address: addressLines(a) || (p.state ? [p.state] : []) };
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(u: LedgerUser) {
    const c = u.company_id;
    const s = await this.books.settings(c);
    const banks = await this.db.sel(
      `SELECT id, bank_name, account_number, is_default, is_active FROM company_bank_accounts WHERE company_id = :c ORDER BY is_active DESC, is_default DESC, id`,
      { c },
    );
    return {
      books_start: s.books_start,
      default_bank_account_id: s.default_bank_account_id,
      bank_in_use: s.bank_id,
      banks: banks.map((b) => ({ id: Number(b.id), label: bankLabel(b), is_default: Number(b.is_default) === 1, is_active: Number(b.is_active) === 1 })),
      groups: Object.entries(GROUPS).map(([code, g]) => ({ code, name: g.name, nature: g.nature })),
      can_edit: can(u, ACCOUNTS_PERMS.record),
    };
  }

  async saveSettings(u: LedgerUser, body: any) {
    const c = u.company_id;
    const parsed = parseSettings(body, { today: this.db.today() });
    if (!parsed.ok) throw bad(parsed.message);
    const v = parsed.value;
    if (v.default_bank_account_id) {
      const own = await this.db.one(`SELECT id FROM company_bank_accounts WHERE id = :id AND company_id = :c`, { id: v.default_bank_account_id, c });
      if (!own) throw bad('Choose one of your bank accounts');
    }
    await this.books.settings(c);
    await this.db.tx(async (t) => {
      await this.db.run(
        `UPDATE ledger_settings SET books_start = :start, default_bank_account_id = :bank, updated_by = :u WHERE company_id = :c`,
        { c, start: v.books_start, bank: v.default_bank_account_id, u: u.user_id },
        t,
      );
      await this.books.moveOpenings(c, v.books_start, t);
    });
    this.books.touch(c);
    await this.books.ensure(c);
    return { ...(await this.getSettings(u)), message: 'Books settings saved' };
  }

  // ── Opening balances ───────────────────────────────────────────────────────

  /** Opening balances: customers or suppliers (search, paged; those with one first), or cash and banks. */
  async openings(u: LedgerUser, query: any) {
    const c = u.company_id;
    const s = await this.books.settings(c);
    const kind = String(query?.kind || 'customer');
    if (kind === 'money') {
      const banks = await this.db.sel(`SELECT id, bank_name, account_number, is_active FROM company_bank_accounts WHERE company_id = :c ORDER BY is_active DESC, is_default DESC, id`, { c });
      const opens = await this.db.sel(
        `SELECT e.source_type, e.source_id, SUM(l.debit) - SUM(l.credit) AS bal FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id
          JOIN ledger_accounts a ON a.id = l.account_id AND a.group_code IN ('CASH_IN_HAND', 'BANK_ACCOUNTS')
          WHERE e.company_id = :c AND e.source_type IN ('OPENING_CASH', 'OPENING_BANK') GROUP BY e.id`,
        { c },
      );
      const of = (src: string, id: number) => P(opens.find((o) => o.source_type === src && Number(o.source_id) === id)?.bal);
      return {
        books_start: s.books_start,
        kind,
        rows: [
          { kind: 'cash', id: null, name: 'Cash in hand', ...amountSide(of('OPENING_CASH', 0), 'Dr') },
          ...banks.map((b) => ({ kind: 'bank', id: Number(b.id), name: bankLabel(b), inactive: Number(b.is_active) !== 1, ...amountSide(of('OPENING_BANK', Number(b.id)), 'Dr') })),
        ],
        total: banks.length + 1,
      };
    }
    if (kind === 'accounts') {
      // Capital, loans, assets, stock in hand… (the stock account is made on first use).
      await this.books.accounts(c, new Set(['STOCK', 'CAPITAL']));
      const rows = await this.db.sel(
        `SELECT a.id, a.code, a.name, a.group_code,
                COALESCE((SELECT SUM(l.debit) - SUM(l.credit) FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id AND l.account_id = a.id
                           WHERE e.company_id = a.company_id AND e.source_type = 'OPENING_ACCOUNT' AND e.source_id = a.id), 0) AS bal
           FROM ledger_accounts a WHERE a.company_id = :c AND a.is_active = 1 AND a.group_code IN (:groups)
          ORDER BY FIELD(a.group_code, :groups), a.name`,
        { c, groups: OPENABLE_GROUPS },
      );
      return {
        books_start: s.books_start,
        kind,
        rows: rows.map((r) => ({
          kind: 'account',
          id: Number(r.id),
          name: r.name,
          group: GROUPS[r.group_code as keyof typeof GROUPS]?.name || r.group_code,
          ...amountSide(P(r.bal), GROUPS[r.group_code as keyof typeof GROUPS]?.nature === 'ASSET' ? 'Dr' : 'Cr'),
        })),
        total: rows.length,
      };
    }
    const type: PartyType = kind === 'supplier' ? 'SUPPLIER' : 'CUSTOMER';
    const { limit, offset, page } = pageOf(query?.page, query?.limit, 200);
    const q = searchText(query?.q);
    const src = type === 'CUSTOMER' ? 'OPENING_CUSTOMER' : 'OPENING_SUPPLIER';
    const table = type === 'CUSTOMER' ? 'customers' : 'suppliers';
    const name = type === 'CUSTOMER' ? "COALESCE(NULLIF(p.display_name, ''), p.company_name)" : 'p.name';
    const gstin = type === 'CUSTOMER' ? 'p.gst_number' : 'p.gstin';
    const from = `FROM ${table} p LEFT JOIN (SELECT e.source_id, SUM(l.debit) - SUM(l.credit) AS bal FROM ledger_entries e
                                              JOIN ledger_lines l ON l.entry_id = e.id AND l.party_type = :t
                                             WHERE e.company_id = :c AND e.source_type = :src GROUP BY e.source_id) o ON o.source_id = p.id
                  WHERE p.company_id = :c AND (p.is_active = 1 OR o.bal IS NOT NULL) ${q ? `AND (${name} LIKE :like OR ${gstin} LIKE :like)` : ''}`;
    const params = { c, t: type, src, like: `%${q}%`, limit, offset };
    const [rows, total] = await Promise.all([
      this.db.sel(`SELECT p.id, ${name} AS name, ${gstin} AS gstin, COALESCE(o.bal, 0) AS bal ${from} ORDER BY o.bal IS NULL, ${name} LIMIT :limit OFFSET :offset`, params),
      this.db.one(`SELECT COUNT(*) AS n ${from}`, params),
    ]);
    return {
      books_start: s.books_start,
      kind,
      rows: rows.map((r) => ({ kind, id: Number(r.id), name: r.name || '—', gstin: r.gstin || null, ...amountSide(P(r.bal), type === 'CUSTOMER' ? 'Dr' : 'Cr') })),
      total: Number(total?.n || 0),
      page,
      limit,
    };
  }

  /** Save opening balances (several at once). Zero removes one. */
  async saveOpenings(u: LedgerUser, body: any) {
    const c = u.company_id;
    const parsed = parseOpenings(body);
    if (!parsed.ok) throw bad(parsed.message);
    const s = await this.books.settings(c);
    const items = parsed.items;
    const accIds = items.filter((i) => i.kind === 'account').map((i) => i.id as number);
    if (accIds.length) {
      const own = await this.db.sel(`SELECT id, group_code FROM ledger_accounts WHERE company_id = :c AND id IN (:ids)`, { c, ids: accIds });
      if (own.length !== accIds.length || own.some((a) => !OPENABLE_GROUPS.includes(a.group_code))) throw bad('Opening balances go on capital, loans, assets, stock and tax accounts only');
    }
    // Everything named must be the company's.
    const idsOf = (k: string) => items.filter((i) => i.kind === k).map((i) => i.id as number);
    const check = async (k: string, sql: string, what: string) => {
      const ids = idsOf(k);
      if (!ids.length) return;
      const got = new Set((await this.db.sel(sql, { c, ids })).map((r) => Number(r.id)));
      if (ids.some((x) => !got.has(x))) throw bad(`Choose one of your ${what}`);
    };
    await check('customer', `SELECT id FROM customers WHERE company_id = :c AND id IN (:ids)`, 'customers');
    await check('supplier', `SELECT id FROM suppliers WHERE company_id = :c AND id IN (:ids)`, 'suppliers');
    await check('bank', `SELECT id FROM company_bank_accounts WHERE company_id = :c AND id IN (:ids)`, 'bank accounts');
    let saved = 0;
    let removed = 0;
    await this.db.tx(async (t) => {
      await this.db.one(`SELECT company_id FROM ledger_settings WHERE company_id = :c FOR UPDATE`, { c }, t);
      const keep = items.filter((i) => i.paise > 0);
      const drop = items.filter((i) => i.paise === 0);
      for (const it of drop) {
        const target = openingTarget(it);
        const e = await this.db.one(`SELECT id FROM ledger_entries WHERE company_id = :c AND source_type = :s AND source_id = :id`, { c, s: target.source, id: target.sourceId }, t);
        if (e) {
          await this.books.remove(c, [Number(e.id)], t);
          removed++;
        }
      }
      await this.books.write(
        c,
        keep.map((it) => {
          const target = openingTarget(it);
          return {
            source: target.source,
            sourceId: target.sourceId,
            fingerprint: null,
            posting: openingPosting(target, it.paise, it.side, s.books_start),
            createdBy: u.user_id,
          };
        }),
        t,
      );
      saved = keep.length;
    });
    this.books.touch(c);
    return { saved, removed, message: saved || removed ? `Opening balances saved (${saved + removed})` : 'Nothing changed' };
  }

  // ── Indian cash rules ──────────────────────────────────────────────────────

  /** Cash received of ₹2 lakh or more (269ST) or paid above ₹10,000 (40A(3)) from / to one person in a day. */
  async warnings(u: LedgerUser) {
    await this.books.ensure(u.company_id);
    return { rows: await this.cashWarningList(u.company_id) };
  }

  private async cashWarningList(c: number) {
    const rows = await this.db.sel(
      `SELECT DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS d, e.party_type, e.party_id, SUM(l.debit) AS cash_in, SUM(l.credit) AS cash_out
         FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
        WHERE l.company_id = :c AND a.code = 'CASH' AND e.party_id IS NOT NULL AND e.entry_type <> 'OPENING'
        GROUP BY e.entry_date, e.party_type, e.party_id
       HAVING SUM(l.debit) >= 200000 OR SUM(l.credit) > 10000`,
      { c },
    );
    // Expenses paid in cash are checked by the payee's name (40A(3)).
    let spent: any[] = [];
    try {
      spent = await this.db.sel(
        `SELECT DATE_FORMAT(expense_date, '%Y-%m-%d') AS d, MIN(payee) AS payee, SUM(total) AS t FROM expenses
          WHERE company_id = :c AND status = 'ACTIVE' AND mode = 'CASH' AND payee IS NOT NULL AND payee <> ''
          GROUP BY expense_date, LOWER(TRIM(payee)) HAVING SUM(total) > 10000`,
        { c },
      );
    } catch {
      spent = [];
    }
    const expenseMoves = spent.map((x) => ({ date: x.d, direction: 'OUT' as const, party_type: null, party_id: null, party_name: x.payee, paise: P(x.t) }));
    if (!rows.length) return cashWarnings(expenseMoves);
    const names = await this.partyNames(c, rows.map((r) => ({ type: r.party_type, id: Number(r.party_id) })));
    const moves = rows.flatMap((r) => {
      const base = { date: r.d, party_type: r.party_type as PartyType, party_id: Number(r.party_id), party_name: names.get(`${r.party_type}:${r.party_id}`) || null };
      return [
        ...(P(r.cash_in) ? [{ ...base, direction: 'IN' as const, paise: P(r.cash_in) }] : []),
        ...(P(r.cash_out) ? [{ ...base, direction: 'OUT' as const, paise: P(r.cash_out) }] : []),
      ];
    });
    return cashWarnings([...moves, ...expenseMoves]);
  }

  private async partyNames(c: number, list: { type: string; id: number }[]) {
    const out = new Map<string, string>();
    const cust = [...new Set(list.filter((x) => x.type === 'CUSTOMER').map((x) => x.id))];
    const sup = [...new Set(list.filter((x) => x.type === 'SUPPLIER').map((x) => x.id))];
    if (cust.length)
      (await this.db.sel(`SELECT id, COALESCE(NULLIF(display_name, ''), company_name) AS name FROM customers WHERE company_id = :c AND id IN (:ids)`, { c, ids: cust })).forEach((r) =>
        out.set(`CUSTOMER:${r.id}`, r.name),
      );
    if (sup.length) (await this.db.sel(`SELECT id, name FROM suppliers WHERE company_id = :c AND id IN (:ids)`, { c, ids: sup })).forEach((r) => out.set(`SUPPLIER:${r.id}`, r.name));
    return out;
  }

  /** Record every document again from scratch (after a fix, or when asked). */
  async recheck(u: LedgerUser) {
    const c = u.company_id;
    await this.db.tx(async (t) => {
      await this.db.run(
        `UPDATE ledger_entries SET fingerprint = NULL WHERE company_id = :c
            AND source_type IN ('INVOICE', 'INVOICE_PAYMENT', 'CUSTOMER_RECEIPT', 'EXPENSE', 'PURCHASE_BILL', 'SUPPLIER_PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'CUSTOMER_REFUND')`,
        { c },
        t,
      );
    });
    this.books.touch(c);
    await this.books.ensure(c);
    return { message: 'Books rechecked against your invoices, bills and payments' };
  }
}

/** A balance as an amount and side for an editable opening (natural side when zero). */
function amountSide(paise: number, natural: 'Dr' | 'Cr') {
  return { amount: R(Math.abs(paise)), side: paise > 0 ? 'Dr' : paise < 0 ? 'Cr' : natural };
}

function addressLines(a: any): string[] {
  if (!a) return [];
  const l1 = [a.address_line_1, a.address_line_2].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  const l2 = [a.city, a.state].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ') + (a.postal_code ? ` ${a.postal_code}` : '');
  return [l1, l2.trim()].filter(Boolean);
}
