import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { registerDocumentSeriesModel } from './document-series.model';
import {
  DOC_TYPES,
  DOC_TYPE_LABEL,
  DocType,
  ResetPeriod,
  datePartsIn,
  effectiveNext,
  periodKey,
  renderNumber,
  standardExample,
  validateSeries,
} from './document-series.rules';

export interface SeriesRequester {
  userId: number;
  companyId: number;
}

type Result<T = any> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; status: number; data?: any };

export interface CreateSeriesInput {
  doc_type: DocType;
  name: string;
  format: string;
  padding?: number;
  reset_period?: ResetPeriod;
  next_number?: number;
  is_default?: boolean;
}
export type UpdateSeriesInput = Partial<Omit<CreateSeriesInput, 'doc_type'>> & { is_active?: boolean };

/** Where each document type keeps its number, for the "already used" check. */
const DOC_TABLE: Record<DocType, { table: string; column: string }> = {
  INVOICE: { table: 'invoices', column: 'invoice_number' },
  QUOTATION: { table: 'quotations', column: 'quotation_number' },
  DELIVERY_CHALLAN: { table: 'delivery_challans', column: 'challan_number' },
};

/** Numbers already taken are skipped; this bounds the search. */
const MAX_SKIP = 1000;

export interface IssuedNumber {
  number: string;
  seriesId: number;
  seq: number;
}

