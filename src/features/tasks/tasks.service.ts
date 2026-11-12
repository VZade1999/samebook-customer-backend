import { Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CacheService, companyScope } from '../../common/cache/cache.service';
import { CommentDto, CreateTaskDto, FollowUpDto, UpdateTaskDto } from './dto/task.dto';
import {
  ALLOWED_CHILDREN,
  LINK_PERMISSION,
  LinkType,
  TYPE_LABEL,
  TaskActor,
  TaskType,
  capabilities,
  hasFullAccess,
  isIsoDate,
  isOverdue,
  parentError,
  progressOf,
  taskKey,
} from './tasks.rules';

export interface TasksRequester {
  userId: number;
  companyId: number;
  permissions: string[];
}

type Result<T = any> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; status: number };

const ok = <T>(message: string, data: T): Result<T> => ({ success: true, message, data });
const fail = (message: string, status = 400): Result => ({ success: false, message, status });

const MAX_DEPTH = 3; // Epic > Goal > Task > Subtask
const FOLLOW_UP_COOLDOWN_MS = 10 * 60 * 1000;
const USER_ATTRS = ['id', 'first_name', 'last_name', 'email'];

const userName = (u: any) =>
  u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email : null;
const userRef = (u: any) => (u ? { id: Number(u.id), name: userName(u) } : null);

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

