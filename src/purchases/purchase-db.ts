import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { DocumentSeriesService } from '../document-series/document-series.service';
import { datePartsIn, tokenValue } from '../document-series/document-series.rules';
import { GST_STATE_CODES, getStateCodeFromGstin, getStateCodeFromName } from '../common/gst-state.util';
import { PURCHASE_PERMS, PurchaseSettings, settingsFrom } from './purchase.rules';

/** A refusal or failure with the HTTP status to answer with. */
export class PurchaseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const bad = (message: string) => new PurchaseError(400, message);
export const notFound = (what: string) => new PurchaseError(404, `${what} not found`);

export interface PurchaseUser {
  company_id: number;
  user_id: number;
  permissions: string[];
}
export const can = (u: PurchaseUser, perm: string) => u.permissions.includes(perm);

/** A DATE column as YYYY-MM-DD (the connection runs in UTC, so a Date's UTC day is the stored day). */
export const isoDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
/** A DATETIME column (stored in UTC) as an ISO instant. */
export const isoTime = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).replace(' ', 'T');
  return /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
};

/** JSON kept in a text column (sometimes encoded twice) → object, or null. */
export const parseJson = (v: unknown): any => {
  let s: any = v;
  try {
    while (typeof s === 'string') s = JSON.parse(s);
  } catch {
    return null;
  }
  return s ?? null;
};

/**
 * Database plumbing shared by the Purchases services: raw SQL in the caller's
 * transaction, numbering, settings, approvers and the company's own details.
 */