@Injectable()
export class DocumentSeriesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {
    registerDocumentSeriesModel(dbProvider.sequelize, dbProvider.db);
  }

  private get Series() {
    return this.dbProvider.db.document_series;
  }

  private async companyPrefix(companyId: number, transaction?: Transaction): Promise<string> {
    const c: any = await this.dbProvider.db.companies.findByPk(companyId, {
      attributes: ['company_prefix', 'name'],
      transaction,
    });
    return c?.company_prefix?.trim().toUpperCase() || c?.name?.trim().substring(0, 4).toUpperCase() || 'COMP';
  }

  private async isTaken(docType: DocType, companyId: number, number: string, transaction?: Transaction) {
    const { table, column } = DOC_TABLE[docType];
    const rows: any[] = await this.dbProvider.sequelize.query(
      `SELECT 1 FROM \`${table}\` WHERE company_id = :companyId AND \`${column}\` = :number LIMIT 1`,
      { replacements: { companyId, number }, type: QueryTypes.SELECT, transaction },
    );
    return rows.length > 0;
  }

  private serialize(row: any, prefix: string, now: Date) {
    const r = row.get ? row.get({ plain: true }) : row;
    const parts = datePartsIn(now);
    const seq = effectiveNext(r, parts);
    return {
      id: Number(r.id),
      doc_type: r.doc_type as DocType,
      name: r.name,
      format: r.format,
      padding: Number(r.padding),
      reset_period: r.reset_period as ResetPeriod,
      next_number: seq,
      next_preview: renderNumber({ format: r.format, padding: Number(r.padding), seq, prefix, parts }),
      // The stored counter is for an earlier year/month/day: it restarts at 1.
      restarts: !!r.current_period && r.current_period !== periodKey(r.reset_period, parts),
      is_default: Number(r.is_default) === 1,
      is_active: Number(r.is_active) === 1,
      issued_count: Number(r.issued_count) || 0,
      last_issued_number: r.last_issued_number ?? null,
      last_issued_at: r.last_issued_at ?? null,
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
    };
  }

  /** Every series of the company plus an example of the standard format per type. */
  async list(req: SeriesRequester): Promise<Result> {
    const now = new Date();
    const [rows, prefix] = await Promise.all([
      this.Series.findAll({
        where: { company_id: req.companyId },
        order: [
          ['doc_type', 'ASC'],
          ['is_active', 'DESC'],
          ['is_default', 'DESC'],
          ['id', 'ASC'],
        ],
      }),
      this.companyPrefix(req.companyId),
    ]);
    const standard = Object.fromEntries(DOC_TYPES.map((t) => [t, standardExample(t, prefix, now)]));
    return {
      success: true,
      message: 'Numbering series',
      data: { series: rows.map((r: any) => this.serialize(r, prefix, now)), standard, prefix },
    };
  }

  /**
   * Validates a series without saving it: errors, GST warnings, the preview
   * and whether that number is already used by an existing document.
   */
  async check(req: SeriesRequester, input: CreateSeriesInput, excludeId?: number) {
    const prefix = await this.companyPrefix(req.companyId);
    const v = validateSeries(
      {
        doc_type: input.doc_type,
        name: input.name,
        format: input.format,
        padding: Number(input.padding ?? 4),
        reset_period: (input.reset_period ?? 'YEARLY') as ResetPeriod,
        next_number: Number(input.next_number ?? 1),
      },
      { prefix, now: new Date() },
    );
    if (!v.errors.length && input.name) {
      const clash = await this.Series.findOne({
        where: {
          company_id: req.companyId,
          doc_type: input.doc_type,
          name: String(input.name).trim(),
          ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
        },
        attributes: ['id'],
      });
      if (clash) v.errors.push(`There is already a ${DOC_TYPE_LABEL[input.doc_type].toLowerCase()} series called "${String(input.name).trim()}"`);
    }
    if (!v.errors.length && v.preview && (await this.isTaken(input.doc_type, req.companyId, v.preview))) {
      v.warnings.push(`${v.preview} is already used — numbers that exist are skipped, so the next one will be higher`);
    }
    return v;
  }

  async preview(req: SeriesRequester, input: CreateSeriesInput, excludeId?: number): Promise<Result> {
    return { success: true, message: 'Preview', data: await this.check(req, input, excludeId) };
  }

  async create(req: SeriesRequester, input: CreateSeriesInput): Promise<Result> {
    const v = await this.check(req, input);
    if (v.errors.length) return { success: false, status: 400, message: v.errors[0], data: v };

    const reset = (input.reset_period ?? 'YEARLY') as ResetPeriod;
    const t: Transaction = await this.dbProvider.sequelize.transaction();
    try {
      const active: any[] = await this.Series.findAll({
        where: { company_id: req.companyId, doc_type: input.doc_type, is_active: 1 },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      // The first active series becomes the default; asking for it moves it.
      const makeDefault = !active.length || !!input.is_default;
      if (makeDefault && active.length) {
        await this.Series.update(
          { is_default: 0, updated_by: req.userId },
          { where: { company_id: req.companyId, doc_type: input.doc_type }, transaction: t },
        );
      }
      const row = await this.Series.create(
        {
          company_id: req.companyId,
          doc_type: input.doc_type,
          name: String(input.name).trim(),
          format: String(input.format).trim(),
          padding: Number(input.padding ?? 4),
          reset_period: reset,
          next_number: Number(input.next_number ?? 1),
          current_period: periodKey(reset, datePartsIn(new Date())),
          is_default: makeDefault ? 1 : 0,
          is_active: 1,
          created_by: req.userId,
          updated_by: req.userId,
        },
        { transaction: t },
      );
      await t.commit();
      this.log('create', req).info('Series created', { seriesId: row.id, docType: input.doc_type });
      const prefix = await this.companyPrefix(req.companyId);
      return {
        success: true,
        message: `${DOC_TYPE_LABEL[input.doc_type]} series created`,
        data: { series: this.serialize(row, prefix, new Date()), warnings: v.warnings },
      };
    } catch (err) {
      await t.rollback();
      this.log('create', req).error('Failed to create series', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async update(req: SeriesRequester, id: number, input: UpdateSeriesInput): Promise<Result> {
    const row: any = await this.Series.findOne({ where: { id, company_id: req.companyId } });
    if (!row) return { success: false, status: 404, message: 'Series not found' };

    const now = new Date();
    const merged: CreateSeriesInput = {
      doc_type: row.doc_type,
      name: input.name ?? row.name,
      format: input.format ?? row.format,
      padding: input.padding ?? Number(row.padding),
      reset_period: (input.reset_period ?? row.reset_period) as ResetPeriod,
      // Untouched counters are checked as they stand today.
      next_number: input.next_number ?? effectiveNext(row, datePartsIn(now)),
    };
    const v = await this.check(req, merged, id);
    if (v.errors.length) return { success: false, status: 400, message: v.errors[0], data: v };

    const patch: Record<string, any> = { updated_by: req.userId };
    if (input.name !== undefined) patch.name = String(input.name).trim();
    if (input.format !== undefined) patch.format = String(input.format).trim();
    if (input.padding !== undefined) patch.padding = Number(input.padding);
    if (input.reset_period !== undefined) patch.reset_period = input.reset_period;
    // Setting the next number (or the restart rule) anchors the counter to
    // today's period, so it isn't immediately reset.
    if (input.next_number !== undefined || input.reset_period !== undefined) {
      patch.next_number = merged.next_number;
      patch.current_period = periodKey(merged.reset_period as ResetPeriod, datePartsIn(now));
    }

    const t: Transaction = await this.dbProvider.sequelize.transaction();
    try {
      await this.Series.findOne({ where: { id }, transaction: t, lock: t.LOCK.UPDATE });
      if (input.is_active === false && Number(row.is_active) === 1) {
        patch.is_active = 0;
        patch.is_default = 0;
      } else if (input.is_active === true && Number(row.is_active) !== 1) {
        patch.is_active = 1;
      }
      await this.Series.update(patch, { where: { id }, transaction: t });
      if (input.is_default === true) await this.makeDefault(req, row.doc_type, id, t);
      await this.ensureDefault(req.companyId, row.doc_type, t);
      await t.commit();
    } catch (err) {
      await t.rollback();
      this.log('update', req).error('Failed to update series', err);
      throw new Error('DATABASE_ERROR');
    }
    this.log('update', req).info('Series updated', { seriesId: id, fields: Object.keys(patch) });
    const fresh = await this.Series.findByPk(id);
    const prefix = await this.companyPrefix(req.companyId);
    return {
      success: true,
      message: 'Series saved',
      data: { series: this.serialize(fresh, prefix, new Date()), warnings: v.warnings },
    };
  }

  private async makeDefault(req: SeriesRequester, docType: DocType, id: number, t: Transaction) {
    await this.Series.update(
      { is_default: 0 },
      { where: { company_id: req.companyId, doc_type: docType, id: { [Op.ne]: id } }, transaction: t },
    );
    await this.Series.update({ is_default: 1, is_active: 1 }, { where: { id }, transaction: t });
  }

  /** Keeps exactly one default among the active series of a type (none if none are active). */
  private async ensureDefault(companyId: number, docType: DocType, t: Transaction) {
    const active: any[] = await this.Series.findAll({
      where: { company_id: companyId, doc_type: docType, is_active: 1 },
      order: [['id', 'ASC']],
      transaction: t,
    });
    const defaults = active.filter((s) => Number(s.is_default) === 1);
    if (active.length && defaults.length !== 1) {
      const keep = defaults[0] ?? active[0];
      await this.Series.update(
        { is_default: 0 },
        { where: { company_id: companyId, doc_type: docType, id: { [Op.ne]: keep.id } }, transaction: t },
      );
      await this.Series.update({ is_default: 1 }, { where: { id: keep.id }, transaction: t });
    }
  }

  /** Only a series that never issued a number can be deleted; others are archived. */
  async remove(req: SeriesRequester, id: number): Promise<Result> {
    const row: any = await this.Series.findOne({ where: { id, company_id: req.companyId } });
    if (!row) return { success: false, status: 404, message: 'Series not found' };
    if (Number(row.issued_count) > 0) {
      return {
        success: false,
        status: 409,
        message: 'This series has already numbered documents — archive it instead so its history stays',
      };
    }
    const t: Transaction = await this.dbProvider.sequelize.transaction();
    try {
      await this.Series.destroy({ where: { id }, transaction: t });
      await this.ensureDefault(req.companyId, row.doc_type, t);
      await t.commit();
    } catch (err) {
      await t.rollback();
      this.log('remove', req).error('Failed to delete series', err);
      throw new Error('DATABASE_ERROR');
    }
    this.log('remove', req).info('Series deleted', { seriesId: id });
    return { success: true, message: 'Series deleted', data: { id } };
  }

  /**
   * Takes the next number for a new document, inside the caller's transaction.
   * The series row is locked until that transaction ends, so two documents
   * created at the same moment never get the same number; numbers that already
   * exist (e.g. typed into an old system) are skipped.
   *
   * Returns null when the company has no active series for the type — the
   * caller then uses the standard format.
   */
  async issue(
    companyId: number,
    docType: DocType,
    transaction: Transaction,
    seriesId?: number | null,
  ): Promise<IssuedNumber | null> {
    const where: any = { company_id: companyId, doc_type: docType, is_active: 1 };
    if (seriesId) where.id = seriesId;
    else where.is_default = 1;

    let row: any = await this.Series.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
    if (!row && !seriesId) {
      // No default flagged (shouldn't happen) — fall back to the oldest active one.
      row = await this.Series.findOne({
        where: { company_id: companyId, doc_type: docType, is_active: 1 },
        order: [['id', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
    }
    if (!row) {
      if (seriesId) throw new BadRequestException('That numbering series is not available — pick another one');
      return null;
    }

    const now = new Date();
    const parts = datePartsIn(now);
    const prefix = await this.companyPrefix(companyId, transaction);
    let seq = effectiveNext(row, parts);
    let number = '';
    for (let i = 0; ; i++) {
      number = renderNumber({ format: row.format, padding: Number(row.padding), seq, prefix, parts });
      if (!(await this.isTaken(docType, companyId, number, transaction))) break;
      if (i >= MAX_SKIP) {
        throw new BadRequestException(
          `Numbers in the "${row.name}" series are already used up to ${number} — set a higher next number in Company → Document numbering`,
        );
      }
      seq += 1;
    }

    await this.Series.update(
      {
        next_number: seq + 1,
        current_period: periodKey(row.reset_period, parts),
        issued_count: Number(row.issued_count || 0) + 1,
        last_issued_number: number,
        last_issued_at: now,
      },
      { where: { id: row.id }, transaction },
    );
    return { number, seriesId: Number(row.id), seq };
  }

  private log(method: string, req: SeriesRequester) {
    return this.appLogger.forContext('DocumentSeriesService', method, { companyId: req.companyId, userId: req.userId });
  }
}
