import { Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, UniqueConstraintError, col, fn, literal } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CrmIngestService } from './crm-ingest.service';
import {
  AssignDto,
  ConvertLeadDto,
  CreateLeadDto,
  FollowUpDto,
  ImportLeadsDto,
  LogActivityDto,
  StageDto,
  UpdateLeadDto,
} from './dto/crm.dto';
import {
  LOG_TYPES,
  MAX_RANGE_DAYS,
  OPEN_STAGES,
  RATINGS,
  RESPONSE_TYPES,
  STAGES,
  STAGE_LABEL,
  Source,
  Stage,
  addDays,
  canSeeLead,
  clean,
  cleanText,
  daysInclusive,
  furthestRank,
  isIsoDate,
  isOpenStage,
  isSource,
  leadCapabilities,
  leadKey,
  localDate,
  localDayBounds,
  localMidnightUtc,
  mapImportRow,
  median,
  normalizeEmail,
  normalizeGstin,
  normalizePhone,
  normalizePincode,
  parseLeadKey,
  parseTz,
  phoneMatchKey,
  reachedPerson,
  shouldAutoClaim,
  stageAfterQuotation,
} from './crm.rules';
import {
  CrmRequester,
  Result,
  USER_ATTRS,
  actorOf,
  canCreateLeads,
  fail,
  ok,
  serializeLead,
  userName,
  userRef,
} from './crm.shared';

const MAX_FOLLOW_UP_AHEAD_MS = 3 * 366 * 86_400_000;
const csv = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const n0 = (v: any) => Number(v || 0);

/** Contact fields typed by a person: normalised, with a readable error for bad input. */
const readContact = (dto: Record<string, any>) => {
  const patch: Record<string, any> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(dto, k) && dto[k] !== undefined;
  const blank = (k: string) => dto[k] === null || String(dto[k]).trim() === '';
  if (has('phone')) {
    patch.phone = blank('phone') ? null : normalizePhone(dto.phone);
    if (!blank('phone') && !patch.phone) return { error: "That phone number doesn't look right" };
  }
  if (has('alt_phone')) {
    patch.alt_phone = blank('alt_phone') ? null : normalizePhone(dto.alt_phone);
    if (!blank('alt_phone') && !patch.alt_phone) return { error: "The other phone number doesn't look right" };
  }
  if (has('email')) {
    patch.email = blank('email') ? null : normalizeEmail(dto.email);
    if (!blank('email') && !patch.email) return { error: "That email address doesn't look right" };
  }
  if (has('gst_number')) {
    patch.gst_number = blank('gst_number') ? null : normalizeGstin(dto.gst_number);
    if (!blank('gst_number') && !patch.gst_number) return { error: 'GSTIN should be 15 characters, like 27ABCDE1234F1Z5' };
  }
  if (has('pincode')) {
    patch.pincode = blank('pincode') ? null : normalizePincode(dto.pincode);
    if (!blank('pincode') && !patch.pincode) return { error: "That PIN code doesn't look right" };
  }
  const text: [string, number][] = [
    ['company_name', 200],
    ['address', 500],
    ['city', 100],
    ['state', 100],
    ['country', 60],
    ['requirement', 300],
    ['source_detail', 100],
  ];
  text.forEach(([k, max]) => has(k) && (patch[k] = clean(dto[k], max)));
  if (has('message')) patch.message = cleanText(dto.message);
  if (has('name')) patch.name = clean(dto.name, 150);
  return { patch };
};

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  company_name: 'company',
  phone: 'phone',
  alt_phone: 'other phone',
  email: 'email',
  gst_number: 'GSTIN',
  address: 'address',
  city: 'city',
  state: 'state',
  pincode: 'PIN code',
  country: 'country',
  requirement: 'requirement',
  message: 'enquiry details',
  estimated_value: 'value',
  source: 'source',
  source_detail: 'source detail',
  rating: 'rating',
};

