import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { type ActionStatus, type AiSettings, CONFIRM_TTL_MINUTES, type RecordType, recordLink, settingsFrom, type ToolKind } from './ai-agent.rules';

const num = (v: unknown) => Number(v) || 0;
const parse = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};
/** UTC timestamps as ISO strings (the connection runs in UTC). */
const ISO = (col: string) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%sZ')`;
/** An action's columns, optionally through a table alias. */
const actionCols = (alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `${p}id, ${p}company_id, ${p}user_id, ${p}conversation_id, ${p}tool, ${p}kind, ${p}summary, ${p}details, ${p}args, ${p}status, ${p}result,
    ${p}record_type, ${p}record_id, ${p}record_label, ${ISO(`${p}created_at`)} AS created_at, ${ISO(`${p}decided_at`)} AS decided_at,
    ${ISO(`${p}expires_at`)} AS expires_at`;
};

export interface MessageMeta {
  steps?: string[];
  actions?: number[];
  records?: { type: RecordType; id: number; label: string }[];
  document?: { name: string; text?: string };
  error?: boolean;
  /** A line saying how a confirmed / cancelled action ended. */
  outcome?: number;
}

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  meta: MessageMeta;
  tokens: number | null;
  created_at: string;
}

export interface ActionView {
  id: number;
  tool: string;
  kind: ToolKind;
  summary: string;
  details: string[];
  status: ActionStatus;
  result: string | null;
  record: { type: RecordType; id: number; label: string; link: string } | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
}

/**
 * Everything the AI Assistant keeps: chats, messages, the activity log of
 * actions (and the ones waiting for Confirm), per-company settings and usage.
 * Every query is scoped to the company (and the person, for their own chats).
 */
