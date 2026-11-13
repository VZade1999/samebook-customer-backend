import { Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  InboundLead,
  OPEN_STAGES,
  SOURCE_LABEL,
  SourceSettings,
  fillBlanks,
  inboundError,
  leadKey,
  pickAssignee,
} from './crm.rules';
import { userName } from './crm.shared';

export interface IngestItem {
  lead: InboundLead;
  /** Original payload (JSON text) kept for the "original data" view. */
  raw?: string | null;
}

export interface IngestIntegration {
  id: number;
  type: string;
  name: string;
  settings: SourceSettings;
  rr_cursor: number;
}

export interface IngestOptions {
  companyId: number;
  /** The integration that delivered the leads, if any. */
  integration?: IngestIntegration | null;
  /** The person importing (CSV); null when an integration delivers. */
  actorId?: number | null;
  /** Forced owner for new leads; undefined = the integration's rule (or the pool). */
  ownerId?: number | null;
  rating?: string | null;
  /** Integrations attach repeat enquiries to the open lead; CSV import skips them. */
  duplicates: 'merge' | 'skip';
  /** Shown on the "created" timeline entry, e.g. "IndiaMART" or "CSV import". */
  createdLabel: string;
}

export type IngestStatus = 'created' | 'merged' | 'skipped' | 'exists' | 'invalid';

export interface IngestOutcome {
  index: number;
  status: IngestStatus;
  lead_id?: number;
  key?: string;
  reason?: string;
}

interface Touched {
  leadId: number;
  number: number;
  name: string;
  requirement: string | null;
  source: string;
  ownerId: number | null;
  kind: 'created' | 'merged';
}

export interface CrmUser {
  id: number;
  name: string;
  email: string;
  manager: boolean;
}

/**
 * The single way leads enter the CRM from outside a person's hands: IndiaMART
 * pull + push, website / generic webhooks and CSV import. Batched so a pull of
 * hundreds of enquiries is a handful of queries, not thousands.
 */
