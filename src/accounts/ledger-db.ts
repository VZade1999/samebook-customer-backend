import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { datePartsIn } from '../document-series/document-series.rules';

/** A refusal or failure with the HTTP status to answer with. */
export class LedgerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const bad = (message: string) => new LedgerError(400, message);
export const notFound = (what: string) => new LedgerError(404, `${what} not found`);

export interface LedgerUser {
  company_id: number;
  user_id: number;
  permissions: string[];
}
export const can = (u: LedgerUser, perm: string) => u.permissions.includes(perm);

/** A DATE column as YYYY-MM-DD (the connection runs in UTC, so a Date's UTC day is the stored day). */
export const isoDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Raw SQL for the Accounts services, in the caller's transaction when given. */
@Injectable()
export class LedgerDb {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  /** The Sequelize instance (for the shared stock engine). */
  get sequelize(): any {
    return this.db.sequelize;
  }

  sel(sql: string, replacements: Record<string, unknown> = {}, transaction?: any): Promise<any[]> {
    return this.db.sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
  }

  async one(sql: string, replacements: Record<string, unknown> = {}, transaction?: any): Promise<any | null> {
    const rows = await this.sel(sql, replacements, transaction);
    return rows[0] ?? null;
  }

  /** INSERT … → the new row's id. */
  async insert(sql: string, replacements: Record<string, unknown>, transaction?: any): Promise<number> {
    const [id] = await this.db.sequelize.query(sql, { replacements, type: QueryTypes.INSERT, transaction });
    return Number(id);
  }

  /** UPDATE / DELETE / INSERT … ON DUPLICATE → rows affected. */
  async run(sql: string, replacements: Record<string, unknown>, transaction?: any): Promise<number> {
    const [res, meta] = await this.db.sequelize.query(sql, { replacements, transaction });
    const head: any = res && typeof res === 'object' && 'affectedRows' in res ? res : meta;
    return Number(head?.affectedRows ?? 0) || 0;
  }

  async tx<T>(fn: (t: any) => Promise<T>): Promise<T> {
    const t = await this.db.sequelize.transaction();
    try {
      const out = await fn(t);
      await t.commit();
      return out;
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /**
   * The next voucher number for its financial year, e.g. RCT/26-27/0001. One
   * at a time per company (the company row is locked), so two never collide.
   */
  async nextNumber(companyId: number, prefix: string, table: string, column: string, t: any, extraWhere = ''): Promise<string> {
    await this.sel('SELECT id FROM companies WHERE id = :c FOR UPDATE', { c: companyId }, t);
    const row = await this.one(
      `SELECT MAX(CAST(SUBSTRING(${column}, :len) AS UNSIGNED)) AS m FROM ${table} WHERE company_id = :c AND ${column} LIKE :like ${extraWhere}`,
      { len: prefix.length + 1, c: companyId, like: `${prefix}%` },
      t,
    );
    return `${prefix}${String(Number(row?.m || 0) + 1).padStart(4, '0')}`;
  }

  /** Today in India (the business day), as YYYY-MM-DD. */
  today(): string {
    const p = datePartsIn(new Date());
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
}