@Injectable()
export class AiStoreService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  private q(sql: string, replacements: Record<string, unknown> = {}) {
    return this.db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<any[]>;
  }

  private async exec(sql: string, replacements: Record<string, unknown> = {}): Promise<{ insertId: number; affected: number }> {
    const [result, meta]: any = await this.db.sequelize.query(sql, { replacements });
    // INSERT → [insertId, affectedRows]; UPDATE/DELETE → [ResultSetHeader, ...] depending on the dialect version.
    const header = typeof result === 'object' && result !== null ? result : typeof meta === 'object' && meta !== null ? meta : {};
    return {
      insertId: typeof result === 'number' ? result : num(header.insertId),
      affected: typeof meta === 'number' ? meta : num(header.affectedRows ?? header.changedRows),
    };
  }

  // ── Who is asking ──────────────────────────────────────────────────────────

  async whoAmI(companyId: number, userId: number) {
    const [x] = await this.q(
      `SELECT TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS person, u.designation, c.name AS company
       FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = :u AND u.company_id = :c`,
      { u: userId, c: companyId },
    );
    return { person: String(x?.person || '').trim() || 'there', designation: x?.designation || null, company: String(x?.company || 'your company') };
  }

  // ── Settings & usage ───────────────────────────────────────────────────────

  async settings(companyId: number): Promise<AiSettings> {
    const [row] = await this.q(`SELECT allow_changes, daily_limit FROM ai_agent_settings WHERE company_id = :c`, { c: companyId });
    return settingsFrom(row);
  }

  async saveSettings(companyId: number, userId: number, s: AiSettings) {
    await this.exec(
      `INSERT INTO ai_agent_settings (company_id, allow_changes, daily_limit, updated_by, updated_at)
       VALUES (:c, :a, :l, :u, NOW())
       ON DUPLICATE KEY UPDATE allow_changes = VALUES(allow_changes), daily_limit = VALUES(daily_limit),
                               updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      { c: companyId, a: s.allow_changes ? 1 : 0, l: s.daily_limit, u: userId },
    );
  }

  /** Messages this person sent since their local midnight. */
  async sentToday(companyId: number, userId: number, tz: number) {
    const [x] = await this.q(
      `SELECT COUNT(*) AS n FROM ai_agent_messages
       WHERE company_id = :c AND user_id = :u AND role = 'user'
         AND created_at >= DATE(NOW() + INTERVAL :tz MINUTE) - INTERVAL :tz MINUTE`,
      { c: companyId, u: userId, tz },
    );
    return num(x?.n);
  }

  /** This month (local time) per person: messages, AI usage and actions done. */
  async monthUsage(companyId: number, tz: number) {
    const start = `CAST(DATE_FORMAT(NOW() + INTERVAL :tz MINUTE, '%Y-%m-01') AS DATETIME) - INTERVAL :tz MINUTE`;
    const [people, actions, [range]] = await Promise.all([
      this.q(
        `SELECT m.user_id, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name, u.email,
                SUM(m.role = 'user') AS messages, COALESCE(SUM(m.tokens), 0) AS tokens, ${ISO('MAX(m.created_at)')} AS last_at
         FROM ai_agent_messages m LEFT JOIN users u ON u.id = m.user_id
         WHERE m.company_id = :c AND m.created_at >= ${start}
         GROUP BY m.user_id ORDER BY messages DESC`,
        { c: companyId, tz },
      ),
      this.q(
        `SELECT user_id, SUM(status = 'DONE') AS done, SUM(status = 'PENDING') AS waiting
         FROM ai_agent_actions WHERE company_id = :c AND created_at >= ${start} GROUP BY user_id`,
        { c: companyId, tz },
      ),
      this.q(`SELECT DATE_FORMAT(NOW() + INTERVAL :tz MINUTE, '%Y-%m-01') AS month_start`, { tz }),
    ]);
    const done = new Map(actions.map((a) => [num(a.user_id), { done: num(a.done), waiting: num(a.waiting) }]));
    const rows = people.map((p) => ({
      user_id: num(p.user_id),
      name: String(p.name || '').trim() || p.email || `User #${p.user_id}`,
      messages: num(p.messages),
      tokens: num(p.tokens),
      actions: done.get(num(p.user_id))?.done || 0,
      last_at: p.last_at,
    }));
    return {
      month_start: range?.month_start ?? null,
      people: rows,
      totals: {
        messages: rows.reduce((s, r) => s + r.messages, 0),
        tokens: rows.reduce((s, r) => s + r.tokens, 0),
        actions: rows.reduce((s, r) => s + r.actions, 0),
        people: rows.length,
      },
    };
  }

  // ── Chats ──────────────────────────────────────────────────────────────────

  async createConversation(companyId: number, userId: number, title: string) {
    const r = await this.exec(
      `INSERT INTO ai_agent_conversations (company_id, user_id, title, created_at, updated_at) VALUES (:c, :u, :t, NOW(), NOW())`,
      { c: companyId, u: userId, t: title.slice(0, 120) },
    );
    return r.insertId;
  }

  /** The person's own chat, or null. */
  async conversationOf(companyId: number, userId: number, id: number) {
    const [x] = await this.q(
      `SELECT id, title, ${ISO('created_at')} AS created_at, ${ISO('updated_at')} AS updated_at
       FROM ai_agent_conversations WHERE id = :id AND company_id = :c AND user_id = :u`,
      { id, c: companyId, u: userId },
    );
    return x ? { id: num(x.id), title: String(x.title), created_at: x.created_at, updated_at: x.updated_at } : null;
  }

  async touchConversation(id: number) {
    await this.exec(`UPDATE ai_agent_conversations SET updated_at = NOW() WHERE id = :id`, { id });
  }

  async renameConversation(companyId: number, userId: number, id: number, title: string) {
    if (!(await this.conversationOf(companyId, userId, id))) return false;
    await this.exec(`UPDATE ai_agent_conversations SET title = :t WHERE id = :id AND company_id = :c AND user_id = :u`, {
      t: title.slice(0, 120),
      id,
      c: companyId,
      u: userId,
    });
    return true;
  }

  async listConversations(companyId: number, userId: number, limit = 60) {
    const rows = await this.q(
      `SELECT c.id, c.title, ${ISO('c.updated_at')} AS updated_at,
              (SELECT COUNT(*) FROM ai_agent_messages m WHERE m.conversation_id = c.id) AS messages
       FROM ai_agent_conversations c
       WHERE c.company_id = :c AND c.user_id = :u
       ORDER BY c.updated_at DESC, c.id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
      { c: companyId, u: userId },
    );
    return rows.map((r) => ({ id: num(r.id), title: String(r.title), updated_at: r.updated_at, messages: num(r.messages) }));
  }

  /** Deletes the person's own chat and its messages (the activity log keeps its actions). */
  async deleteConversation(companyId: number, userId: number, id: number) {
    const own = await this.conversationOf(companyId, userId, id);
    if (!own) return false;
    await this.exec(`DELETE FROM ai_agent_messages WHERE conversation_id = :id AND company_id = :c AND user_id = :u`, { id, c: companyId, u: userId });
    await this.exec(`UPDATE ai_agent_actions SET status = 'CANCELLED', decided_at = NOW(), result = 'Chat deleted' WHERE conversation_id = :id AND status = 'PENDING'`, { id });
    await this.exec(`DELETE FROM ai_agent_conversations WHERE id = :id AND company_id = :c AND user_id = :u`, { id, c: companyId, u: userId });
    return true;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async addMessage(m: { companyId: number; userId: number; conversationId: number; role: 'user' | 'assistant'; content: string; meta?: MessageMeta; tokens?: number | null }) {
    const r = await this.exec(
      `INSERT INTO ai_agent_messages (user_id, company_id, conversation_id, role, content, meta, tokens, created_at)
       VALUES (:u, :c, :conv, :role, :content, :meta, :tokens, NOW())`,
      {
        u: m.userId,
        c: m.companyId,
        conv: m.conversationId,
        role: m.role,
        content: m.content || ' ',
        meta: m.meta && Object.keys(m.meta).length ? JSON.stringify(m.meta) : null,
        tokens: m.tokens ?? null,
      },
    );
    const [x] = await this.q(`SELECT ${ISO('created_at')} AS at FROM ai_agent_messages WHERE id = :id`, { id: r.insertId });
    return { id: r.insertId, created_at: x?.at ?? new Date().toISOString() };
  }

  private toMessage(r: any): StoredMessage {
    return {
      id: num(r.id),
      role: r.role === 'user' ? 'user' : 'assistant',
      content: String(r.content ?? ''),
      meta: parse<MessageMeta>(r.meta, {}),
      tokens: r.tokens === null || r.tokens === undefined ? null : num(r.tokens),
      created_at: r.created_at,
    };
  }

  /** The latest messages of a chat, oldest first. */
  async recentMessages(conversationId: number, limit: number) {
    const rows = await this.q(
      `SELECT id, role, content, meta, tokens, ${ISO('created_at')} AS created_at FROM ai_agent_messages
       WHERE conversation_id = :id ORDER BY id DESC LIMIT ${Math.max(1, Math.min(100, limit))}`,
      { id: conversationId },
    );
    return rows.reverse().map((r) => this.toMessage(r));
  }

  async messagesOf(conversationId: number, limit = 200) {
    return this.recentMessages(conversationId, limit);
  }

  // ── Actions (activity log + "confirm first") ───────────────────────────────

  private toAction(r: any): ActionView {
    const type = r.record_type as RecordType | null;
    return {
      id: num(r.id),
      tool: String(r.tool),
      kind: r.kind as ToolKind,
      summary: String(r.summary),
      details: parse<string[]>(r.details, []),
      status: r.status as ActionStatus,
      result: r.result ?? null,
      record: type && r.record_id ? { type, id: num(r.record_id), label: String(r.record_label || ''), link: recordLink(type, num(r.record_id)) } : null,
      created_at: r.created_at,
      decided_at: r.decided_at ?? null,
      expires_at: r.expires_at ?? null,
    };
  }

  async addAction(a: {
    companyId: number;
    userId: number;
    conversationId: number | null;
    tool: string;
    kind: ToolKind;
    summary: string;
    details?: string[];
    args: Record<string, any>;
    status: ActionStatus;
    result?: string | null;
    record?: { type: RecordType; id: number; label: string } | null;
  }) {
    const r = await this.exec(
      `INSERT INTO ai_agent_actions (company_id, user_id, conversation_id, tool, kind, summary, details, args, status, result,
                                     record_type, record_id, record_label, created_at, decided_at, expires_at)
       VALUES (:c, :u, :conv, :tool, :kind, :summary, :details, :args, :status, :result, :rt, :rid, :rl, NOW(),
               ${a.status === 'PENDING' ? 'NULL' : 'NOW()'}, ${a.status === 'PENDING' ? `NOW() + INTERVAL ${CONFIRM_TTL_MINUTES} MINUTE` : 'NULL'})`,
      {
        c: a.companyId,
        u: a.userId,
        conv: a.conversationId,
        tool: a.tool,
        kind: a.kind,
        summary: a.summary.slice(0, 400),
        details: a.details?.length ? JSON.stringify(a.details.slice(0, 12)) : null,
        args: JSON.stringify(a.args ?? {}),
        status: a.status,
        result: a.result ? String(a.result).slice(0, 500) : null,
        rt: a.record?.type ?? null,
        rid: a.record?.id ?? null,
        rl: a.record?.label ? String(a.record.label).slice(0, 120) : null,
      },
    );
    return r.insertId;
  }

  /** The same action already waiting in this chat (the AI asked twice), if any. */
  async pendingTwin(conversationId: number | null, tool: string, args: Record<string, any>) {
    if (!conversationId) return null;
    const [x] = await this.q(
      `SELECT id FROM ai_agent_actions WHERE conversation_id = :conv AND tool = :tool AND args = :args
         AND status = 'PENDING' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
      { conv: conversationId, tool, args: JSON.stringify(args ?? {}) },
    );
    return x ? num(x.id) : null;
  }

  async action(companyId: number, id: number) {
    const [x] = await this.q(`SELECT ${actionCols()} FROM ai_agent_actions WHERE id = :id AND company_id = :c`, { id, c: companyId });
    return x ? { view: this.toAction(x), args: parse<Record<string, any>>(x.args, {}), user_id: num(x.user_id), conversation_id: x.conversation_id ? num(x.conversation_id) : null } : null;
  }

  async actions(companyId: number, ids: number[]) {
    const list = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
    if (!list.length) return [] as ActionView[];
    const rows = await this.q(`SELECT ${actionCols()} FROM ai_agent_actions WHERE company_id = :c AND id IN (:ids)`, { c: companyId, ids: list });
    return rows.map((r) => this.toAction(r));
  }

  /** Takes a waiting action for running — only one caller can win (double clicks, two tabs). */
  async claim(id: number) {
    const r = await this.exec(`UPDATE ai_agent_actions SET status = 'RUNNING' WHERE id = :id AND status = 'PENDING' AND expires_at > NOW()`, { id });
    return r.affected === 1;
  }

  async finish(id: number, status: ActionStatus, result: string | null, record?: { type: RecordType; id: number; label: string } | null) {
    await this.exec(
      `UPDATE ai_agent_actions SET status = :s, result = :r, decided_at = NOW()
              ${record ? ', record_type = :rt, record_id = :rid, record_label = :rl' : ''}
       WHERE id = :id`,
      { id, s: status, r: result ? String(result).slice(0, 500) : null, ...(record ? { rt: record.type, rid: record.id, rl: String(record.label).slice(0, 120) } : {}) },
    );
  }

  /** Waiting actions past their time become EXPIRED. */
  async expireOld(companyId: number) {
    await this.exec(`UPDATE ai_agent_actions SET status = 'EXPIRED', decided_at = NOW() WHERE company_id = :c AND status = 'PENDING' AND expires_at <= NOW()`, {
      c: companyId,
    });
  }

  /** The company's latest actions, for the admin's activity log. */
  async recentActions(companyId: number, limit = 40) {
    const rows = await this.q(
      `SELECT ${actionCols('a')}, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS by_name
       FROM ai_agent_actions a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.company_id = :c ORDER BY a.id DESC LIMIT ${Math.max(1, Math.min(100, limit))}`,
      { c: companyId },
    );
    return rows.map((r) => ({ ...this.toAction(r), by: String(r.by_name || '').trim() || null }));
  }
}