@Injectable()
export class CrmIngestService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly notifications: NotificationsService,
  ) {}

  private get db() {
    return this.dbProvider.db;
  }
  private get seq() {
    return this.dbProvider.sequelize;
  }

  /** Active users of the company whose roles give CRM access. */
  async crmUsers(companyId: number): Promise<CrmUser[]> {
    const rows: any[] = await this.seq.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, MAX(p.name = 'crm.manage') AS manager
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.company_id = :companyId AND u.is_active = 1
          AND p.name IN ('crm.view', 'crm.manage')
        GROUP BY u.id, u.first_name, u.last_name, u.email
        ORDER BY u.first_name, u.last_name`,
      { replacements: { companyId }, type: QueryTypes.SELECT },
    );
    return rows.map((u) => ({ id: Number(u.id), name: userName(u), email: u.email, manager: !!Number(u.manager) }));
  }

  async ingestBatch(items: IngestItem[], o: IngestOptions): Promise<IngestOutcome[]> {
    const out: IngestOutcome[] = items.map((_, index) => ({ index, status: 'invalid' }));
    const valid: number[] = [];
    items.forEach((it, i) => {
      const err = it?.lead ? inboundError(it.lead) : 'Empty lead';
      if (err) out[i] = { index: i, status: 'invalid', reason: err };
      else valid.push(i);
    });
    if (!valid.length) return out;

    for (let attempt = 0; ; attempt++) {
      try {
        const touched = await this.runBatch(items, valid, o, out);
        await this.afterBatch(touched, o);
        return out;
      } catch (err) {
        // Two deliveries of the same enquiry, or two batches numbering leads
        // at the same moment: start over — the second pass sees the winner.
        const retry = err instanceof UniqueConstraintError || /deadlock/i.test(String((err as any)?.message));
        if (retry && attempt < 3) {
          valid.forEach((i) => (out[i] = { index: i, status: 'invalid' }));
          continue;
        }
        throw err;
      }
    }
  }

  private async runBatch(items: IngestItem[], valid: number[], o: IngestOptions, out: IngestOutcome[]): Promise<Touched[]> {
    const companyId = o.companyId;

    // 1. External ids already delivered (re-sent webhook, overlapping pulls).
    const refKey = (l: InboundLead) => (l.source_ref ? `${l.source}|${l.source_ref}` : null);
    const refs = [...new Set(valid.map((i) => items[i].lead.source_ref).filter(Boolean))] as string[];
    const seen = new Map<string, any>();
    if (refs.length) {
      const rows: any[] = await this.db.crm_enquiries.findAll({
        where: { company_id: companyId, source_ref: { [Op.in]: refs } },
        attributes: ['source', 'source_ref', 'lead_id'],
      });
      rows.forEach((r) => seen.set(`${r.source}|${r.source_ref}`, Number(r.lead_id)));
    }
    const batchRefs = new Set<string>();
    const todo: number[] = [];
    for (const i of valid) {
      const k = refKey(items[i].lead);
      if (k && (seen.has(k) || batchRefs.has(k))) {
        out[i] = { index: i, status: 'exists', lead_id: seen.get(k), reason: 'Already received' };
        continue;
      }
      if (k) batchRefs.add(k);
      todo.push(i);
    }
    if (!todo.length) return [];

    // 2. Same person already has an open lead → it's a repeat enquiry.
    const phones = [...new Set(todo.flatMap((i) => [items[i].lead.phone, items[i].lead.alt_phone]).filter(Boolean))];
    const emails = [...new Set(todo.map((i) => items[i].lead.email).filter(Boolean))];
    const or: any[] = [];
    if (phones.length) or.push({ phone: { [Op.in]: phones } }, { alt_phone: { [Op.in]: phones } });
    if (emails.length) or.push({ email: { [Op.in]: emails } });
    const open: any[] = or.length
      ? await this.db.crm_leads.findAll({
          where: { company_id: companyId, is_deleted: 0, stage: { [Op.in]: OPEN_STAGES }, [Op.or]: or },
          attributes: ['id', 'lead_number', 'phone', 'alt_phone', 'email'],
          order: [['id', 'DESC']],
        })
      : [];

    type Target = { leadId?: number; pending?: number };
    const byContact = new Map<string, Target>();
    const register = (c: { phone?: string | null; alt_phone?: string | null; email?: string | null }, t: Target) => {
      [c.phone, c.alt_phone].forEach((p) => p && !byContact.has(`p:${p}`) && byContact.set(`p:${p}`, t));
      if (c.email && !byContact.has(`e:${c.email}`)) byContact.set(`e:${c.email}`, t);
    };
    open.forEach((l) => register(l, { leadId: Number(l.id) }));

    const fresh: number[] = [];
    const merges: { i: number; t: Target }[] = [];
    for (const i of todo) {
      const l = items[i].lead;
      const hit =
        [l.phone, l.alt_phone].filter(Boolean).map((p) => byContact.get(`p:${p}`)).find(Boolean) ??
        (l.email ? byContact.get(`e:${l.email}`) : undefined);
      if (hit) {
        if (o.duplicates === 'skip') {
          out[i] = {
            index: i,
            status: 'skipped',
            lead_id: hit.leadId,
            reason: hit.leadId
              ? 'A lead with this phone or email already exists'
              : 'Same phone or email as an earlier row in this file',
          };
        } else merges.push({ i, t: hit });
        continue;
      }
      fresh.push(i);
      register(l, { pending: i });
    }

    // 3. Owners for the new leads.
    const owners = new Map<number, number | null>();
    let cursor = o.integration?.rr_cursor ?? 0;
    if (fresh.length) {
      const rule = o.ownerId === undefined && o.integration && o.integration.settings.assign_mode !== 'POOL';
      const eligible = rule ? (await this.crmUsers(companyId)).map((u) => u.id) : [];
      for (const i of fresh) {
        if (o.ownerId !== undefined) owners.set(i, o.ownerId);
        else if (rule) {
          const p = pickAssignee(o.integration!.settings, eligible, cursor);
          cursor = p.cursor;
          owners.set(i, p.ownerId);
        } else owners.set(i, null);
      }
    }

    const now = new Date();
    const touched: Touched[] = [];

    // 4. New leads: numbered and written in one transaction.
    if (fresh.length) {
      const created = await this.createLeads(fresh, items, owners, o, now);
      created.forEach((c) => {
        out[c.i] = { index: c.i, status: 'created', lead_id: c.leadId, key: leadKey(c.number) };
        touched.push(c);
      });
    }

    // 5. Repeat enquiries (rare) one by one.
    for (const m of merges) {
      const leadId = m.t.leadId ?? out[m.t.pending!]?.lead_id;
      if (!leadId) continue;
      const t = await this.mergeEnquiry(leadId, items[m.i], o, now);
      if (t) {
        out[m.i] = { index: m.i, status: 'merged', lead_id: t.leadId, key: leadKey(t.number) };
        touched.push(t);
      } else out[m.i] = { index: m.i, status: 'exists', reason: 'Already received' };
    }

    if (o.integration && touched.length) {
      await this.db.crm_lead_sources.update(
        {
          leads_total: this.seq.literal(`leads_total + ${touched.filter((t) => t.kind === 'created').length}`),
          last_lead_at: now,
          rr_cursor: cursor,
        },
        { where: { id: o.integration.id } },
      );
    }
    return touched;
  }

  private async createLeads(
    fresh: number[],
    items: IngestItem[],
    owners: Map<number, number | null>,
    o: IngestOptions,
    now: Date,
  ): Promise<(Touched & { i: number })[]> {
    const companyId = o.companyId;
    const tx = await this.seq.transaction();
    try {
      const [row]: any[] = await this.seq.query(
        'SELECT COALESCE(MAX(lead_number), 0) AS max FROM crm_leads WHERE company_id = :companyId',
        { replacements: { companyId }, type: QueryTypes.SELECT, transaction: tx },
      );
      let n = Number(row?.max || 0);
      const rating = o.rating ?? o.integration?.settings.default_rating ?? null;
      const rows = fresh.map((i) => {
        const l = items[i].lead;
        return {
          company_id: companyId,
          lead_number: ++n,
          name: l.name,
          company_name: l.company_name,
          phone: l.phone,
          alt_phone: l.alt_phone,
          email: l.email,
          gst_number: l.gst_number,
          address: l.address,
          city: l.city,
          state: l.state,
          pincode: l.pincode,
          country: l.country,
          requirement: l.requirement,
          message: l.message,
          estimated_value: l.estimated_value,
          source: l.source,
          source_id: o.integration?.id ?? null,
          source_detail: l.source_detail,
          stage: 'NEW',
          rating,
          owner_id: owners.get(i) ?? null,
          received_at: l.received_at ?? now,
          created_by: o.actorId ?? null,
          enquiry_count: 1,
          created_at: now,
          updated_at: now,
        };
      });
      await this.db.crm_leads.bulkCreate(rows, { transaction: tx });
      const ids: any[] = await this.db.crm_leads.findAll({
        where: { company_id: companyId, lead_number: { [Op.in]: rows.map((r) => r.lead_number) } },
        attributes: ['id', 'lead_number'],
        transaction: tx,
      });
      const idOf = new Map(ids.map((x) => [Number(x.lead_number), Number(x.id)]));

      // Integration leads keep their enquiry (external id + original payload).
      const enquiries = fresh
        .map((i, k) => {
          const l = items[i].lead;
          if (!o.integration && !l.source_ref) return null;
          return {
            company_id: companyId,
            lead_id: idOf.get(rows[k].lead_number),
            source: l.source,
            source_id: o.integration?.id ?? null,
            source_ref: l.source_ref,
            source_detail: l.source_detail,
            subject: l.requirement,
            message: l.message,
            received_at: l.received_at ?? now,
            raw: items[i].raw ?? null,
            created_at: now,
          };
        })
        .filter(Boolean);
      if (enquiries.length) await this.db.crm_enquiries.bulkCreate(enquiries, { transaction: tx });

      await this.db.crm_activities.bulkCreate(
        rows.map((r) => ({
          company_id: companyId,
          lead_id: idOf.get(r.lead_number),
          user_id: o.actorId ?? null,
          type: 'CREATED',
          body: o.createdLabel,
          meta: JSON.stringify({ source: r.source, detail: r.source_detail, owner_id: r.owner_id }),
          created_at: now,
        })),
        { transaction: tx },
      );
      await tx.commit();
      return rows.map((r, k) => ({
        i: fresh[k],
        leadId: idOf.get(r.lead_number)!,
        number: r.lead_number,
        name: r.name,
        requirement: r.requirement,
        source: r.source,
        ownerId: r.owner_id,
        kind: 'created' as const,
      }));
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  /** Attaches a repeat enquiry to an open lead; fills in details it lacked. */
  private async mergeEnquiry(leadId: number, item: IngestItem, o: IngestOptions, now: Date): Promise<Touched | null> {
    const l = item.lead;
    const tx = await this.seq.transaction();
    try {
      const lead: any = await this.db.crm_leads.findOne({
        where: { id: leadId, company_id: o.companyId, is_deleted: 0 },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!lead) {
        await tx.rollback();
        return null;
      }
      if (o.integration || l.source_ref) {
        await this.db.crm_enquiries.create(
          {
            company_id: o.companyId,
            lead_id: leadId,
            source: l.source,
            source_id: o.integration?.id ?? null,
            source_ref: l.source_ref,
            source_detail: l.source_detail,
            subject: l.requirement,
            message: l.message,
            received_at: l.received_at ?? now,
            raw: item.raw ?? null,
            created_at: now,
          },
          { transaction: tx },
        );
      }
      await lead.update(
        { ...fillBlanks(lead.get(), l), enquiry_count: Number(lead.enquiry_count || 1) + 1, updated_at: now },
        { transaction: tx },
      );
      await this.db.crm_activities.create(
        {
          company_id: o.companyId,
          lead_id: leadId,
          user_id: o.actorId ?? null,
          type: 'ENQUIRY',
          body: [l.requirement, l.message].filter(Boolean).join('\n\n').slice(0, 5000) || null,
          meta: JSON.stringify({ source: l.source, detail: l.source_detail, via: o.createdLabel }),
          created_at: now,
        },
        { transaction: tx },
      );
      await tx.commit();
      return {
        leadId,
        number: Number(lead.lead_number),
        name: lead.name,
        requirement: l.requirement ?? lead.requirement ?? null,
        source: l.source,
        ownerId: lead.owner_id != null ? Number(lead.owner_id) : null,
        kind: 'merged',
      };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  /**
   * Owners hear about their new leads; unassigned leads from integrations go
   * to managers. More than 3 for one person in a batch → one summary.
   */
  private async afterBatch(touched: Touched[], o: IngestOptions) {
    if (!touched.length) return;
    try {
      const fromIntegration = !!o.integration;
      let managers: number[] | null = null;
      const recipientsOf = async (t: Touched) => {
        if (t.ownerId) return [t.ownerId];
        if (!fromIntegration) return [];
        managers ??= (await this.crmUsers(o.companyId)).filter((u) => u.manager).map((u) => u.id);
        return managers;
      };
      const perUser = new Map<number, Touched[]>();
      for (const t of touched) {
        for (const u of await recipientsOf(t)) {
          const list = perUser.get(u) || [];
          list.push(t);
          perUser.set(u, list);
        }
      }
      const via = o.integration ? (o.integration.type === 'INDIAMART' ? 'IndiaMART' : o.integration.name) : o.createdLabel;
      for (const [userId, list] of perUser) {
        if (list.length > 3) {
          await this.notifications.notify({
            companyId: o.companyId,
            userIds: [userId],
            module: 'crm',
            type: 'CRM_NEW_LEADS',
            title: `${list.length} new enquiries from ${via}`,
            body: list.slice(0, 5).map((t) => t.name).join(', '),
            link: '/app/crm/leads',
            actorId: o.actorId ?? null,
          });
          continue;
        }
        for (const t of list) {
          const what = t.requirement ? ` · ${t.requirement}` : '';
          await this.notifications.notify({
            companyId: o.companyId,
            userIds: [userId],
            module: 'crm',
            type: t.kind === 'created' ? 'CRM_NEW_LEAD' : 'CRM_REPEAT_ENQUIRY',
            title:
              t.kind === 'created'
                ? `New lead ${leadKey(t.number)} · ${t.name}${t.ownerId ? '' : ' (unassigned)'}`
                : `${t.name} enquired again (${leadKey(t.number)})`,
            body: `${SOURCE_LABEL[t.source as keyof typeof SOURCE_LABEL] ?? t.source}${what}`.slice(0, 500),
            link: `/app/crm/leads?lead=${t.leadId}`,
            entityType: 'crm_lead',
            entityId: t.leadId,
            actorId: o.actorId ?? null,
          });
        }
      }
    } catch (err) {
      this.appLogger
        .forContext('CrmIngestService', 'afterBatch', { companyId: o.companyId })
        .error('Could not send lead notifications', err);
    }
  }
}
