import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { Op } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { CompanyModulesService } from '../../company-modules/company-modules.service';
import { CrmIngestService, IngestIntegration, IngestItem } from './crm-ingest.service';
import { CreateSourceDto, SourceSettingsDto, UpdateSourceDto } from './dto/crm.dto';
import {
  INDIAMART_MIN_GAP_MS,
  SourceSettings,
  formatIndiaMartTime,
  indiaMartPushItems,
  indiaMartWindow,
  interpretIndiaMart,
  isHoneypotHit,
  mapIndiaMart,
  mapWebhook,
  parseSettings,
  rawCopy,
} from './crm.rules';
import { maskSecret, newIntakeToken, openSecrets, sealSecrets, tokenHash } from './crm.secrets';
import { CrmRequester, USER_ATTRS, fail, ok, userRef } from './crm.shared';

export const INDIAMART_PULL_URL = 'https://mapi.indiamart.com/wservce/crm/crmListing/v2/';

/** Opening the CRM pulls IndiaMART again only if the last pull is older than this. */
const AUTO_SYNC_AFTER_MS = 10 * 60_000;
/** Safety valve against a flood (or a leaked URL) — per source, per hour. */
const MAX_INTAKE_PER_HOUR = 600;
const LOCK_MS = 90_000;

export interface SyncReport {
  source_id: number;
  status: 'OK' | 'NO_DATA' | 'ERROR' | 'RATE_LIMITED' | 'SKIPPED';
  message: string;
  created: number;
  merged: number;
  /** When the next pull is allowed (IndiaMART: one every 5 minutes). */
  next_allowed_at?: string | null;
}