@Injectable()
export class PurchaseDb {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    private readonly series: DocumentSeriesService,
  ) {}

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

  /** UPDATE / DELETE → rows matched. */
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

  /** Today in India (the business day), as YYYY-MM-DD. */
  today(): string {
    const p = datePartsIn(new Date());
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }

  async settings(companyId: number, t?: any): Promise<PurchaseSettings> {
    return settingsFrom(await this.one('SELECT * FROM purchase_settings WHERE company_id = :c', { c: companyId }, t));
  }

  async saveSettings(companyId: number, userId: number, s: PurchaseSettings) {
    await this.db.sequelize.query(
      `INSERT INTO purchase_settings (company_id, approval_limit, over_receipt_percent, default_payment_terms, default_delivery_terms, default_terms, updated_by, updated_at)
       VALUES (:c, :limit, :over, :pt, :dt, :terms, :u, NOW())
       ON DUPLICATE KEY UPDATE approval_limit = VALUES(approval_limit), over_receipt_percent = VALUES(over_receipt_percent),
         default_payment_terms = VALUES(default_payment_terms), default_delivery_terms = VALUES(default_delivery_terms),
         default_terms = VALUES(default_terms), updated_by = VALUES(updated_by), updated_at = NOW()`,
      {
        replacements: {
          c: companyId,
          limit: s.approval_limit,
          over: s.over_receipt_percent,
          pt: s.default_payment_terms,
          dt: s.default_delivery_terms,
          terms: s.default_terms,
          u: userId,
        },
      },
    );
  }

  /** Active people of the company who can approve POs (Admins always can). */
  async approvers(companyId: number): Promise<number[]> {
    const rows = await this.sel(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.company_id = :c
        WHERE u.company_id = :c AND u.is_active = 1
          AND ((r.level = 1 AND r.is_system = 1)
               OR EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                           WHERE rp.role_id = r.id AND p.name = :perm))`,
      { c: companyId, perm: PURCHASE_PERMS.approve },
    );
    return rows.map((r) => Number(r.id));
  }

  async userName(id: unknown): Promise<string | null> {
    if (!Number(id)) return null;
    const u = await this.one('SELECT first_name, last_name FROM users WHERE id = :id', { id: Number(id) });
    return u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || null : null;
  }

  /**
   * The next PO / GRN number: the company's numbering series when it has one,
   * else the standard PO/26-27/0001 (GRN/26-27/0001), restarting every April.
   */
  async nextNumber(companyId: number, kind: 'PURCHASE_ORDER' | 'GOODS_RECEIPT', t: any, seriesId?: number | null): Promise<{ number: string; seriesId: number | null }> {
    const issued = await this.series.issue(companyId, kind, t, seriesId);
    if (issued) return { number: issued.number, seriesId: issued.seriesId };
    // One at a time per company, so two documents never take the same number.
    await this.sel('SELECT id FROM companies WHERE id = :c FOR UPDATE', { c: companyId }, t);
    const parts = datePartsIn(new Date());
    const fy = tokenValue('FY', { format: '', padding: 4, seq: 1, parts });
    const [table, column, code] = kind === 'PURCHASE_ORDER' ? ['purchase_orders', 'po_number', 'PO'] : ['goods_receipts', 'grn_number', 'GRN'];
    const prefix = `${code}/${fy}/`;
    const row = await this.one(
      `SELECT MAX(CAST(SUBSTRING(${column}, :len) AS UNSIGNED)) AS m FROM ${table} WHERE company_id = :c AND ${column} LIKE :like`,
      { len: prefix.length + 1, c: companyId, like: `${prefix}%` },
      t,
    );
    for (let seq = Number(row?.m || 0) + 1, i = 0; i < 1000; seq++, i++) {
      const number = `${prefix}${String(seq).padStart(4, '0')}`;
      const taken = await this.one(`SELECT id FROM ${table} WHERE company_id = :c AND ${column} = :n`, { c: companyId, n: number }, t);
      if (!taken) return { number, seriesId: null };
    }
    throw new PurchaseError(400, `Could not find a free ${code} number`);
  }

  /**
   * Our side of the PO ("Bill to"): the company, or the chosen GST branch,
   * with its GSTIN, state and office address.
   */
  async buyer(companyId: number, locationId: number | null, t?: any) {
    const c = await this.one(
      'SELECT id, name, legal_name, gst_no, gst_state_code, primary_email, primary_phone FROM companies WHERE id = :c',
      { c: companyId },
      t,
    );
    if (!c) throw notFound('Company');
    if (locationId) {
      const l = await this.one('SELECT * FROM company_locations WHERE id = :id AND company_id = :c AND COALESCE(is_active, 1) = 1', { id: locationId, c: companyId }, t);
      if (!l) throw bad('That branch is not one of yours');
      if (!l.gst_no) throw bad('That branch has no GSTIN — pick another one');
      const code = l.gst_state_code || getStateCodeFromGstin(l.gst_no) || getStateCodeFromName(l.address_state);
      return {
        location_id: Number(l.id),
        name: c.name,
        legal_name: c.legal_name || null,
        branch: l.name || null,
        gstin: l.gst_no,
        state_code: code || null,
        state: code ? GST_STATE_CODES[code] : l.address_state || null,
        address_lines: [l.address_line_1, l.address_line_2, [l.address_city, l.address_state, l.address_postal_code].filter(Boolean).join(', ')].filter(Boolean),
        phone: c.primary_phone || null,
        email: c.primary_email || null,
      };
    }
    const a = await this.one(
      `SELECT * FROM company_addresses WHERE company_id = :c AND COALESCE(is_active, 1) = 1
        ORDER BY (LOWER(type) = 'office') DESC, is_default DESC, id LIMIT 1`,
      { c: companyId },
      t,
    );
    const code = c.gst_state_code || getStateCodeFromGstin(c.gst_no) || getStateCodeFromName(a?.state) || null;
    return {
      location_id: null,
      name: c.name,
      legal_name: c.legal_name || null,
      branch: null,
      gstin: c.gst_no || null,
      state_code: code,
      state: code ? GST_STATE_CODES[code] : a?.state || null,
      address_lines: a ? [a.line_1, a.line_2, [a.city, a.state, a.postal_code].filter(Boolean).join(', ')].filter(Boolean) : [],
      phone: c.primary_phone || a?.phone || null,
      email: c.primary_email || null,
    };
  }

  /** An active warehouse of the company (or the default one), with its address. */
  async warehouse(companyId: number, id: number | null, t?: any) {
    const w = id
      ? await this.one('SELECT id, name, address, city, state FROM warehouses WHERE id = :id AND company_id = :c AND is_active = 1', { id, c: companyId }, t)
      : await this.one('SELECT id, name, address, city, state FROM warehouses WHERE company_id = :c AND is_active = 1 ORDER BY is_default DESC, id LIMIT 1', { c: companyId }, t);
    if (!w) return null;
    const code = getStateCodeFromName(w.state);
    return {
      id: Number(w.id),
      name: String(w.name),
      address: w.address || null,
      city: w.city || null,
      state: code ? GST_STATE_CODES[code] : w.state || null,
      state_code: code,
    };
  }
}