@Injectable()
export class TasksService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly notifications: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  private get db() {
    return this.dbProvider.db;
  }
  private get Tasks() {
    return this.db.tasks;
  }

  private actor(r: TasksRequester): TaskActor {
    return { userId: Number(r.userId), isManager: r.permissions.includes('tasks.manage') };
  }
  private canCreate(r: TasksRequester) {
    return r.permissions.includes('tasks.create') || r.permissions.includes('tasks.manage');
  }
  private today(t?: string) {
    return isIsoDate(t) ? t : localToday();
  }

  /** Items the user can list: everything for managers, else own/assigned. */
  private visibleWhere(r: TasksRequester): any {
    const base: any = { company_id: r.companyId, is_deleted: 0 };
    if (this.actor(r).isManager) return base;
    return { ...base, [Op.or]: [{ created_by: r.userId }, { assignee_id: r.userId }] };
  }

  // ─── Tree helpers (batched, max 3 levels) ─────────────────────────────────

  private async ancestorsOf(companyId: number, items: any[]): Promise<Map<number, any>> {
    const byId = new Map<number, any>();
    let ids = [...new Set(items.map((t) => t.parent_id).filter(Boolean).map(Number))];
    for (let depth = 0; depth < MAX_DEPTH && ids.length; depth++) {
      const rows: any[] = await this.Tasks.findAll({
        where: { id: { [Op.in]: ids }, company_id: companyId, is_deleted: 0 },
        attributes: ['id', 'task_number', 'type', 'title', 'parent_id', 'created_by', 'assignee_id', 'status'],
      });
      rows.forEach((r) => byId.set(Number(r.id), r));
      ids = [...new Set(rows.map((r) => r.parent_id).filter(Boolean).map(Number))].filter(
        (id) => !byId.has(id),
      );
    }
    return byId;
  }

  /** All (non-deleted) descendants of each root, any depth. */
  private async descendantsOf(companyId: number, rootIds: number[]): Promise<Map<number, any[]>> {
    const out = new Map<number, any[]>(rootIds.map((id) => [Number(id), []]));
    let frontier = new Map<number, number>(rootIds.map((id) => [Number(id), Number(id)])); // nodeId -> rootId
    for (let depth = 0; depth < MAX_DEPTH && frontier.size; depth++) {
      const rows: any[] = await this.Tasks.findAll({
        where: { parent_id: { [Op.in]: [...frontier.keys()] }, company_id: companyId, is_deleted: 0 },
        attributes: ['id', 'parent_id', 'status', 'type', 'created_by', 'assignee_id', 'due_date'],
      });
      const next = new Map<number, number>();
      rows.forEach((r) => {
        const root = frontier.get(Number(r.parent_id))!;
        out.get(root)!.push(r);
        next.set(Number(r.id), root);
      });
      frontier = next;
    }
    return out;
  }

  private breadcrumb(t: any, ancestors: Map<number, any>) {
    const chain: any[] = [];
    let p = t.parent_id ? ancestors.get(Number(t.parent_id)) : null;
    while (p && chain.length < MAX_DEPTH) {
      chain.unshift({ id: Number(p.id), key: taskKey(p.type, p.task_number), type: p.type, title: p.title });
      p = p.parent_id ? ancestors.get(Number(p.parent_id)) : null;
    }
    return chain;
  }

  // ─── Links to billing records ─────────────────────────────────────────────

  private async linkLabels(companyId: number, items: any[], perms: string[]) {
    const labels = new Map<string, string>();
    const byType: Record<string, number[]> = {};
    items.forEach((t) => {
      if (t.link_type && t.link_id) (byType[t.link_type] ||= []).push(Number(t.link_id));
    });
    const load = async (type: LinkType, model: any, attr: string) => {
      const ids = byType[type];
      if (!ids?.length || !perms.includes(LINK_PERMISSION[type])) return;
      const rows: any[] = await model.findAll({
        where: { id: { [Op.in]: [...new Set(ids)] }, company_id: companyId },
        attributes: ['id', attr],
      });
      rows.forEach((r) => labels.set(`${type}:${r.id}`, r[attr]));
    };
    await Promise.all([
      load('CUSTOMER', this.db.customers, 'display_name'),
      load('QUOTATION', this.db.quotations, 'quotation_number'),
      load('INVOICE', this.db.invoices, 'invoice_number'),
    ]);
    return labels;
  }

  private async validateLink(r: TasksRequester, type?: string | null, id?: number | null) {
    if (!type) return null;
    if (!id) return 'link_id is required with link_type';
    const t = type as LinkType;
    if (!r.permissions.includes(LINK_PERMISSION[t])) return `You don't have access to ${t.toLowerCase()}s`;
    const model = { CUSTOMER: this.db.customers, QUOTATION: this.db.quotations, INVOICE: this.db.invoices }[t];
    const found = await model.count({ where: { id, company_id: r.companyId } });
    return found ? null : `Linked ${t.toLowerCase()} not found`;
  }

  async linkSearch(r: TasksRequester, type: string, q: string) {
    const t = type as LinkType;
    if (!LINK_PERMISSION[t]) return fail('Unknown link type');
    if (!r.permissions.includes(LINK_PERMISSION[t])) return fail(`You don't have access to ${t.toLowerCase()}s`, 403);
    const term = String(q || '').trim().slice(0, 50);
    const cfg = {
      CUSTOMER: { model: this.db.customers, label: 'display_name', extra: ['company_name'] },
      QUOTATION: { model: this.db.quotations, label: 'quotation_number', extra: ['customer_name'] },
      INVOICE: { model: this.db.invoices, label: 'invoice_number', extra: ['customer_name'] },
    }[t];
    const where: any = { company_id: r.companyId };
    if (term) {
      where[Op.or] = [cfg.label, ...cfg.extra].map((f) => ({ [f]: { [Op.like]: `%${term}%` } }));
    }
    if (t === 'QUOTATION') where.status = { [Op.ne]: 'DELETED' };
    const rows: any[] = await cfg.model.findAll({
      where,
      attributes: ['id', cfg.label, ...cfg.extra],
      order: [['id', 'DESC']],
      limit: 20,
    });
    return ok(
      'Link options fetched',
      rows.map((x) => ({ id: Number(x.id), label: x[cfg.label], sub: x[cfg.extra[0]] || null })),
    );
  }

  // ─── People ───────────────────────────────────────────────────────────────

  /** Active users of the company whose roles grant tasks.view. */
  private async assignableUsers(companyId: number) {
    const rows: any[] = await this.dbProvider.sequelize.query(
      `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.company_id = :companyId AND u.is_active = 1
          AND p.name IN ('tasks.view', 'tasks.manage')
        ORDER BY u.first_name, u.last_name`,
      { replacements: { companyId }, type: QueryTypes.SELECT },
    );
    return rows.map((u) => ({ id: Number(u.id), name: userName(u), email: u.email }));
  }

  private async validateAssignee(companyId: number, assigneeId?: number | null) {
    if (!assigneeId) return null;
    const people = await this.assignableUsers(companyId);
    return people.some((p) => p.id === Number(assigneeId))
      ? null
      : "That person can't be assigned: they're not an active user with access to Tasks. Give their role access in Roles & Permissions.";
  }

  async meta(r: TasksRequester) {
    const a = this.actor(r);
    return ok('Tasks meta fetched', {
      assignees: await this.assignableUsers(r.companyId),
      can: { create: this.canCreate(r), manage: a.isManager, create_epic: a.isManager },
      link_types: (Object.keys(LINK_PERMISSION) as LinkType[]).filter((t) =>
        r.permissions.includes(LINK_PERMISSION[t]),
      ),
    });
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  private include() {
    return [
      { model: this.db.users, as: 'assignee', attributes: USER_ATTRS, required: false },
      { model: this.db.users, as: 'creator', attributes: USER_ATTRS, required: false },
    ];
  }

  private async serialize(r: TasksRequester, items: any[], today: string, opts: { full?: Set<number> } = {}) {
    const a = this.actor(r);
    const canCreate = this.canCreate(r);
    const [ancestors, descendants, labels] = await Promise.all([
      this.ancestorsOf(r.companyId, items),
      this.descendantsOf(r.companyId, items.map((t) => Number(t.id))),
      this.linkLabels(r.companyId, items, r.permissions),
    ]);
    return items.map((t) => {
      const full = opts.full ? opts.full.has(Number(t.id)) : hasFullAccess(t, a);
      const desc = descendants.get(Number(t.id)) || [];
      const directChildren = desc.filter((d) => Number(d.parent_id) === Number(t.id));
      return {
        id: Number(t.id),
        key: taskKey(t.type, t.task_number),
        type: t.type,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date ?? null,
        due_time: t.due_time ? String(t.due_time).slice(0, 5) : null,
        overdue: isOverdue(t, today),
        assignee: userRef(t.assignee),
        creator: userRef(t.creator),
        parent_id: t.parent_id ? Number(t.parent_id) : null,
        breadcrumb: this.breadcrumb(t, ancestors),
        progress: progressOf(desc.map((d) => d.status)),
        child_count: directChildren.length,
        link: t.link_type
          ? {
              type: t.link_type,
              id: Number(t.link_id),
              label: labels.get(`${t.link_type}:${t.link_id}`) ?? null,
            }
          : null,
        completed_at: t.completed_at ?? null,
        created_at: t.created_at,
        updated_at: t.updated_at,
        access: full ? 'full' : 'read',
        can: capabilities(t, a, full, canCreate),
      };
    });
  }

  /**
   * Access to one item: 'full' (manager / creator / assignee), 'read' (it is an
   * ancestor or descendant of something the user has full access to), or null.
   */
  private async accessTo(r: TasksRequester, t: any): Promise<'full' | 'read' | null> {
    const a = this.actor(r);
    if (hasFullAccess(t, a)) return 'full';
    const ancestors = await this.ancestorsOf(r.companyId, [t]);
    if ([...ancestors.values()].some((x) => hasFullAccess(x, a))) return 'read';
    const desc = (await this.descendantsOf(r.companyId, [Number(t.id)])).get(Number(t.id)) || [];
    if (desc.some((x) => hasFullAccess(x, a))) return 'read';
    return null;
  }

  private async findOwned(r: TasksRequester, id: number) {
    const t = await this.Tasks.findOne({
      where: { id, company_id: r.companyId, is_deleted: 0 },
      include: this.include(),
    });
    if (!t) return { t: null, access: null as null };
    return { t, access: await this.accessTo(r, t) };
  }

  // ─── Activity + notifications ─────────────────────────────────────────────

  private async log(r: TasksRequester, taskId: number, action: string, field?: string, oldV?: any, newV?: any, transaction?: any) {
    const s = (v: any) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, 500));
    await this.db.task_activity_logs.create(
      { task_id: taskId, company_id: r.companyId, user_id: r.userId, action, field: field ?? null, old_value: s(oldV), new_value: s(newV) },
      transaction ? { transaction } : undefined,
    );
  }

  private notify(r: TasksRequester, t: any, userIds: (number | null | undefined)[], type: string, title: string, body?: string) {
    return this.notifications.notify({
      companyId: r.companyId,
      userIds: userIds.filter(Boolean).map(Number),
      module: 'tasks',
      type,
      title,
      body: body ?? t.title,
      link: `/app/tasks?task=${t.id}`,
      entityType: 'task',
      entityId: Number(t.id),
      actorId: r.userId,
    });
  }

  private async actorName(r: TasksRequester) {
    const u = await this.db.users.findOne({ where: { id: r.userId }, attributes: USER_ATTRS });
    return userName(u) || 'Someone';
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  async list(r: TasksRequester, q: any) {
    const today = this.today(q.today);
    const a = this.actor(r);
    const where: any = this.visibleWhere(r);
    const and: any[] = [];

    if (q.scope === 'mine') {
      and.push({ [Op.or]: [{ assignee_id: r.userId }, { created_by: r.userId, assignee_id: null }] });
    } else if (q.scope === 'by_me') {
      and.push({ created_by: r.userId, assignee_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: r.userId }] } });
    } else if (q.scope === 'team' && !a.isManager) {
      return fail('Only managers can see everyone’s tasks', 403);
    }

    const csv = (v: any) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (q.status) where.status = { [Op.in]: csv(q.status) };
    if (q.type) where.type = { [Op.in]: csv(q.type) };
    if (q.priority) where.priority = { [Op.in]: csv(q.priority) };
    if (q.assignee_id) where.assignee_id = Number(q.assignee_id);
    if (q.parent_id) where.parent_id = Number(q.parent_id);
    if (isIsoDate(q.due_from) || isIsoDate(q.due_to)) {
      where.due_date = {
        ...(isIsoDate(q.due_from) ? { [Op.gte]: q.due_from } : {}),
        ...(isIsoDate(q.due_to) ? { [Op.lte]: q.due_to } : {}),
      };
    }
    if (q.q) {
      const term = String(q.q).trim().slice(0, 100);
      const num = Number(term.replace(/^[A-Za-z]{2}-/, ''));
      and.push({
        [Op.or]: [
          { title: { [Op.like]: `%${term}%` } },
          ...(Number.isInteger(num) && num > 0 ? [{ task_number: num }] : []),
        ],
      });
    }
    // Done items: hidden by default; `done_days=N` shows those completed in the last N days.
    if (!q.status) {
      const days = Number(q.done_days);
      if (q.include_done === 'true') {
        // all
      } else if (days > 0) {
        const since = new Date(Date.now() - Math.min(days, 365) * 86400000);
        and.push({ [Op.or]: [{ status: { [Op.ne]: 'DONE' } }, { completed_at: { [Op.gte]: since } }] });
      } else {
        and.push({ status: { [Op.ne]: 'DONE' } });
      }
    }
    if (and.length) where[Op.and] = [...(where[Op.and] || []), ...and];

    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
    const page = Math.max(Number(q.page) || 1, 1);
    const { rows, count } = await this.Tasks.findAndCountAll({
      where,
      include: this.include(),
      order: [
        [this.dbProvider.sequelize.literal('due_date IS NULL'), 'ASC'],
        ['due_date', 'ASC'],
        [this.dbProvider.sequelize.literal("FIELD(priority,'URGENT','HIGH','NORMAL','LOW')"), 'ASC'],
        ['created_at', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });
    return ok('Tasks fetched', {
      rows: await this.serialize(r, rows, today),
      pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
    });
  }

  /** Badge + login reminder counts for the current user. */
  async summary(r: TasksRequester, todayIn?: string) {
    const today = this.today(todayIn);
    // Polled for the sidebar badge; any task change in the company bumps 'tasks'.
    const data = await this.cache.wrap(
      { scopes: [companyScope(r.companyId, 'tasks')], key: `u${Number(r.userId)}:summary:${today}`, ttl: 300 },
      () => this.computeSummary(r, today),
    );
    return ok('Task summary fetched', data);
  }

  private async computeSummary(r: TasksRequester, today: string) {
    const mine = {
      company_id: r.companyId,
      is_deleted: 0,
      status: { [Op.ne]: 'DONE' },
      [Op.or]: [{ assignee_id: r.userId }, { created_by: r.userId, assignee_id: null }],
    };
    const [open, overdue, dueToday, waiting] = await Promise.all([
      this.Tasks.count({ where: mine }),
      this.Tasks.count({ where: { ...mine, due_date: { [Op.lt]: today } } }),
      this.Tasks.count({ where: { ...mine, due_date: today } }),
      this.Tasks.count({
        where: {
          company_id: r.companyId,
          is_deleted: 0,
          status: { [Op.ne]: 'DONE' },
          created_by: r.userId,
          assignee_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: r.userId }] },
        },
      }),
    ]);
    return { today, open, overdue, due_today: dueToday, waiting_on_others: waiting };
  }

  async getOne(r: TasksRequester, id: number, todayIn?: string) {
    const today = this.today(todayIn);
    const { t, access } = await this.findOwned(r, id);
    if (!t || !access) return fail('Task not found', 404);
    const full = access === 'full' ? new Set([Number(t.id)]) : new Set<number>();
    const [item] = await this.serialize(r, [t], today, { full });

    const childrenRows: any[] = await this.Tasks.findAll({
      where: { parent_id: t.id, company_id: r.companyId, is_deleted: 0 },
      include: this.include(),
      order: [['created_at', 'ASC']],
    });
    const a = this.actor(r);
    const fullKids = new Set<number>(
      childrenRows.filter((c) => hasFullAccess(c, a)).map((c) => Number(c.id)),
    );
    const children = await this.serialize(r, childrenRows, today, { full: fullKids });

    const [comments, activity] = await Promise.all([
      this.db.task_comments.findAll({
        where: { task_id: t.id, company_id: r.companyId },
        include: [{ model: this.db.users, as: 'user', attributes: USER_ATTRS, required: false }],
        order: [['created_at', 'ASC'], ['id', 'ASC']],
      }),
      this.db.task_activity_logs.findAll({
        where: { task_id: t.id, company_id: r.companyId },
        include: [{ model: this.db.users, as: 'user', attributes: USER_ATTRS, required: false }],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit: 100,
      }),
    ]);

    return ok('Task fetched', {
      ...item,
      allowed_child_types: ALLOWED_CHILDREN[t.type as TaskType].filter(
        (ct) => ct !== 'EPIC',
      ),
      children,
      comments: comments.map((c: any) => ({
        id: Number(c.id),
        kind: c.kind,
        body: c.body,
        user: userRef(c.user),
        created_at: c.created_at,
      })),
      activity: activity.map((l: any) => ({
        id: Number(l.id),
        action: l.action,
        field: l.field,
        old_value: l.old_value,
        new_value: l.new_value,
        user: userRef(l.user),
        created_at: l.created_at,
      })),
    });
  }

  /** Nested descendants of an item (e.g. an Epic) with per-node access. */
  async tree(r: TasksRequester, id: number, todayIn?: string) {
    const today = this.today(todayIn);
    const { t, access } = await this.findOwned(r, id);
    if (!t || !access) return fail('Task not found', 404);
    const a = this.actor(r);

    const all: any[] = [t];
    let frontier = [Number(t.id)];
    for (let d = 0; d < MAX_DEPTH && frontier.length; d++) {
      const rows: any[] = await this.Tasks.findAll({
        where: { parent_id: { [Op.in]: frontier }, company_id: r.companyId, is_deleted: 0 },
        include: this.include(),
        order: [['created_at', 'ASC']],
      });
      all.push(...rows);
      frontier = rows.map((x) => Number(x.id));
    }
    // A node is fully accessible if the user has full access to it; anything
    // else in the subtree of a visible item is readable.
    const full = new Set<number>(all.filter((x) => hasFullAccess(x, a)).map((x) => Number(x.id)));
    const items = await this.serialize(r, all, today, { full });
    const byParent = new Map<number, any[]>();
    items.forEach((x) => {
      if (x.parent_id) {
        const list = byParent.get(x.parent_id) || [];
        list.push(x);
        byParent.set(x.parent_id, list);
      }
    });
    const build = (node: any): any => ({ ...node, children: (byParent.get(node.id) || []).map(build) });
    return ok('Task tree fetched', build(items[0]));
  }

  /** Epics the user can see: own/assigned, or above their own work. */
  async epics(r: TasksRequester, q: any) {
    const today = this.today(q.today);
    const a = this.actor(r);
    const where: any = { company_id: r.companyId, is_deleted: 0, type: 'EPIC' };
    if (q.include_done !== 'true') where.status = { [Op.ne]: 'DONE' };
    if (!a.isManager) {
      const mine: any[] = await this.Tasks.findAll({
        where: this.visibleWhere(r),
        attributes: ['id', 'parent_id', 'type'],
      });
      const anc = await this.ancestorsOf(r.companyId, mine);
      const epicIds = new Set<number>([
        ...mine.filter((m) => m.type === 'EPIC').map((m) => Number(m.id)),
        ...[...anc.values()].filter((x) => x.type === 'EPIC').map((x) => Number(x.id)),
      ]);
      if (!epicIds.size) return ok('Epics fetched', []);
      where.id = { [Op.in]: [...epicIds] };
    }
    const rows: any[] = await this.Tasks.findAll({
      where,
      include: this.include(),
      order: [[this.dbProvider.sequelize.literal('due_date IS NULL'), 'ASC'], ['due_date', 'ASC'], ['created_at', 'DESC']],
    });
    const items = await this.serialize(r, rows, today);
    // Overdue descendants per epic, for the "at risk" flag.
    const desc = await this.descendantsOf(r.companyId, rows.map((x) => Number(x.id)));
    return ok(
      'Epics fetched',
      items.map((e) => ({
        ...e,
        overdue_items: (desc.get(e.id) || []).filter((d) => isOverdue(d, today)).length,
      })),
    );
  }

  async calendar(r: TasksRequester, q: any) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to)) return fail('from and to must be YYYY-MM-DD');
    const span = (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86400000;
    if (span < 0 || span > 62) return fail('Date range must be between 0 and 62 days');
    const today = this.today(q.today);
    const where: any = { ...this.visibleWhere(r), due_date: { [Op.between]: [q.from, q.to] } };
    if (q.scope === 'mine') {
      where[Op.and] = [{ [Op.or]: [{ assignee_id: r.userId }, { created_by: r.userId, assignee_id: null }] }];
    }
    const rows: any[] = await this.Tasks.findAll({
      where,
      include: this.include(),
      order: [['due_date', 'ASC'], ['due_time', 'ASC']],
      limit: 1000,
    });
    return ok('Calendar fetched', await this.serialize(r, rows, today));
  }

  /** Manager dashboard: per person, totals, completed per day, epic health. */
  async overview(r: TasksRequester, q: any) {
    if (!this.actor(r).isManager) return fail('Only managers can see the team overview', 403);
    const today = this.today(q.today);
    const to = isIsoDate(q.to) ? q.to : today;
    const from = isIsoDate(q.from) ? q.from : new Date(new Date(`${to}T00:00:00`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
    if (from > to) return fail('from must be before to');
    const seq = this.dbProvider.sequelize;
    const rep = { companyId: r.companyId, today, from, to };

    const perUser: any[] = await seq.query(
      `SELECT assignee_id AS user_id,
              SUM(status <> 'DONE') AS open,
              SUM(status <> 'DONE' AND due_date < :today) AS overdue,
              SUM(status <> 'DONE' AND due_date = :today) AS due_today,
              SUM(status = 'DONE' AND DATE(completed_at) BETWEEN :from AND :to) AS done_in_range
         FROM tasks
        WHERE company_id = :companyId AND is_deleted = 0 AND assignee_id IS NOT NULL
        GROUP BY assignee_id`,
      { replacements: rep, type: QueryTypes.SELECT },
    );
    const perDay: any[] = await seq.query(
      `SELECT DATE_FORMAT(completed_at, '%Y-%m-%d') AS day, COUNT(*) AS done
         FROM tasks
        WHERE company_id = :companyId AND is_deleted = 0 AND status = 'DONE'
          AND DATE(completed_at) BETWEEN :from AND :to
        GROUP BY day ORDER BY day`,
      { replacements: rep, type: QueryTypes.SELECT },
    );
    const createdPerDay: any[] = await seq.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS created
         FROM tasks
        WHERE company_id = :companyId AND is_deleted = 0
          AND DATE(created_at) BETWEEN :from AND :to
        GROUP BY day ORDER BY day`,
      { replacements: rep, type: QueryTypes.SELECT },
    );
    const [totals]: any[] = await seq.query(
      `SELECT SUM(status <> 'DONE') AS open,
              SUM(status <> 'DONE' AND due_date < :today) AS overdue,
              SUM(status <> 'DONE' AND assignee_id IS NULL) AS unassigned,
              SUM(status = 'DONE' AND DATE(completed_at) BETWEEN :from AND :to) AS done_in_range,
              SUM(DATE(created_at) BETWEEN :from AND :to) AS created_in_range
         FROM tasks WHERE company_id = :companyId AND is_deleted = 0`,
      { replacements: rep, type: QueryTypes.SELECT },
    );

    // Breakdown of everything not deleted, for the status donut / type bars.
    const byStatusRows: any[] = await seq.query(
      `SELECT status, COUNT(*) AS n FROM tasks
        WHERE company_id = :companyId AND is_deleted = 0 GROUP BY status`,
      { replacements: rep, type: QueryTypes.SELECT },
    );
    const byTypeRows: any[] = await seq.query(
      `SELECT type, SUM(status <> 'DONE') AS open, SUM(status = 'DONE') AS done FROM tasks
        WHERE company_id = :companyId AND is_deleted = 0 GROUP BY type`,
      { replacements: rep, type: QueryTypes.SELECT },
    );

    const people = await this.assignableUsers(r.companyId);
    const statsBy = new Map(perUser.map((p) => [Number(p.user_id), p]));
    const n = (v: any) => Number(v || 0);
    const users = people
      .map((p) => {
        const s: any = statsBy.get(p.id) || {};
        return { ...p, open: n(s.open), overdue: n(s.overdue), due_today: n(s.due_today), done_in_range: n(s.done_in_range) };
      })
      .sort((x, y) => y.overdue - x.overdue || y.open - x.open || x.name.localeCompare(y.name));

    // Fill every day of the range so the chart has no gaps.
    const days: { day: string; done: number; created: number }[] = [];
    const doneBy = new Map(perDay.map((d) => [d.day, n(d.done)]));
    const createdBy = new Map(createdPerDay.map((d) => [d.day, n(d.created)]));
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to && days.length < 370; d = new Date(d.getTime() + 86400000)) {
      const key = d.toISOString().slice(0, 10);
      days.push({ day: key, done: doneBy.get(key) || 0, created: createdBy.get(key) || 0 });
    }

    const epics = (await this.epics(r, { today })) as any;
    return ok('Overview fetched', {
      from,
      to,
      today,
      totals: {
        open: n(totals?.open),
        overdue: n(totals?.overdue),
        unassigned: n(totals?.unassigned),
        done_in_range: n(totals?.done_in_range),
        created_in_range: n(totals?.created_in_range),
      },
      users,
      days,
      by_status: Object.fromEntries(byStatusRows.map((s) => [s.status, n(s.n)])),
      by_type: Object.fromEntries(byTypeRows.map((t) => [t.type, { open: n(t.open), done: n(t.done) }])),
      epics: epics.success ? epics.data : [],
    });
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  async create(r: TasksRequester, dto: CreateTaskDto) {
    const log = this.appLogger.forContext('TasksService', 'create', { companyId: r.companyId });
    const a = this.actor(r);
    const type = dto.type as TaskType;
    if (!this.canCreate(r)) return fail("You don't have permission to create tasks", 403);
    if (type === 'EPIC' && !a.isManager) return fail('Only managers can create epics', 403);

    let parent: any = null;
    if (dto.parent_id) {
      parent = await this.Tasks.findOne({ where: { id: dto.parent_id, company_id: r.companyId, is_deleted: 0 } });
      if (!parent) return fail('Parent item not found', 404);
      if (!hasFullAccess(parent, a)) return fail("You can't add items under this one", 403);
    }
    const pErr = parentError(type, parent?.type ?? null);
    if (pErr) return fail(pErr);
    const aErr = await this.validateAssignee(r.companyId, dto.assignee_id);
    if (aErr) return fail(aErr);
    const lErr = await this.validateLink(r, dto.link_type, dto.link_id);
    if (lErr) return fail(lErr);

    const status = dto.status ?? 'TODO';
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = await this.dbProvider.sequelize.transaction();
      try {
        const max = await this.Tasks.max('task_number', { where: { company_id: r.companyId }, transaction: tx });
        const created = await this.Tasks.create(
          {
            company_id: r.companyId,
            task_number: Number(max || 0) + 1,
            type,
            parent_id: parent ? parent.id : null,
            title: dto.title.trim(),
            description: dto.description?.trim() || null,
            status,
            priority: dto.priority ?? 'NORMAL',
            assignee_id: dto.assignee_id ?? null,
            created_by: r.userId,
            due_date: dto.due_date ?? null,
            due_time: dto.due_time ?? null,
            link_type: dto.link_type ?? null,
            link_id: dto.link_type ? dto.link_id : null,
            completed_at: status === 'DONE' ? new Date() : null,
          },
          { transaction: tx },
        );
        await this.log(r, created.id, 'CREATED', null as any, null, `${TYPE_LABEL[type]}: ${created.title}`, tx);
        await tx.commit();

        if (created.assignee_id && Number(created.assignee_id) !== Number(r.userId)) {
          const who = await this.actorName(r);
          await this.notify(r, created, [created.assignee_id], 'TASK_ASSIGNED',
            `${who} assigned you ${taskKey(type, created.task_number)}`);
        }
        log.info('Task created', { taskId: created.id });
        return this.getOne(r, Number(created.id));
      } catch (err) {
        await tx.rollback();
        if (err instanceof UniqueConstraintError && attempt < 4) continue; // number race — retry
        log.error('Failed to create task', err);
        throw new Error('DATABASE_ERROR');
      }
    }
    return fail('Could not create the task, please try again', 409);
  }

  async update(r: TasksRequester, id: number, dto: UpdateTaskDto) {
    const log = this.appLogger.forContext('TasksService', 'update', { companyId: r.companyId, taskId: id });
    const a = this.actor(r);
    const t: any = await this.Tasks.findOne({ where: { id, company_id: r.companyId, is_deleted: 0 } });
    if (!t) return fail('Task not found', 404);
    const full = hasFullAccess(t, a);
    if (!full) return fail("You can't edit this item", 403);
    const can = capabilities(t, a, full, this.canCreate(r));

    const changes: Record<string, any> = {};
    const has = (k: keyof UpdateTaskDto) => Object.prototype.hasOwnProperty.call(dto, k);

    if (has('title') && dto.title!.trim() !== t.title) changes.title = dto.title!.trim();
    if (has('description')) {
      const d = dto.description ? dto.description.trim() : null;
      if ((d || null) !== (t.description || null)) changes.description = d || null;
    }
    if (has('priority') && dto.priority !== t.priority) changes.priority = dto.priority;
    if (has('due_date') && (dto.due_date ?? null) !== (t.due_date ?? null)) changes.due_date = dto.due_date ?? null;
    if (has('due_time')) {
      const cur = t.due_time ? String(t.due_time).slice(0, 5) : null;
      if ((dto.due_time ?? null) !== cur) changes.due_time = dto.due_time ?? null;
    }
    if (has('status') && dto.status !== t.status) {
      if (!can.status) return fail("You can't change the status of this item", 403);
      changes.status = dto.status;
      changes.completed_at = dto.status === 'DONE' ? new Date() : null;
    }
    if (has('assignee_id') && (dto.assignee_id ?? null) !== (t.assignee_id != null ? Number(t.assignee_id) : null)) {
      if (!can.assign) return fail('Only the creator or a manager can reassign this item', 403);
      const aErr = await this.validateAssignee(r.companyId, dto.assignee_id);
      if (aErr) return fail(aErr);
      changes.assignee_id = dto.assignee_id ?? null;
    }
    if (has('parent_id') && (dto.parent_id ?? null) !== (t.parent_id != null ? Number(t.parent_id) : null)) {
      if (!can.move) return fail('Only the creator or a manager can move this item', 403);
      let parent: any = null;
      if (dto.parent_id) {
        if (Number(dto.parent_id) === Number(t.id)) return fail('An item cannot be its own parent');
        parent = await this.Tasks.findOne({ where: { id: dto.parent_id, company_id: r.companyId, is_deleted: 0 } });
        if (!parent) return fail('Parent item not found', 404);
        if (!hasFullAccess(parent, a)) return fail("You can't move items under that one", 403);
      }
      const pErr = parentError(t.type, parent?.type ?? null);
      if (pErr) return fail(pErr);
      changes.parent_id = parent ? parent.id : null;
    }
    if (has('link_type') || has('link_id')) {
      const lt = has('link_type') ? dto.link_type ?? null : t.link_type;
      const li = lt ? (has('link_id') ? dto.link_id ?? null : t.link_id) : null;
      if (lt !== t.link_type || Number(li || 0) !== Number(t.link_id || 0)) {
        const lErr = await this.validateLink(r, lt, li);
        if (lErr) return fail(lErr);
        changes.link_type = lt;
        changes.link_id = li;
      }
    }
    if (!Object.keys(changes).length) return this.getOne(r, id);

    const before = { ...t.get() };
    const tx = await this.dbProvider.sequelize.transaction();
    try {
      await t.update(changes, { transaction: tx });
      for (const [field, value] of Object.entries(changes)) {
        if (field === 'completed_at') continue;
        if (field === 'description') {
          await this.log(r, t.id, 'UPDATED', 'description', null, null, tx);
          continue;
        }
        await this.log(r, t.id, field === 'status' ? 'STATUS_CHANGED' : field === 'assignee_id' ? 'ASSIGNED' : 'UPDATED',
          field, before[field] ?? null, value ?? null, tx);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      log.error('Failed to update task', err);
      throw new Error('DATABASE_ERROR');
    }

    const key = taskKey(t.type, t.task_number);
    const who = await this.actorName(r);
    if (changes.assignee_id) {
      await this.notify(r, t, [changes.assignee_id], 'TASK_ASSIGNED', `${who} assigned you ${key}`);
    }
    if (changes.status === 'DONE') {
      await this.notify(r, t, [t.created_by], 'TASK_COMPLETED', `${who} completed ${key}`);
    } else if (changes.status) {
      await this.notify(r, t, [t.created_by], 'TASK_STATUS', `${who} moved ${key} to ${String(changes.status).replace('_', ' ').toLowerCase()}`);
    }
    return this.getOne(r, id);
  }

  async remove(r: TasksRequester, id: number) {
    const a = this.actor(r);
    const t: any = await this.Tasks.findOne({ where: { id, company_id: r.companyId, is_deleted: 0 } });
    if (!t) return fail('Task not found', 404);
    if (!capabilities(t, a, hasFullAccess(t, a), this.canCreate(r)).delete) {
      return fail('Only the creator or a manager can delete this item', 403);
    }
    const desc = (await this.descendantsOf(r.companyId, [Number(t.id)])).get(Number(t.id)) || [];
    if (!a.isManager && desc.some((d) => Number(d.created_by) !== Number(r.userId))) {
      return fail('This item has child items created by other people. Ask a manager to delete it, or move those items first.', 403);
    }
    const ids = [Number(t.id), ...desc.map((d) => Number(d.id))];
    const tx = await this.dbProvider.sequelize.transaction();
    try {
      await this.Tasks.update(
        { is_deleted: 1, deleted_at: new Date() },
        { where: { id: { [Op.in]: ids }, company_id: r.companyId }, transaction: tx },
      );
      await this.log(r, t.id, 'DELETED', null as any, null, desc.length ? `with ${desc.length} child item(s)` : null, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw new Error('DATABASE_ERROR');
    }
    return ok('Deleted', { id: Number(t.id), deleted: ids.length });
  }

  async comment(r: TasksRequester, id: number, dto: CommentDto) {
    const { t, access } = await this.findOwned(r, id);
    if (!t || !access) return fail('Task not found', 404);
    const c = await this.db.task_comments.create({
      task_id: t.id, company_id: r.companyId, user_id: r.userId, kind: 'COMMENT', body: dto.body.trim(),
    });
    const who = await this.actorName(r);
    await this.notify(r, t, [t.created_by, t.assignee_id], 'TASK_COMMENT',
      `${who} commented on ${taskKey(t.type, t.task_number)}`, dto.body.trim());
    return ok('Comment added', { id: Number(c.id) });
  }

  async followUp(r: TasksRequester, id: number, dto: FollowUpDto) {
    const { t, access } = await this.findOwned(r, id);
    if (!t || !access) return fail('Task not found', 404);
    if (t.status === 'DONE') return fail('This item is already done');
    const target = t.assignee_id ? Number(t.assignee_id) : Number(t.created_by);
    if (target === Number(r.userId)) return fail('You are the one working on this item');

    const recent = await this.db.task_comments.findOne({
      where: {
        task_id: t.id,
        user_id: r.userId,
        kind: 'FOLLOW_UP',
        created_at: { [Op.gte]: new Date(Date.now() - FOLLOW_UP_COOLDOWN_MS) },
      },
    });
    if (recent) return fail('You already followed up in the last 10 minutes', 429);

    const who = await this.actorName(r);
    const msg = dto.message?.trim() || 'Any update on this?';
    await this.db.task_comments.create({
      task_id: t.id, company_id: r.companyId, user_id: r.userId, kind: 'FOLLOW_UP', body: msg,
    });
    await this.notify(r, t, [target], 'TASK_FOLLOW_UP',
      `${who} is asking for an update on ${taskKey(t.type, t.task_number)}`, msg);
    return ok('Follow-up sent', { to: target });
  }
}