@Injectable()
export class CrmSourcesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly ingest: CrmIngestService,
    private readonly modules: CompanyModulesService,
  ) {}

  private get db() {
    return this.dbProvider.db;
  }
  private get Sources() {
    return this.db.crm_lead_sources;
  }

  private serialize(s: any) {
    const secrets = openSecrets(s.secret_enc);
    const lastSync = s.last_sync_at ? new Date(s.last_sync_at) : null;
    return {
      id: Number(s.id),
      type: s.type,
      name: s.name,
      is_active: !!Number(s.is_active),
      settings: parseSettings(s.settings, s.type),
      intake_token: secrets?.token ?? null,
      has_api_key: !!secrets?.api_key,
      api_key_hint: maskSecret(secrets?.api_key),
      needs_reconnect: !!s.secret_enc && !secrets,
      sync:
        s.type === 'INDIAMART'
          ? {
              last_at: s.last_sync_at ?? null,
              status: s.last_sync_status ?? null,
              message: s.last_sync_message ?? null,
              cursor: s.sync_cursor ?? null,
              next_allowed_at: lastSync ? new Date(lastSync.getTime() + INDIAMART_MIN_GAP_MS).toISOString() : null,
            }
          : null,
      last_lead_at: s.last_lead_at ?? null,
      leads_total: Number(s.leads_total || 0),
      creator: userRef(s.creator),
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  private integrationOf(s: any): IngestIntegration {
    return {
      id: Number(s.id),
      type: s.type,
      name: s.name,
      settings: parseSettings(s.settings, s.type),
      rr_cursor: Number(s.rr_cursor || 0),
    };
  }

  /** Validates people in the assignment rule; returns the stored settings JSON. */
  private async settingsFor(companyId: number, type: string, input?: SourceSettingsDto, current?: string | null) {
    const merged = { ...parseSettings(current, type), ...(input || {}) };
    const s: SourceSettings = parseSettings(merged, type);
    if (input?.redirect_url && !s.redirect_url) return { error: 'The thank-you page must be a full http(s) address' };
    if (s.assign_mode !== 'POOL') {
      if (!s.assign_user_ids.length) return { error: 'Pick who should get the new leads' };
      const people = new Set((await this.ingest.crmUsers(companyId)).map((u) => u.id));
      const bad = s.assign_user_ids.filter((id) => !people.has(id));
      if (bad.length) return { error: "Some of the people picked don't have CRM access any more" };
      if (s.assign_mode === 'USER') s.assign_user_ids = s.assign_user_ids.slice(0, 1);
    } else s.assign_user_ids = [];
    return { json: JSON.stringify(s) };
  }

  private cleanKey(k?: string | null) {
    const v = String(k ?? '').trim();
    if (!v) return null;
    return /^[A-Za-z0-9+/=_.-]{10,300}$/.test(v) ? v : 'bad';
  }

  // ─── Admin (crm.manage) ───────────────────────────────────────────────────

  async list(r: CrmRequester) {
    const rows: any[] = await this.Sources.findAll({
      where: { company_id: r.companyId },
      include: [{ model: this.db.users, as: 'creator', attributes: USER_ATTRS, required: false }],
      order: [['id', 'ASC']],
    });
    return ok('Lead sources fetched', rows.map((s) => this.serialize(s)));
  }

  private async findOwn(r: CrmRequester, id: number) {
    return this.Sources.findOne({
      where: { id, company_id: r.companyId },
      include: [{ model: this.db.users, as: 'creator', attributes: USER_ATTRS, required: false }],
    });
  }

  async create(r: CrmRequester, dto: CreateSourceDto) {
    const key = this.cleanKey(dto.api_key);
    if (key === 'bad') return fail("That doesn't look like an IndiaMART CRM key. Copy it again from IndiaMART.");
    if (dto.type !== 'INDIAMART' && key) return fail('Only IndiaMART uses a key');
    const settings = await this.settingsFor(r.companyId, dto.type, dto.settings);
    if (settings.error) return fail(settings.error);
    const token = newIntakeToken();
    const now = new Date();
    const s: any = await this.Sources.create({
      company_id: r.companyId,
      type: dto.type,
      name: dto.name.trim().slice(0, 100),
      is_active: 1,
      token_hash: tokenHash(token),
      secret_enc: sealSecrets({ token, ...(key ? { api_key: key } : {}) }),
      settings: settings.json,
      created_by: r.userId,
      updated_by: r.userId,
      created_at: now,
      updated_at: now,
    });
    this.appLogger.forContext('CrmSourcesService', 'create', { companyId: r.companyId }).info('Lead source added', { sourceId: s.id, type: s.type });
    // IndiaMART with a key: fetch the past week straight away.
    const first = dto.type === 'INDIAMART' && key ? await this.syncSource(Number(s.id), 'connect') : null;
    return ok('Lead source added', { source: this.serialize(await this.findOwn(r, Number(s.id))), sync: first });
  }

  async update(r: CrmRequester, id: number, dto: UpdateSourceDto) {
    const s: any = await this.findOwn(r, id);
    if (!s) return fail('Lead source not found', 404);
    const patch: any = { updated_by: r.userId, updated_at: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim().slice(0, 100);
    if (dto.is_active !== undefined) patch.is_active = dto.is_active ? 1 : 0;
    if (dto.settings) {
      const settings = await this.settingsFor(r.companyId, s.type, dto.settings, s.settings);
      if (settings.error) return fail(settings.error);
      patch.settings = settings.json;
    }
    let keyChanged = false;
    if (dto.api_key !== undefined) {
      if (s.type !== 'INDIAMART') return fail('Only IndiaMART uses a key');
      const key = this.cleanKey(dto.api_key);
      if (key === 'bad') return fail("That doesn't look like an IndiaMART CRM key. Copy it again from IndiaMART.");
      const secrets = openSecrets(s.secret_enc) || {};
      const token = secrets.token || newIntakeToken();
      patch.secret_enc = sealSecrets({ token, ...(key ? { api_key: key } : {}) });
      patch.token_hash = tokenHash(token);
      // A new key gets a clean slate: last week is fetched again (duplicates are ignored).
      patch.last_sync_status = null;
      patch.last_sync_message = null;
      keyChanged = !!key;
    }
    await s.update(patch);
    const sync = keyChanged && Number(s.is_active) ? await this.syncSource(id, 'connect') : null;
    return ok('Lead source updated', { source: this.serialize(await this.findOwn(r, id)), sync });
  }

  /** New secret URL; the old one stops working immediately. */
  async regenerate(r: CrmRequester, id: number) {
    const s: any = await this.findOwn(r, id);
    if (!s) return fail('Lead source not found', 404);
    const secrets = openSecrets(s.secret_enc) || {};
    const token = newIntakeToken();
    await s.update({
      token_hash: tokenHash(token),
      secret_enc: sealSecrets({ ...secrets, token }),
      updated_by: r.userId,
      updated_at: new Date(),
    });
    return ok('New link created. Update it wherever the old one was used.', this.serialize(await this.findOwn(r, id)));
  }

  /** Disconnects the source. Leads it brought in stay. */
  async remove(r: CrmRequester, id: number) {
    const s: any = await this.findOwn(r, id);
    if (!s) return fail('Lead source not found', 404);
    await s.destroy();
    return ok('Lead source removed. Leads it brought in are kept.', { id });
  }

  async syncNow(r: CrmRequester, id: number) {
    const s: any = await this.findOwn(r, id);
    if (!s) return fail('Lead source not found', 404);
    if (s.type !== 'INDIAMART') return fail('Only IndiaMART can be fetched');
    if (!Number(s.is_active)) return fail('Turn this source on first');
    const report = await this.syncSource(id, 'manual');
    if (report.status === 'SKIPPED') return fail(report.message, 429, report);
    return ok(report.message, { report, source: this.serialize(await this.findOwn(r, id)) });
  }

  /**
   * Opening the CRM: pull the company's IndiaMART sources whose last pull is
   * older than 10 minutes. Cheap when nothing is due.
   */
  async autoSync(r: CrmRequester) {
    const due: any[] = await this.Sources.findAll({
      where: {
        company_id: r.companyId,
        type: 'INDIAMART',
        is_active: 1,
        [Op.or]: [{ last_sync_at: null }, { last_sync_at: { [Op.lt]: new Date(Date.now() - AUTO_SYNC_AFTER_MS) } }],
      },
      attributes: ['id', 'secret_enc'],
      limit: 5,
    });
    const reports: SyncReport[] = [];
    for (const s of due) {
      if (!openSecrets(s.secret_enc)?.api_key) continue;
      reports.push(await this.syncSource(Number(s.id), 'auto'));
    }
    const created = reports.reduce((n, x) => n + x.created, 0);
    const merged = reports.reduce((n, x) => n + x.merged, 0);
    return ok(created || merged ? `${created} new leads` : 'Up to date', { created, merged, ran: reports.length });
  }

  /** Scheduled job (Vercel Cron): every company's due IndiaMART sources. */
  async cronSync(budgetMs = 45_000) {
    const started = Date.now();
    const due: any[] = await this.Sources.findAll({
      where: {
        type: 'INDIAMART',
        is_active: 1,
        [Op.or]: [{ last_sync_at: null }, { last_sync_at: { [Op.lt]: new Date(Date.now() - AUTO_SYNC_AFTER_MS) } }],
      },
      attributes: ['id', 'company_id', 'secret_enc'],
      order: [[this.dbProvider.sequelize.literal('last_sync_at IS NULL'), 'DESC'], ['last_sync_at', 'ASC']],
      limit: 25,
    });
    const reports: SyncReport[] = [];
    for (const s of due) {
      if (Date.now() - started > budgetMs) break;
      if (!openSecrets(s.secret_enc)?.api_key) continue;
      if (!(await this.modules.isEnabled(Number(s.company_id), 'crm'))) continue;
      reports.push(await this.syncSource(Number(s.id), 'cron'));
    }
    return { ran: reports.length, due: due.length, created: reports.reduce((n, x) => n + x.created, 0), reports };
  }

  // ─── IndiaMART pull ───────────────────────────────────────────────────────

  async syncSource(id: number, trigger: 'manual' | 'auto' | 'cron' | 'connect'): Promise<SyncReport> {
    const log = this.appLogger.forContext('CrmSourcesService', 'syncSource', { sourceId: id, trigger });
    const now = new Date();
    // Claim the run: one at a time, and never sooner than IndiaMART allows.
    const [claimed] = await this.Sources.update(
      { sync_lock_until: new Date(now.getTime() + LOCK_MS) },
      {
        where: {
          id,
          type: 'INDIAMART',
          is_active: 1,
          [Op.and]: [
            { [Op.or]: [{ sync_lock_until: null }, { sync_lock_until: { [Op.lt]: now } }] },
            { [Op.or]: [{ last_sync_at: null }, { last_sync_at: { [Op.lte]: new Date(now.getTime() - INDIAMART_MIN_GAP_MS) } }] },
          ],
        },
      },
    );
    const s: any = await this.Sources.findByPk(id);
    if (!claimed) {
      const next = s?.last_sync_at ? new Date(new Date(s.last_sync_at).getTime() + INDIAMART_MIN_GAP_MS) : null;
      const waitMin = next ? Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000)) : null;
      return {
        source_id: id,
        status: 'SKIPPED',
        message: waitMin ? `IndiaMART allows one fetch every 5 minutes. Try again in about ${waitMin} min.` : 'A fetch is already running',
        created: 0,
        merged: 0,
        next_allowed_at: next ? next.toISOString() : null,
      };
    }

    const report: SyncReport = { source_id: id, status: 'ERROR', message: '', created: 0, merged: 0 };
    let cursor: Date | null = s.sync_cursor ? new Date(s.sync_cursor) : null;
    try {
      const key = openSecrets(s.secret_enc)?.api_key;
      if (!key) {
        report.message = openSecrets(s.secret_enc)
          ? 'Add your IndiaMART CRM key to fetch leads'
          : 'Reconnect this source: enter the IndiaMART key again';
      } else {
        const win = indiaMartWindow(cursor, now);
        const res = await axios.get(INDIAMART_PULL_URL, {
          params: { glusr_crm_key: key, start_time: formatIndiaMartTime(win.start), end_time: formatIndiaMartTime(win.end) },
          timeout: 25_000,
          validateStatus: () => true,
        });
        const outcome =
          res.status >= 500 && !(res.data && typeof res.data === 'object' && 'CODE' in res.data)
            ? ({ kind: 'ERROR', message: `IndiaMART is not responding right now (HTTP ${res.status})` } as const)
            : interpretIndiaMart(res.data);
        if (outcome.kind === 'OK' || outcome.kind === 'NO_DATA') {
          const raw = outcome.kind === 'OK' ? outcome.items : [];
          const items: IngestItem[] = raw
            .map((x: any) => ({ lead: mapIndiaMart(x), raw: rawCopy(x) }))
            .filter((x: any) => x.lead) as IngestItem[];
          items.sort((a, b) => (a.lead.received_at?.getTime() || 0) - (b.lead.received_at?.getTime() || 0));
          if (items.length) {
            const results = await this.ingest.ingestBatch(items, {
              companyId: Number(s.company_id),
              integration: this.integrationOf(s),
              duplicates: 'merge',
              createdLabel: 'IndiaMART',
            });
            report.created = results.filter((x) => x.status === 'created').length;
            report.merged = results.filter((x) => x.status === 'merged').length;
          }
          cursor = win.end;
          report.status = items.length ? 'OK' : 'NO_DATA';
          const parts = [
            report.created ? `${report.created} new lead${report.created === 1 ? '' : 's'}` : null,
            report.merged ? `${report.merged} repeat enquir${report.merged === 1 ? 'y' : 'ies'}` : null,
          ].filter(Boolean);
          report.message = parts.length ? parts.join(', ') : 'No new enquiries';
          if (win.gap) report.message += ' (only the last 7 days could be fetched — check older ones in IndiaMART)';
        } else {
          report.status = outcome.kind === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'ERROR';
          report.message = outcome.message;
        }
      }
    } catch (err: any) {
      report.status = 'ERROR';
      report.message =
        err?.code === 'ECONNABORTED' ? 'IndiaMART took too long to answer. It will be tried again.' : 'Could not reach IndiaMART. It will be tried again.';
      log.error('IndiaMART pull failed', err);
    } finally {
      const done = new Date();
      await this.Sources.update(
        {
          last_sync_at: now,
          last_sync_status: report.status,
          last_sync_message: report.message.slice(0, 300),
          sync_cursor: cursor,
          sync_lock_until: null,
          updated_at: done,
        },
        { where: { id } },
      ).catch((e: any) => log.error('Could not record the sync result', e));
    }
    report.next_allowed_at = new Date(now.getTime() + INDIAMART_MIN_GAP_MS).toISOString();
    log.info('IndiaMART pull finished', { status: report.status, created: report.created, merged: report.merged });
    return report;
  }

  // ─── Public intake (webhook URL) ──────────────────────────────────────────

  /** Status of a token for the public endpoint; never says why a token is unknown. */
  async intakeStatus(token: string) {
    const s = await this.findByToken(token);
    if (!s) return fail('This lead link is not active', 404);
    return ok('SameBook lead link is active', { name: s.name });
  }

  private async findByToken(token: string) {
    if (!token || token.length < 20 || token.length > 80 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const s: any = await this.Sources.findOne({ where: { token_hash: tokenHash(token) } });
    return s && Number(s.is_active) ? s : null;
  }

  async intake(token: string, body: any) {
    const s: any = await this.findByToken(token);
    if (!s) return fail('This lead link is not active', 404);
    if (!(await this.modules.isEnabled(Number(s.company_id), 'crm'))) return fail('CRM is switched off for this business', 403);

    const recent = await this.db.crm_enquiries.count({
      where: { source_id: s.id, created_at: { [Op.gte]: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= MAX_INTAKE_PER_HOUR) return fail('Too many leads in the last hour. Try again later.', 429);

    const settings = parseSettings(s.settings, s.type);
    // Spam bots fill hidden fields: accept quietly, store nothing.
    if (isHoneypotHit(body)) return ok('Lead received', { lead: null, status: 'ignored', redirect_url: settings.redirect_url });

    const pushed = indiaMartPushItems(body);
    const items: IngestItem[] = pushed.length
      ? (pushed.map((x) => ({ lead: mapIndiaMart(x), raw: rawCopy(x) })).filter((x) => x.lead) as IngestItem[])
      : [{ lead: mapWebhook(body, settings.lead_source), raw: rawCopy(body) }];
    if (!items.length) return fail('No lead found in the request', 422);

    const results = await this.ingest.ingestBatch(items, {
      companyId: Number(s.company_id),
      integration: this.integrationOf(s),
      duplicates: 'merge',
      createdLabel: s.type === 'INDIAMART' ? 'IndiaMART' : s.name,
    });
    const firstOk = results.find((x) => x.status !== 'invalid');
    if (!firstOk) return fail(results[0]?.reason || 'A phone number or an email address is required', 422);
    return ok('Lead received', {
      lead: firstOk.key ?? null,
      status: firstOk.status,
      received: results.filter((x) => x.status !== 'invalid').length,
      redirect_url: settings.redirect_url,
    });
  }
}