@Injectable()
export class CrmService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly notifications: NotificationsService,
    private readonly ingest: CrmIngestService,
  ) {}

  private get db() {
    return this.dbProvider.db;
  }
  private get seq() {
    return this.dbProvider.sequelize;
  }
  private get Leads() {
    return this.db.crm_leads;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private ctx(r: CrmRequester, tz?: unknown) {
    const now = new Date();
    return { actor: actorOf(r), now, endOfToday: localDayBounds(now, parseTz(tz)).end };
  }

  /** Managers: everything. Others: own, created and unassigned leads. */
  private visibleWhere(r: CrmRequester): any {
    const base: any = { company_id: r.companyId, is_deleted: 0 };
    if (actorOf(r).isManager) return base;
    return { ...base, [Op.or]: [{ owner_id: null }, { owner_id: r.userId }, { created_by: r.userId }] };
  }

  private include() {
    return [
      { model: this.db.users, as: 'owner', attributes: USER_ATTRS, required: false },
      { model: this.db.users, as: 'creator', attributes: USER_ATTRS, required: false },
      { model: this.db.crm_lead_sources, as: 'integration', attributes: ['id', 'name', 'type'], required: false },
      { model: this.db.customers, as: 'customer', attributes: ['id', 'display_name', 'company_name'], required: false },
    ];
  }

  private findVisible(r: CrmRequester, id: number) {
    return this.Leads.findOne({ where: { ...this.visibleWhere(r), id }, include: this.include() });
  }

  private async lockLead(r: CrmRequester, id: number, tx: any) {
    const lead: any = await this.Leads.findOne({
      where: { id, company_id: r.companyId, is_deleted: 0 },
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    return lead && canSeeLead(lead, actorOf(r)) ? lead : null;
  }

  private log(
    r: CrmRequester,
    leadId: number,
    type: string,
    f: { outcome?: string | null; body?: string | null; meta?: any } = {},
    tx?: any,
    userId: number | null = r.userId,
  ) {
    return this.db.crm_activities.create(
      {
        company_id: r.companyId,
        lead_id: leadId,
        user_id: userId,
        type,
        outcome: f.outcome ?? null,
        body: f.body ?? null,
        meta: f.meta ? JSON.stringify(f.meta).slice(0, 1000) : null,
        created_at: new Date(),
      },
      tx ? { transaction: tx } : undefined,
    );
  }

  private notify(r: CrmRequester, lead: any, userIds: (number | null | undefined)[], type: string, title: string, body?: string | null) {
    return this.notifications.notify({
      companyId: r.companyId,
      userIds: userIds.filter(Boolean).map(Number),
      module: 'crm',
      type,
      title,
      body: body ?? lead.requirement ?? null,
      link: `/app/crm/leads?lead=${lead.id}`,
      entityType: 'crm_lead',
      entityId: Number(lead.id),
      actorId: r.userId,
    });
  }

  private async actorName(r: CrmRequester) {
    const u = await this.db.users.findOne({ where: { id: r.userId }, attributes: USER_ATTRS });
    return userName(u) || 'Someone';
  }

  private async isCrmUser(companyId: number, userId: number) {
    return (await this.ingest.crmUsers(companyId)).some((u) => u.id === Number(userId));
  }

  /** A follow-up time: up to 3 years ahead, or a little in the past (overdue). */
  private parseFollowUp(v?: string | null): Date | null | { error: string } {
    if (v === null || v === undefined) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return { error: "That follow-up date isn't valid" };
    const now = Date.now();
    if (d.getTime() > now + MAX_FOLLOW_UP_AHEAD_MS) return { error: 'Pick a follow-up date within the next 3 years' };
    if (d.getTime() < now - 2 * 86_400_000) return { error: 'That follow-up date is in the past. Pick today or later.' };
    return d;
  }

  // ─── Reference data ───────────────────────────────────────────────────────

  async meta(r: CrmRequester) {
    const a = actorOf(r);
    const [users, integrations] = await Promise.all([
      this.ingest.crmUsers(r.companyId),
      this.db.crm_lead_sources.findAll({
        where: { company_id: r.companyId },
        attributes: ['id', 'name', 'type', 'is_active'],
        order: [['id', 'ASC']],
      }),
    ]);
    const has = (p: string) => r.permissions.includes(p);
    return ok('CRM meta fetched', {
      me: Number(r.userId),
      users: users.map((u) => ({ id: u.id, name: u.name, manager: u.manager })),
      integrations: integrations.map((s: any) => ({ id: Number(s.id), name: s.name, type: s.type, is_active: !!Number(s.is_active) })),
      can: {
        create: canCreateLeads(r),
        manage: a.isManager,
        quotations_view: has('quotations.view'),
        quotations_create: has('quotations.create'),
        customers_view: has('customers.view'),
        customers_create: has('customers.create'),
      },
    });
  }

  /** Badge + reminder counts for the current user (one query). */
  async summary(r: CrmRequester, tz?: unknown) {
    const now = new Date();
    const { end } = localDayBounds(now, parseTz(tz));
    const [row]: any[] = await this.seq.query(
      `SELECT SUM(owner_id = :me) AS open,
              SUM(owner_id = :me AND next_follow_up_at < :now) AS overdue,
              SUM(owner_id = :me AND next_follow_up_at >= :now AND next_follow_up_at < :eod) AS due_today,
              SUM(owner_id = :me AND stage = 'NEW') AS untouched,
              SUM(owner_id IS NULL) AS pool
         FROM crm_leads
        WHERE company_id = :companyId AND is_deleted = 0 AND stage IN (:open)`,
      {
        replacements: { me: r.userId, now, eod: end, companyId: r.companyId, open: OPEN_STAGES },
        type: QueryTypes.SELECT,
      },
    );
    return ok('CRM summary fetched', {
      open: n0(row?.open),
      overdue: n0(row?.overdue),
      due_today: n0(row?.due_today),
      untouched: n0(row?.untouched),
      pool: n0(row?.pool),
    });
  }

  // ─── Lists ────────────────────────────────────────────────────────────────

  private buildWhere(r: CrmRequester, q: any, tz: number, now: Date) {
    const a = actorOf(r);
    const where: any = this.visibleWhere(r);
    const and: any[] = [];

    if (q.scope === 'mine') and.push({ owner_id: r.userId });
    else if (q.scope === 'pool') and.push({ owner_id: null });

    if (q.owner_id && a.isManager) {
      and.push({ owner_id: q.owner_id === 'none' ? null : Number(q.owner_id) || -1 });
    }
    const sources = csv(q.source).filter(isSource);
    if (sources.length) where.source = { [Op.in]: sources };
    if (q.integration_id) where.source_id = Number(q.integration_id) || -1;
    const ratings = csv(q.rating);
    if (ratings.length) {
      const known = ratings.filter((x) => RATINGS.includes(x as any));
      and.push({
        [Op.or]: [
          ...(known.length ? [{ rating: { [Op.in]: known } }] : []),
          ...(ratings.includes('NONE') ? [{ rating: null }] : []),
        ],
      });
    }

    const stages = csv(q.stage).filter((s) => STAGES.includes(s as Stage));
    if (stages.length) where.stage = { [Op.in]: stages };
    else if (q.status === 'won') where.stage = 'WON';
    else if (q.status === 'lost') where.stage = 'LOST';
    else if (q.status === 'closed') where.stage = { [Op.in]: ['WON', 'LOST'] };
    else if (q.status !== 'all') where.stage = { [Op.in]: OPEN_STAGES };

    const { end } = localDayBounds(now, tz);
    if (q.follow_up) {
      const open = { stage: { [Op.in]: OPEN_STAGES } };
      if (q.follow_up === 'overdue') and.push(open, { next_follow_up_at: { [Op.lt]: now } });
      else if (q.follow_up === 'today') and.push(open, { next_follow_up_at: { [Op.gte]: now, [Op.lt]: end } });
      else if (q.follow_up === 'due') and.push(open, { next_follow_up_at: { [Op.lt]: end } });
      else if (q.follow_up === 'upcoming') and.push(open, { next_follow_up_at: { [Op.gte]: end } });
      else if (q.follow_up === 'none') and.push(open, { next_follow_up_at: null });
    }

    if (isIsoDate(q.from)) and.push({ created_at: { [Op.gte]: localMidnightUtc(q.from, tz) } });
    if (isIsoDate(q.to)) and.push({ created_at: { [Op.lt]: localMidnightUtc(addDays(q.to, 1), tz) } });

    const term = String(q.q ?? '').trim().slice(0, 100);
    if (term) {
      const like = `%${term}%`;
      const digits = term.replace(/\D/g, '');
      const ors: any[] = [
        { name: { [Op.like]: like } },
        { company_name: { [Op.like]: like } },
        { email: { [Op.like]: like } },
        { requirement: { [Op.like]: like } },
        { city: { [Op.like]: like } },
      ];
      if (digits.length >= 4) {
        ors.push({ phone: { [Op.like]: `%${digits}%` } }, { alt_phone: { [Op.like]: `%${digits}%` } });
      }
      const num = parseLeadKey(term);
      if (num && (/^\s*ld/i.test(term) || /^\d+$/.test(term))) ors.push({ lead_number: num });
      and.push({ [Op.or]: ors });
    }
    if (and.length) where[Op.and] = and;
    return where;
  }

  private order(sort?: string): any[] {
    const recv = literal('COALESCE(`crm_leads`.`received_at`, `crm_leads`.`created_at`)');
    switch (sort) {
      case 'follow_up':
        return [[literal('`crm_leads`.`next_follow_up_at` IS NULL'), 'ASC'], ['next_follow_up_at', 'ASC'], [recv, 'DESC']];
      case 'value':
        return [[literal('`crm_leads`.`estimated_value` IS NULL'), 'ASC'], ['estimated_value', 'DESC'], ['id', 'DESC']];
      case 'updated':
        return [['updated_at', 'DESC'], ['id', 'DESC']];
      case 'oldest':
        return [[recv, 'ASC'], ['id', 'ASC']];
      default:
        return [[recv, 'DESC'], ['id', 'DESC']];
    }
  }

  async list(r: CrmRequester, q: any) {
    const tz = parseTz(q.tz);
    const ctx = this.ctx(r, tz);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
    const page = Math.max(Number(q.page) || 1, 1);
    const { rows, count } = await this.Leads.findAndCountAll({
      where: this.buildWhere(r, q, tz, ctx.now),
      include: this.include(),
      order: this.order(q.sort),
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });
    return ok('Leads fetched', {
      rows: rows.map((l: any) => serializeLead(l, ctx)),
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
    });
  }

  /** Board: every open stage + what was won / lost in the last 30 days. */
  async pipeline(r: CrmRequester, q: any) {
    const tz = parseTz(q.tz);
    const ctx = this.ctx(r, tz);
    const base = this.buildWhere(r, { ...q, status: 'all', stage: '' }, tz, ctx.now);
    const since = new Date(ctx.now.getTime() - 30 * 86_400_000);
    const per = Math.min(Math.max(Number(q.per_stage) || 40, 5), 100);
    const whereFor = (s: Stage) => {
      const w: any = { ...base, stage: s };
      if (s === 'WON') w.won_at = { [Op.gte]: since };
      if (s === 'LOST') w.lost_at = { [Op.gte]: since };
      return w;
    };
    const boardOrder = [
      [literal('`crm_leads`.`next_follow_up_at` IS NULL'), 'ASC'],
      ['next_follow_up_at', 'ASC'],
      [literal('COALESCE(`crm_leads`.`received_at`, `crm_leads`.`created_at`)'), 'DESC'],
    ];
    const columns = await Promise.all(
      STAGES.map(async (s) => {
        const w = whereFor(s);
        const [agg, items] = await Promise.all([
          this.Leads.findOne({
            where: w,
            attributes: [
              [fn('COUNT', col('id')), 'n'],
              [fn('SUM', col('estimated_value')), 'value'],
            ],
            raw: true,
          }),
          this.Leads.findAll({
            where: w,
            include: this.include(),
            order: s === 'WON' ? [['won_at', 'DESC']] : s === 'LOST' ? [['lost_at', 'DESC']] : boardOrder,
            limit: per,
          }),
        ]);
        return {
          stage: s,
          label: STAGE_LABEL[s],
          count: n0((agg as any)?.n),
          value: n0((agg as any)?.value),
          items: items.map((l: any) => serializeLead(l, ctx)),
        };
      }),
    );
    return ok('Pipeline fetched', { columns, closed_window_days: 30 });
  }

  async duplicates(r: CrmRequester, q: any) {
    const phone = normalizePhone(q.phone);
    const email = normalizeEmail(q.email);
    if (!phone && !email) return ok('No duplicates', []);
    const or: any[] = [];
    if (phone) or.push({ phone }, { alt_phone: phone });
    if (email) or.push({ email });
    const where: any = { company_id: r.companyId, is_deleted: 0, [Op.or]: or };
    if (q.exclude_id) where.id = { [Op.ne]: Number(q.exclude_id) };
    const rows: any[] = await this.Leads.findAll({
      where,
      include: [{ model: this.db.users, as: 'owner', attributes: USER_ATTRS, required: false }],
      order: [['id', 'DESC']],
      limit: 5,
    });
    const a = actorOf(r);
    return ok(
      'Possible duplicates',
      rows.map((l) => ({
        id: Number(l.id),
        key: leadKey(l.lead_number),
        name: l.name,
        stage: l.stage,
        owner: userRef(l.owner),
        created_at: l.created_at,
        visible: canSeeLead(l, a),
        match: phone && (l.phone === phone || l.alt_phone === phone) ? 'phone' : 'email',
      })),
    );
  }

  // ─── One lead ─────────────────────────────────────────────────────────────

  async getOne(r: CrmRequester, id: number, tz?: unknown): Promise<Result> {
    let lead: any = await this.findVisible(r, id);
    if (!lead) return fail('Lead not found', 404);
    if (lead.customer_id && (await this.syncQuotations(r.companyId, lead))) lead = await this.findVisible(r, id);
    const ctx = this.ctx(r, tz);
    const [activities, enquiries, related, deals] = await Promise.all([
      this.db.crm_activities.findAll({
        where: { lead_id: lead.id, company_id: r.companyId },
        include: [{ model: this.db.users, as: 'user', attributes: USER_ATTRS, required: false }],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit: 200,
      }),
      this.db.crm_enquiries.findAll({
        where: { lead_id: lead.id, company_id: r.companyId },
        attributes: ['id', 'source', 'source_detail', 'source_ref', 'subject', 'message', 'received_at', 'source_id', [literal('`raw` IS NOT NULL'), 'has_raw']],
        include: [{ model: this.db.crm_lead_sources, as: 'integration', attributes: ['id', 'name', 'type'], required: false }],
        order: [['received_at', 'DESC'], ['id', 'DESC']],
        limit: 50,
      }),
      this.related(r, lead),
      this.deals(r, lead),
    ]);
    const parseMeta = (m: any) => {
      try {
        return m ? JSON.parse(m) : null;
      } catch {
        return null;
      }
    };
    return ok('Lead fetched', {
      ...serializeLead(lead, ctx, { full: true }),
      activities: activities.map((x: any) => ({
        id: Number(x.id),
        type: x.type,
        outcome: x.outcome ?? null,
        body: x.body ?? null,
        meta: parseMeta(x.meta),
        user: userRef(x.user),
        created_at: x.created_at,
      })),
      enquiries: enquiries.map((e: any) => ({
        id: Number(e.id),
        source: e.source,
        source_detail: e.source_detail ?? null,
        source_ref: e.source_ref ?? null,
        integration: e.integration ? { id: Number(e.integration.id), name: e.integration.name, type: e.integration.type } : null,
        subject: e.subject ?? null,
        message: e.message ?? null,
        received_at: e.received_at,
        has_raw: !!Number(e.get('has_raw')),
      })),
      related,
      deals,
    });
  }

  async enquiryRaw(r: CrmRequester, leadId: number, enquiryId: number) {
    const lead = await this.findVisible(r, leadId);
    if (!lead) return fail('Lead not found', 404);
    const e: any = await this.db.crm_enquiries.findOne({
      where: { id: enquiryId, lead_id: leadId, company_id: r.companyId },
      attributes: ['id', 'raw'],
    });
    if (!e?.raw) return fail('No original data for this enquiry', 404);
    let data: any = e.raw;
    try {
      data = JSON.parse(e.raw);
    } catch {
      // keep the text
    }
    return ok('Original data', data);
  }

  private async related(r: CrmRequester, lead: any) {
    const phones = [lead.phone, lead.alt_phone].filter(Boolean);
    const or: any[] = [];
    if (phones.length) or.push({ phone: { [Op.in]: phones } }, { alt_phone: { [Op.in]: phones } });
    if (lead.email) or.push({ email: lead.email });
    if (!or.length) return [];
    const rows: any[] = await this.Leads.findAll({
      where: { company_id: r.companyId, is_deleted: 0, id: { [Op.ne]: lead.id }, [Op.or]: or },
      include: [{ model: this.db.users, as: 'owner', attributes: USER_ATTRS, required: false }],
      order: [['id', 'DESC']],
      limit: 10,
    });
    const a = actorOf(r);
    return rows.map((l) => ({
      id: Number(l.id),
      key: leadKey(l.lead_number),
      stage: l.stage,
      requirement: l.requirement ?? null,
      owner: userRef(l.owner),
      created_at: l.created_at,
      visible: canSeeLead(l, a),
    }));
  }

  /** Quotations made for the lead's customer since the lead came in. */
  private async deals(r: CrmRequester, lead: any) {
    if (!lead.customer_id) return null;
    const rows: any[] = await this.seq.query(
      `SELECT id, quotation_number, status, grand_total, has_invoice, created_at
         FROM quotations
        WHERE company_id = :companyId AND customer_id = :customerId AND created_at >= :since
          AND (status IS NULL OR status <> 'DELETED')
        ORDER BY id DESC LIMIT 20`,
      {
        replacements: { companyId: r.companyId, customerId: lead.customer_id, since: lead.created_at },
        type: QueryTypes.SELECT,
      },
    );
    const visible = r.permissions.includes('quotations.view');
    const accepted = rows.find(
      (q) => q.status === 'APPROVED' || q.status === 'PARTIALLY_DISPATCHED' || Number(q.has_invoice) === 1,
    );
    return {
      visible,
      count: rows.length,
      quotations: visible
        ? rows.map((q) => ({
            id: Number(q.id),
            number: q.quotation_number,
            status: q.status || 'DRAFT',
            total: Number(q.grand_total || 0),
            has_invoice: !!Number(q.has_invoice),
            created_at: q.created_at,
          }))
        : [],
      suggest_won:
        isOpenStage(lead.stage) && accepted
          ? { id: Number(accepted.id), number: visible ? accepted.quotation_number : null }
          : null,
    };
  }

  /**
   * Puts quotations made for the lead's customer on the timeline and moves an
   * early-stage lead to "Quoted". Never throws: opening a lead must work even
   * if this fails. Returns true when the lead changed.
   */
  private async syncQuotations(companyId: number, lead: any): Promise<boolean> {
    try {
      const rows: any[] = await this.seq.query(
        `SELECT id, quotation_number, grand_total, created_by, created_at
           FROM quotations
          WHERE company_id = :companyId AND customer_id = :customerId AND id > :after
            AND created_at >= :since AND (status IS NULL OR status <> 'DELETED')
          ORDER BY id LIMIT 20`,
        {
          replacements: {
            companyId,
            customerId: lead.customer_id,
            after: Number(lead.quote_sync_id || 0),
            since: lead.created_at,
          },
          type: QueryTypes.SELECT,
        },
      );
      if (!rows.length) return false;
      const creatorIds = [...new Set(rows.map((q) => Number(q.created_by)).filter(Boolean))];
      const valid = new Set<number>(
        creatorIds.length
          ? (
              await this.db.users.findAll({ where: { id: { [Op.in]: creatorIds }, company_id: companyId }, attributes: ['id'] })
            ).map((u: any) => Number(u.id))
          : [],
      );
      const tx = await this.seq.transaction();
      try {
        const fresh: any = await this.Leads.findOne({ where: { id: lead.id, company_id: companyId }, transaction: tx, lock: tx.LOCK.UPDATE });
        const todo = rows.filter((q) => Number(q.id) > Number(fresh?.quote_sync_id || 0));
        if (!fresh || !todo.length) {
          await tx.commit();
          return false;
        }
        for (const q of todo) {
          await this.db.crm_activities.create(
            {
              company_id: companyId,
              lead_id: fresh.id,
              user_id: valid.has(Number(q.created_by)) ? Number(q.created_by) : null,
              type: 'QUOTATION',
              body: `Quotation ${q.quotation_number} created`,
              meta: JSON.stringify({ quotation_id: Number(q.id), number: q.quotation_number, total: Number(q.grand_total || 0) }),
              created_at: q.created_at || new Date(),
            },
            { transaction: tx },
          );
        }
        const last = todo[todo.length - 1];
        const lastAt = new Date(last.created_at || Date.now());
        const patch: any = { quote_sync_id: Number(last.id) };
        if (!fresh.last_activity_at || new Date(fresh.last_activity_at) < lastAt) patch.last_activity_at = lastAt;
        if (!fresh.first_response_at) patch.first_response_at = new Date(todo[0].created_at || Date.now());
        if (fresh.estimated_value === null && Number(last.grand_total) > 0) patch.estimated_value = Number(last.grand_total);
        const next = stageAfterQuotation(fresh.stage);
        if (next) {
          patch.stage = next;
          await this.db.crm_activities.create(
            {
              company_id: companyId,
              lead_id: fresh.id,
              user_id: null,
              type: 'STAGE',
              meta: JSON.stringify({ from: fresh.stage, to: next, auto: 'quotation' }),
              created_at: new Date(lastAt.getTime() + 1000),
            },
            { transaction: tx },
          );
        }
        await fresh.update(patch, { transaction: tx });
        await tx.commit();
        return true;
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    } catch (err) {
      this.appLogger.forContext('CrmService', 'syncQuotations', { companyId, leadId: lead.id }).error('Quotation sync failed', err);
      return false;
    }
  }

  async syncDeals(r: CrmRequester, id: number, tz?: unknown) {
    return this.getOne(r, id, tz);
  }

  // ─── Create / edit ────────────────────────────────────────────────────────

  async create(r: CrmRequester, dto: CreateLeadDto, tz?: unknown) {
    if (!canCreateLeads(r)) return fail("You don't have permission to add leads", 403);
    const a = actorOf(r);
    const { patch, error } = readContact(dto as any);
    if (error) return fail(error);
    const name = clean(dto.name, 150);
    if (!name) return fail('Enter a name');
    if (!patch!.phone && !patch!.email) return fail('Add a phone number or an email, so the team can reach this lead');

    let ownerId: number | null = Number(r.userId);
    if (a.isManager && dto.owner_id !== undefined) ownerId = (dto as any).owner_id === null ? null : Number(dto.owner_id);
    if (ownerId !== null && !(await this.isCrmUser(r.companyId, ownerId))) {
      return fail("That person can't be assigned: they're not an active user with CRM access.");
    }
    const followUp = this.parseFollowUp(dto.next_follow_up_at);
    if (followUp && 'error' in followUp) return fail(followUp.error);

    const log = this.appLogger.forContext('CrmService', 'create', { companyId: r.companyId });
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = await this.seq.transaction();
      try {
        const max = await this.Leads.max('lead_number', { where: { company_id: r.companyId }, transaction: tx });
        const now = new Date();
        const lead = await this.Leads.create(
          {
            company_id: r.companyId,
            lead_number: Number(max || 0) + 1,
            ...patch,
            name,
            estimated_value: dto.estimated_value ?? null,
            source: dto.source && isSource(dto.source) ? dto.source : 'OTHER',
            stage: 'NEW',
            rating: dto.rating ?? null,
            owner_id: ownerId,
            next_follow_up_at: followUp,
            follow_up_note: followUp ? clean(dto.follow_up_note, 300) : null,
            received_at: now,
            created_by: r.userId,
            created_at: now,
            updated_at: now,
          },
          { transaction: tx },
        );
        await this.log(r, lead.id, 'CREATED', { body: 'Added by hand', meta: { source: lead.source, owner_id: ownerId } }, tx);
        await tx.commit();
        if (ownerId && ownerId !== Number(r.userId)) {
          const who = await this.actorName(r);
          await this.notify(r, lead, [ownerId], 'CRM_LEAD_ASSIGNED', `${who} assigned you ${leadKey(lead.lead_number)} · ${lead.name}`);
        }
        log.info('Lead created', { leadId: lead.id });
        return this.getOne(r, Number(lead.id), tz);
      } catch (err) {
        await tx.rollback();
        if (err instanceof UniqueConstraintError && attempt < 4) continue;
        log.error('Failed to create lead', err);
        throw new Error('DATABASE_ERROR');
      }
    }
    return fail('Could not add the lead, please try again', 409);
  }

  async update(r: CrmRequester, id: number, dto: UpdateLeadDto, tz?: unknown) {
    const lead: any = await this.Leads.findOne({ where: { id, company_id: r.companyId, is_deleted: 0 } });
    if (!lead || !canSeeLead(lead, actorOf(r))) return fail('Lead not found', 404);
    const { patch, error } = readContact(dto as any);
    if (error) return fail(error);
    const p = patch!;
    if ('name' in p && !p.name) return fail('Enter a name');
    const has = (k: string) => Object.prototype.hasOwnProperty.call(dto, k) && (dto as any)[k] !== undefined;
    if (has('estimated_value')) p.estimated_value = dto.estimated_value ?? null;
    if (has('source') && isSource(dto.source)) p.source = dto.source;
    if (has('rating')) p.rating = dto.rating ?? null;

    const nextPhone = 'phone' in p ? p.phone : lead.phone;
    const nextEmail = 'email' in p ? p.email : lead.email;
    if (!nextPhone && !nextEmail) return fail('Keep at least a phone number or an email');

    const changes: Record<string, any> = {};
    Object.entries(p).forEach(([k, v]) => {
      const cur = lead[k] === undefined ? null : lead[k];
      const same = k === 'estimated_value' ? (cur === null ? null : Number(cur)) === (v === null ? null : Number(v)) : (cur ?? null) === (v ?? null);
      if (!same) changes[k] = v;
    });
    if (!Object.keys(changes).length) return this.getOne(r, id, tz);

    const tx = await this.seq.transaction();
    try {
      await lead.update({ ...changes, updated_at: new Date() }, { transaction: tx });
      await this.log(r, lead.id, 'UPDATED', { meta: { fields: Object.keys(changes).map((k) => FIELD_LABEL[k] || k) } }, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw new Error('DATABASE_ERROR');
    }
    return this.getOne(r, id, tz);
  }

  async setStage(r: CrmRequester, id: number, dto: StageDto, tz?: unknown) {
    const a = actorOf(r);
    const to = dto.stage as Stage;
    const reason = clean(dto.lost_reason, 300);
    if (to === 'LOST' && !reason) return fail('Pick a reason, so the team learns why leads are lost');
    let notifyOwner: number | null = null;
    let lead: any;
    const tx = await this.seq.transaction();
    try {
      lead = await this.lockLead(r, id, tx);
      if (!lead) {
        await tx.rollback();
        return fail('Lead not found', 404);
      }
      const from = lead.stage;
      if (from === to) {
        await tx.commit();
        return this.getOne(r, id, tz);
      }
      const now = new Date();
      const patch: any = { stage: to, last_activity_at: now };
      if (to === 'WON') {
        Object.assign(patch, { won_at: now, lost_at: null, lost_reason: null, next_follow_up_at: null, follow_up_note: null });
        if (dto.value !== undefined && dto.value !== null) patch.estimated_value = dto.value;
      } else if (to === 'LOST') {
        Object.assign(patch, { lost_at: now, won_at: null, lost_reason: reason, next_follow_up_at: null, follow_up_note: null });
      } else {
        Object.assign(patch, { won_at: null, lost_at: null, lost_reason: null });
      }
      const claim = shouldAutoClaim(lead, a);
      if (claim) patch.owner_id = r.userId;
      const ownerBefore = lead.owner_id != null ? Number(lead.owner_id) : null;
      await lead.update(patch, { transaction: tx });
      if (claim) await this.log(r, lead.id, 'ASSIGNED', { meta: { from: null, to: r.userId, claimed: true } }, tx);
      await this.log(r, lead.id, 'STAGE', { body: to === 'LOST' ? reason : null, meta: { from, to, value: patch.estimated_value } }, tx);
      await tx.commit();
      if ((to === 'WON' || to === 'LOST') && ownerBefore && ownerBefore !== Number(r.userId)) notifyOwner = ownerBefore;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    if (notifyOwner) {
      const who = await this.actorName(r);
      await this.notify(
        r,
        lead,
        [notifyOwner],
        to === 'WON' ? 'CRM_LEAD_WON' : 'CRM_LEAD_LOST',
        `${who} marked ${leadKey(lead.lead_number)} · ${lead.name} as ${to === 'WON' ? 'won' : 'lost'}`,
        to === 'LOST' ? reason : lead.requirement,
      );
    }
    return this.getOne(r, id, tz);
  }

  async assign(r: CrmRequester, id: number, dto: AssignDto, tz?: unknown) {
    const a = actorOf(r);
    const target = dto.owner_id === null || dto.owner_id === undefined ? null : Number(dto.owner_id);
    const lead: any = await this.Leads.findOne({ where: { id, company_id: r.companyId, is_deleted: 0 } });
    if (!lead || !canSeeLead(lead, a)) return fail('Lead not found', 404);
    const current = lead.owner_id != null ? Number(lead.owner_id) : null;
    if (current === target) return this.getOne(r, id, tz);
    if (!a.isManager) {
      const claiming = current === null && target === Number(r.userId);
      const releasing = current === Number(r.userId) && target === null;
      if (!claiming && !releasing) return fail('Only a manager can give a lead to someone else', 403);
    }
    if (target !== null && !(await this.isCrmUser(r.companyId, target))) {
      return fail("That person can't be assigned: they're not an active user with CRM access. Give their role CRM access in Roles & Permissions.");
    }
    const tx = await this.seq.transaction();
    try {
      await lead.update({ owner_id: target, updated_at: new Date() }, { transaction: tx });
      await this.log(r, lead.id, 'ASSIGNED', { meta: { from: current, to: target, claimed: target === Number(r.userId) && current === null } }, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw new Error('DATABASE_ERROR');
    }
    if (target && target !== Number(r.userId)) {
      const who = await this.actorName(r);
      await this.notify(r, lead, [target], 'CRM_LEAD_ASSIGNED', `${who} assigned you ${leadKey(lead.lead_number)} · ${lead.name}`);
    }
    return this.getOne(r, id, tz);
  }

  claim(r: CrmRequester, id: number, tz?: unknown) {
    return this.assign(r, id, { owner_id: Number(r.userId) }, tz);
  }

  async setFollowUp(r: CrmRequester, id: number, dto: FollowUpDto, tz?: unknown) {
    const at = this.parseFollowUp(dto.at);
    if (at && 'error' in at) return fail(at.error);
    const a = actorOf(r);
    const tx = await this.seq.transaction();
    try {
      const lead = await this.lockLead(r, id, tx);
      if (!lead) {
        await tx.rollback();
        return fail('Lead not found', 404);
      }
      if (!isOpenStage(lead.stage)) {
        await tx.rollback();
        return fail('This lead is closed. Reopen it to plan a follow-up.');
      }
      const note = at ? clean(dto.note, 300) : null;
      const claim = shouldAutoClaim(lead, a);
      await lead.update(
        { next_follow_up_at: at, follow_up_note: note, ...(claim ? { owner_id: r.userId } : {}), updated_at: new Date() },
        { transaction: tx },
      );
      if (claim) await this.log(r, lead.id, 'ASSIGNED', { meta: { from: null, to: r.userId, claimed: true } }, tx);
      await this.log(r, lead.id, 'FOLLOW_UP', { body: note, meta: { at: at ? at.toISOString() : null } }, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return this.getOne(r, id, tz);
  }

  /** A call / WhatsApp / email / meeting / note, optionally planning the next follow-up. */
  async logActivity(r: CrmRequester, id: number, dto: LogActivityDto, tz?: unknown) {
    const type = dto.type;
    if (!LOG_TYPES.includes(type as any)) return fail('Unknown activity type');
    const body = cleanText(dto.body, 5000);
    if (type === 'NOTE' && !body) return fail('Write the note first');
    if (type === 'CALL' && !dto.outcome) return fail('Pick how the call went');
    const outcome = type === 'CALL' ? dto.outcome ?? null : null;
    let next: Date | null | undefined;
    if (dto.next_follow_up_at === null) next = null;
    else if (dto.next_follow_up_at !== undefined) {
      const p = this.parseFollowUp(dto.next_follow_up_at);
      if (p && 'error' in p) return fail(p.error);
      next = p;
    }
    const a = actorOf(r);
    const now = new Date();
    const { end } = localDayBounds(now, parseTz(tz));
    const tx = await this.seq.transaction();
    try {
      const lead = await this.lockLead(r, id, tx);
      if (!lead) {
        await tx.rollback();
        return fail('Lead not found', 404);
      }
      const patch: any = { last_activity_at: now, updated_at: now };
      if (RESPONSE_TYPES.includes(type) && !lead.first_response_at) patch.first_response_at = now;
      const claim = shouldAutoClaim(lead, a);
      if (claim) patch.owner_id = r.userId;
      const moveTo = lead.stage === 'NEW' && reachedPerson(type, outcome) ? 'CONTACTED' : null;
      if (moveTo) patch.stage = moveTo;
      const open = isOpenStage(moveTo ?? lead.stage);
      if (next !== undefined && open) {
        patch.next_follow_up_at = next;
        patch.follow_up_note = next ? clean(dto.follow_up_note, 300) : null;
      } else if (
        next === undefined &&
        RESPONSE_TYPES.includes(type) &&
        lead.next_follow_up_at &&
        new Date(lead.next_follow_up_at) < end
      ) {
        // This call / message / meeting is the follow-up that was due — it's done.
        patch.next_follow_up_at = null;
        patch.follow_up_note = null;
      }
      await lead.update(patch, { transaction: tx });
      if (claim) await this.log(r, lead.id, 'ASSIGNED', { meta: { from: null, to: r.userId, claimed: true } }, tx);
      await this.log(
        r,
        lead.id,
        type,
        { outcome, body, meta: next !== undefined && open ? { next_follow_up_at: next ? next.toISOString() : null } : null },
        tx,
      );
      if (moveTo) await this.log(r, lead.id, 'STAGE', { meta: { from: 'NEW', to: moveTo, auto: 'contacted' } }, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    return this.getOne(r, id, tz);
  }

  async remove(r: CrmRequester, id: number) {
    const lead: any = await this.Leads.findOne({ where: { id, company_id: r.companyId, is_deleted: 0 } });
    const a = actorOf(r);
    if (!lead || !canSeeLead(lead, a)) return fail('Lead not found', 404);
    if (!leadCapabilities(lead, a).delete) {
      return fail('Only a manager, or the person who added and owns this lead, can delete it', 403);
    }
    await lead.update({ is_deleted: 1, deleted_at: new Date() });
    return ok('Lead deleted', { id: Number(lead.id) });
  }

  // ─── Lead → customer (→ quotation) ────────────────────────────────────────

  /** Existing customers that look like this lead (phone, email, GSTIN, name). */
  async customerMatches(r: CrmRequester, id: number) {
    if (!r.permissions.includes('customers.view')) return fail("You don't have access to customers", 403);
    const lead: any = await this.findVisible(r, id);
    if (!lead) return fail('Lead not found', 404);

    const phones = [...new Set([phoneMatchKey(lead.phone), phoneMatchKey(lead.alt_phone)].filter(Boolean))] as string[];
    const email = lead.email ? String(lead.email).toLowerCase() : null;
    const gst = lead.gst_number || null;
    const names = [...new Set([lead.name, lead.company_name].filter(Boolean).map((s: string) => s.trim().toLowerCase()))];
    const conds: string[] = [];
    const rep: any = { companyId: r.companyId };
    const phoneExpr = (c: string) => `RIGHT(REGEXP_REPLACE(COALESCE(${c}, ''), '[^0-9]', ''), 10)`;
    if (phones.length) {
      conds.push(`${phoneExpr('cc.phone')} IN (:phones)`, `${phoneExpr('c.phone')} IN (:phones)`);
      rep.phones = phones;
    }
    if (email) {
      conds.push('LOWER(cc.email) = :email', 'LOWER(c.email) = :email');
      rep.email = email;
    }
    if (gst) {
      conds.push('UPPER(c.gst_number) = :gst', 'UPPER(ca.gst_number) = :gst');
      rep.gst = gst;
    }
    if (names.length) {
      conds.push('LOWER(TRIM(c.display_name)) IN (:names)', 'LOWER(TRIM(c.company_name)) IN (:names)');
      rep.names = names;
    }
    if (!conds.length) return ok('No matches', { matches: [] });

    const rows: any[] = await this.seq.query(
      `SELECT c.id, c.display_name, c.company_name, c.gst_number, c.customer_type,
              MAX(${phones.length ? `${phoneExpr('cc.phone')} IN (:phones) OR ${phoneExpr('c.phone')} IN (:phones)` : '0'}) AS m_phone,
              MAX(${email ? 'LOWER(cc.email) = :email OR LOWER(c.email) = :email' : '0'}) AS m_email,
              MAX(${gst ? 'UPPER(c.gst_number) = :gst OR UPPER(ca.gst_number) = :gst' : '0'}) AS m_gst,
              MAX(${names.length ? 'LOWER(TRIM(c.display_name)) IN (:names) OR LOWER(TRIM(c.company_name)) IN (:names)' : '0'}) AS m_name
         FROM customers c
         LEFT JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.is_active = 1
         LEFT JOIN customer_addresses ca ON ca.customer_id = c.id AND ca.is_active = 1
        WHERE c.company_id = :companyId AND c.is_active = 1 AND (${conds.join(' OR ')})
        GROUP BY c.id, c.display_name, c.company_name, c.gst_number, c.customer_type
        LIMIT 20`,
      { replacements: rep, type: QueryTypes.SELECT },
    );
    if (!rows.length) return ok('No matches', { matches: [] });

    const ids = rows.map((x) => Number(x.id));
    const [contacts, addresses] = await Promise.all([
      this.db.customer_contacts.findAll({
        where: { customer_id: { [Op.in]: ids }, is_active: 1 },
        attributes: ['customer_id', 'first_name', 'last_name', 'phone', 'email', 'is_primary'],
        order: [['is_primary', 'DESC'], ['id', 'ASC']],
      }),
      this.db.customer_addresses.findAll({
        where: { customer_id: { [Op.in]: ids }, is_active: 1 },
        attributes: ['customer_id', 'city', 'state', 'is_primary', 'address_type'],
        order: [['is_primary', 'DESC'], ['id', 'ASC']],
      }),
    ]);
    const first = (list: any[], cid: number) => list.find((x) => Number(x.customer_id) === cid);
    const score = (x: any) => n0(x.m_gst) * 4 + n0(x.m_phone) * 3 + n0(x.m_email) * 3 + n0(x.m_name);
    const matches = rows
      .sort((x, y) => score(y) - score(x))
      .slice(0, 8)
      .map((x) => {
        const cid = Number(x.id);
        const c = first(contacts, cid);
        const ad = first(addresses, cid);
        return {
          id: cid,
          display_name: x.display_name,
          company_name: x.company_name ?? null,
          gst_number: x.gst_number ?? null,
          customer_type: x.customer_type,
          contact: c ? { name: [c.first_name, c.last_name].filter(Boolean).join(' '), phone: c.phone ?? null, email: c.email ?? null } : null,
          place: ad ? [ad.city, ad.state].filter(Boolean).join(', ') || null : null,
          reasons: [
            n0(x.m_gst) ? 'gstin' : null,
            n0(x.m_phone) ? 'phone' : null,
            n0(x.m_email) ? 'email' : null,
            n0(x.m_name) ? 'name' : null,
          ].filter(Boolean),
        };
      });
    return ok('Customer matches', { matches });
  }

  /**
   * Links the lead to a customer — an existing one, or a new one created from
   * the lead's details (customer + primary contact + billing address, in one
   * transaction with the link). The quotation is then made on the Quotations page.
   */
  async convert(r: CrmRequester, id: number, dto: ConvertLeadDto, tz?: unknown) {
    const a = actorOf(r);
    const log = this.appLogger.forContext('CrmService', 'convert', { companyId: r.companyId, leadId: id });
    if (dto.mode === 'link' && !r.permissions.includes('customers.view')) return fail("You don't have access to customers", 403);
    if (dto.mode === 'create' && !r.permissions.includes('customers.create')) {
      return fail("You don't have permission to create customers. Link an existing customer instead.", 403);
    }
    const c = dto.customer;
    let gst: string | null = null;
    if (dto.mode === 'create') {
      if (!c) return fail('Customer details are missing');
      if (c.gst_number && c.gst_number.trim()) {
        gst = normalizeGstin(c.gst_number);
        if (!gst) return fail('GSTIN should be 15 characters, like 27ABCDE1234F1Z5');
      }
    }

    const tx = await this.seq.transaction();
    let customerId = 0;
    let customerName = '';
    let created = false;
    try {
      const lead = await this.lockLead(r, id, tx);
      if (!lead) {
        await tx.rollback();
        return fail('Lead not found', 404);
      }
      if (dto.mode === 'link') {
        const cust: any = await this.db.customers.findOne({
          where: { id: dto.customer_id, company_id: r.companyId, is_active: 1 },
          attributes: ['id', 'display_name'],
          transaction: tx,
        });
        if (!cust) {
          await tx.rollback();
          return fail('Customer not found', 404);
        }
        customerId = Number(cust.id);
        customerName = cust.display_name;
      } else {
        const displayName = clean(c!.display_name, 255)!;
        const dup: any = await this.db.customers.findOne({
          where: { company_id: r.companyId, display_name: displayName, is_active: 1 },
          attributes: ['id', 'display_name'],
          transaction: tx,
        });
        if (dup) {
          await tx.rollback();
          return fail(`A customer named "${dup.display_name}" already exists. Link the lead to it instead.`, 409, {
            existing_customer_id: Number(dup.id),
          });
        }
        const now = new Date();
        const cust: any = await this.db.customers.create(
          {
            company_id: r.companyId,
            customer_type: c!.customer_type,
            display_name: displayName,
            company_name: clean(c!.company_name, 255),
            gst_number: gst,
            notes: `Created from CRM lead ${leadKey(lead.lead_number)}`,
            is_active: 1,
            created_by: r.userId,
            updated_by: r.userId,
            created_at: now,
            updated_at: now,
          },
          { transaction: tx },
        );
        await this.db.customer_contacts.create(
          {
            customer_id: cust.id,
            first_name: clean(c!.contact.first_name, 100),
            last_name: clean(c!.contact.last_name, 100),
            email: normalizeEmail(c!.contact.email),
            phone: c!.contact.phone || null,
            designation: clean(c!.contact.designation, 100),
            is_primary: 1,
            is_active: 1,
            created_by: r.userId,
            updated_by: r.userId,
          },
          { transaction: tx },
        );
        await this.db.customer_addresses.create(
          {
            customer_id: cust.id,
            address_type: 'BILLING',
            label: 'Billing',
            gst_number: gst,
            address_line_1: clean(c!.address.address_line_1, 255),
            address_line_2: clean(c!.address.address_line_2, 255),
            city: clean(c!.address.city, 100),
            state: clean(c!.address.state, 100),
            country: clean(c!.address.country, 100) || 'India',
            postal_code: clean(c!.address.postal_code, 20),
            is_primary: 1,
            is_active: 1,
            created_by: r.userId,
            updated_by: r.userId,
          },
          { transaction: tx },
        );
        customerId = Number(cust.id);
        customerName = cust.display_name;
        created = true;
      }

      const now = new Date();
      const previous = lead.customer_id ? Number(lead.customer_id) : null;
      const claim = shouldAutoClaim(lead, a);
      await lead.update(
        {
          customer_id: customerId,
          converted_at: previous === customerId ? lead.converted_at : now,
          converted_by: previous === customerId ? lead.converted_by : r.userId,
          quote_sync_id: previous === customerId ? lead.quote_sync_id : null,
          last_activity_at: now,
          ...(claim ? { owner_id: r.userId } : {}),
          updated_at: now,
        },
        { transaction: tx },
      );
      if (claim) await this.log(r, lead.id, 'ASSIGNED', { meta: { from: null, to: r.userId, claimed: true } }, tx);
      if (previous !== customerId) {
        await this.log(
          r,
          lead.id,
          'CONVERTED',
          { body: created ? `New customer "${customerName}" created` : `Linked to customer "${customerName}"`, meta: { customer_id: customerId, created, previous } },
          tx,
        );
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      log.error('Failed to convert lead', err);
      throw new Error('DATABASE_ERROR');
    }
    log.info('Lead converted', { customerId, created });
    const res = await this.getOne(r, id, tz);
    return res.success ? ok(created ? 'Customer created' : 'Customer linked', { ...res.data, customer_id: customerId, customer_created: created }) : res;
  }

  // ─── CSV import ───────────────────────────────────────────────────────────

  async importRows(r: CrmRequester, dto: ImportLeadsDto) {
    if (!canCreateLeads(r)) return fail("You don't have permission to import leads", 403);
    const a = actorOf(r);
    let ownerId: number | null = Number(r.userId);
    if (a.isManager && dto.owner_id !== undefined) ownerId = dto.owner_id === null ? null : Number(dto.owner_id);
    if (ownerId !== null && !(await this.isCrmUser(r.companyId, ownerId))) {
      return fail("That person can't be assigned: they're not an active user with CRM access.");
    }
    const source: Source = dto.source && isSource(dto.source) ? dto.source : 'OTHER';
    const results = await this.ingest.ingestBatch(
      dto.rows.map((row) => ({ lead: mapImportRow(row as any, source), raw: null })),
      {
        companyId: r.companyId,
        actorId: r.userId,
        ownerId,
        rating: dto.rating ?? null,
        duplicates: 'skip',
        createdLabel: 'Imported from a CSV file',
      },
    );
    const count = (s: string) => results.filter((x) => x.status === s).length;
    return ok('Import finished', {
      total: results.length,
      created: count('created'),
      skipped: count('skipped') + count('exists'),
      invalid: count('invalid'),
      problems: results
        .filter((x) => x.status !== 'created')
        .slice(0, 200)
        .map((x) => ({ index: x.index, status: x.status, reason: x.reason ?? null, lead_id: x.lead_id ?? null })),
    });
  }

  // ─── Insights ─────────────────────────────────────────────────────────────

  async overview(r: CrmRequester, q: any) {
    const a = actorOf(r);
    const tz = parseTz(q.tz);
    const now = new Date();
    const today = localDate(now, tz);
    const to = isIsoDate(q.to) ? q.to : today;
    const from = isIsoDate(q.from) ? q.from : addDays(to, -29);
    if (from > to) return fail('"from" must be on or before "to"');
    const days = daysInclusive(from, to);
    if (days > MAX_RANGE_DAYS) return fail('Pick a range of up to 2 years');
    const f = localMidnightUtc(from, tz);
    const t = localMidnightUtc(addDays(to, 1), tz);
    const pf = localMidnightUtc(addDays(from, -days), tz);
    const { end: eod } = localDayBounds(now, tz);

    let ownerSql = '';
    const rep: any = { companyId: r.companyId, f, t, pf, now, eod, open: OPEN_STAGES, tz };
    if (!a.isManager) {
      ownerSql = ' AND owner_id = :me';
      rep.me = r.userId;
    } else if (q.owner_id === 'none') ownerSql = ' AND owner_id IS NULL';
    else if (q.owner_id) {
      ownerSql = ' AND owner_id = :owner';
      rep.owner = Number(q.owner_id) || -1;
    }
    const base = `company_id = :companyId AND is_deleted = 0${ownerSql}`;
    const S = (sql: string) => this.seq.query(sql, { replacements: rep, type: QueryTypes.SELECT });

    const [totalsRows, responseRows, createdDays, wonDays, bySource, byStage, cohort, lostReasons, activityRows] = await Promise.all([
      S(`SELECT
           SUM(created_at >= :f AND created_at < :t) AS leads,
           SUM(created_at >= :pf AND created_at < :f) AS leads_prev,
           SUM(stage = 'WON' AND won_at >= :f AND won_at < :t) AS won,
           SUM(CASE WHEN stage = 'WON' AND won_at >= :f AND won_at < :t THEN COALESCE(estimated_value, 0) ELSE 0 END) AS won_value,
           SUM(stage = 'WON' AND won_at >= :pf AND won_at < :f) AS won_prev,
           SUM(CASE WHEN stage = 'WON' AND won_at >= :pf AND won_at < :f THEN COALESCE(estimated_value, 0) ELSE 0 END) AS won_value_prev,
           SUM(stage = 'LOST' AND lost_at >= :f AND lost_at < :t) AS lost,
           SUM(stage = 'LOST' AND lost_at >= :pf AND lost_at < :f) AS lost_prev,
           SUM(stage IN (:open)) AS open,
           SUM(CASE WHEN stage IN (:open) THEN COALESCE(estimated_value, 0) ELSE 0 END) AS open_value,
           SUM(stage IN (:open) AND next_follow_up_at < :now) AS overdue,
           SUM(stage IN (:open) AND next_follow_up_at >= :now AND next_follow_up_at < :eod) AS due_today,
           SUM(stage IN (:open) AND next_follow_up_at IS NULL) AS no_follow_up,
           SUM(stage IN (:open) AND owner_id IS NULL) AS unassigned,
           SUM(stage = 'NEW') AS untouched
         FROM crm_leads WHERE ${base}`),
      // Speed to lead: only leads that arrived by themselves (integrations).
      S(`SELECT owner_id, TIMESTAMPDIFF(MINUTE, created_at, first_response_at) AS m
           FROM crm_leads
          WHERE ${base} AND created_by IS NULL AND created_at >= :f AND created_at < :t AND first_response_at IS NOT NULL
          LIMIT 5000`),
      S(`SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL :tz MINUTE), '%Y-%m-%d') AS d, COUNT(*) AS n
           FROM crm_leads WHERE ${base} AND created_at >= :f AND created_at < :t GROUP BY d`),
      S(`SELECT DATE_FORMAT(DATE_ADD(won_at, INTERVAL :tz MINUTE), '%Y-%m-%d') AS d, COUNT(*) AS n,
                SUM(COALESCE(estimated_value, 0)) AS v
           FROM crm_leads WHERE ${base} AND stage = 'WON' AND won_at >= :f AND won_at < :t GROUP BY d`),
      S(`SELECT source, COUNT(*) AS leads, SUM(stage = 'WON') AS won, SUM(stage = 'LOST') AS lost,
                SUM(CASE WHEN stage = 'WON' THEN COALESCE(estimated_value, 0) ELSE 0 END) AS won_value
           FROM crm_leads WHERE ${base} AND created_at >= :f AND created_at < :t
          GROUP BY source ORDER BY leads DESC`),
      S(`SELECT stage, COUNT(*) AS n, SUM(COALESCE(estimated_value, 0)) AS value
           FROM crm_leads WHERE ${base} AND stage IN (:open) GROUP BY stage`),
      // Funnel: how far each lead created in the range got (stage history + now).
      S(`SELECT l.stage,
                (SELECT GROUP_CONCAT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(a.meta, '$.to')))
                   FROM crm_activities a WHERE a.lead_id = l.id AND a.type = 'STAGE') AS reached
           FROM crm_leads l
          WHERE l.company_id = :companyId AND l.is_deleted = 0${ownerSql.replace(/owner_id/g, 'l.owner_id')}
            AND l.created_at >= :f AND l.created_at < :t
          LIMIT 5000`),
      S(`SELECT COALESCE(lost_reason, 'Not given') AS reason, COUNT(*) AS n
           FROM crm_leads WHERE ${base} AND stage = 'LOST' AND lost_at >= :f AND lost_at < :t
          GROUP BY reason ORDER BY n DESC LIMIT 8`),
      S(`SELECT a.type, COUNT(*) AS n
           FROM crm_activities a JOIN crm_leads l ON l.id = a.lead_id
          WHERE a.company_id = :companyId AND l.is_deleted = 0 AND a.created_at >= :f AND a.created_at < :t
            AND a.type IN ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE')
            ${a.isManager ? (rep.owner ? 'AND a.user_id = :owner' : '') : 'AND a.user_id = :me'}
          GROUP BY a.type`),
    ]);

    const tot: any = (totalsRows as any[])[0] || {};
    const minutes = (responseRows as any[]).map((x) => n0(x.m)).filter((m) => m >= 0);
    const series: { day: string; leads: number; won: number; won_value: number }[] = [];
    const cBy = new Map((createdDays as any[]).map((x) => [x.d, n0(x.n)]));
    const wBy = new Map((wonDays as any[]).map((x) => [x.d, { n: n0(x.n), v: n0(x.v) }]));
    for (let d = from, i = 0; d <= to && i < 800; d = addDays(d, 1), i++) {
      series.push({ day: d, leads: cBy.get(d) || 0, won: wBy.get(d)?.n || 0, won_value: wBy.get(d)?.v || 0 });
    }
    const reachedCounts = STAGES.filter((s) => s !== 'LOST').map(() => 0);
    (cohort as any[]).forEach((x) => {
      const rank = furthestRank(x.stage, String(x.reached || '').split(',').filter(Boolean));
      for (let k = 0; k <= rank && k < reachedCounts.length; k++) reachedCounts[k]++;
    });
    const funnel = STAGES.filter((s) => s !== 'LOST').map((s, k) => ({ stage: s, label: STAGE_LABEL[s], count: reachedCounts[k] }));
    const stageMap = new Map((byStage as any[]).map((x) => [x.stage, x]));

    let owners: any[] | null = null;
    if (a.isManager) {
      const [ownerRows, people] = await Promise.all([
        S(`SELECT owner_id,
                  SUM(stage IN (:open)) AS open,
                  SUM(stage = 'NEW') AS untouched,
                  SUM(stage IN (:open) AND next_follow_up_at < :now) AS overdue,
                  SUM(created_at >= :f AND created_at < :t) AS received,
                  SUM(stage = 'WON' AND won_at >= :f AND won_at < :t) AS won,
                  SUM(CASE WHEN stage = 'WON' AND won_at >= :f AND won_at < :t THEN COALESCE(estimated_value, 0) ELSE 0 END) AS won_value,
                  SUM(stage = 'LOST' AND lost_at >= :f AND lost_at < :t) AS lost
             FROM crm_leads WHERE company_id = :companyId AND is_deleted = 0 GROUP BY owner_id`),
        this.ingest.crmUsers(r.companyId),
      ]);
      const statsBy = new Map((ownerRows as any[]).map((x) => [x.owner_id === null ? 'none' : Number(x.owner_id), x]));
      const respBy = new Map<number, number[]>();
      (responseRows as any[]).forEach((x) => {
        if (x.owner_id === null) return;
        const k = Number(x.owner_id);
        respBy.set(k, [...(respBy.get(k) || []), n0(x.m)]);
      });
      const row = (id: number | null, name: string) => {
        const s: any = statsBy.get(id === null ? 'none' : id) || {};
        const won = n0(s.won);
        const lost = n0(s.lost);
        return {
          id,
          name,
          open: n0(s.open),
          untouched: n0(s.untouched),
          overdue: n0(s.overdue),
          received: n0(s.received),
          won,
          won_value: n0(s.won_value),
          lost,
          win_rate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
          response_minutes: id === null ? null : median(respBy.get(id) || []),
        };
      };
      owners = people.map((p) => row(p.id, p.name));
      const knownIds = new Set(people.map((p) => p.id));
      (ownerRows as any[]).forEach((x) => {
        if (x.owner_id !== null && !knownIds.has(Number(x.owner_id))) owners!.push(row(Number(x.owner_id), 'Former user'));
      });
      owners.push(row(null, 'Unassigned'));
      owners = owners.filter((o) => o.id !== null || o.open > 0 || o.received > 0);
      owners.sort((x, y) => y.won_value - x.won_value || y.open - x.open || String(x.name).localeCompare(String(y.name)));
    }

    const won = n0(tot.won);
    const lost = n0(tot.lost);
    return ok('CRM overview fetched', {
      range: { from, to, days, prev_from: addDays(from, -days), prev_to: addDays(from, -1), tz },
      scope: a.isManager ? (q.owner_id ? 'owner' : 'team') : 'mine',
      totals: {
        leads: n0(tot.leads),
        leads_prev: n0(tot.leads_prev),
        won,
        won_prev: n0(tot.won_prev),
        won_value: n0(tot.won_value),
        won_value_prev: n0(tot.won_value_prev),
        lost,
        lost_prev: n0(tot.lost_prev),
        win_rate: won + lost ? Math.round((won / (won + lost)) * 100) : null,
        open: n0(tot.open),
        open_value: n0(tot.open_value),
        overdue: n0(tot.overdue),
        due_today: n0(tot.due_today),
        no_follow_up: n0(tot.no_follow_up),
        unassigned: n0(tot.unassigned),
        untouched: n0(tot.untouched),
      },
      response: {
        measured: minutes.length,
        median_minutes: median(minutes),
        within_hour: minutes.filter((m) => m <= 60).length,
      },
      series,
      sources: (bySource as any[]).map((x) => ({
        source: x.source,
        leads: n0(x.leads),
        won: n0(x.won),
        lost: n0(x.lost),
        won_value: n0(x.won_value),
      })),
      stages: OPEN_STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], count: n0(stageMap.get(s)?.n), value: n0(stageMap.get(s)?.value) })),
      funnel,
      lost_reasons: (lostReasons as any[]).map((x) => ({ reason: x.reason, count: n0(x.n) })),
      activities: Object.fromEntries((activityRows as any[]).map((x) => [x.type, n0(x.n)])),
      owners,
    });
  }
}
