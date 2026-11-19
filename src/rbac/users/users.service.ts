import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../../common/logger/logger.service';
import { LogContext } from '../../common/logger/logger.context';
import { AccessService, type ActorContext, type CompanyPerson } from '../access.service';
import { CompanyRolesService } from '../company-roles.service';
import {
  type Verdict,
  ADMIN_LEVEL,
  canGiveRoles,
  canManage,
  canSetManager,
  isPlatformRole,
  keepsAnAdmin,
  moveTeamUp,
  reportsBelow,
} from '../access.rules';

const text = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const must = (v: Verdict) => {
  if (v.ok === false) throw new ForbiddenException(v.reason);
};

/**
 * The company's people: who they are, their job, who they report to and their
 * roles. Every change goes through the hierarchy rules in access.rules.ts.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
    private access: AccessService,
    private companyRoles: CompanyRolesService,
  ) {}

  // ── Reading ─────────────────────────────────────────────────────────────

  /** A person as the screens show them, with whether the caller may change them. */
  private view(p: CompanyPerson, me: ActorContext, byId: Map<number, CompanyPerson>) {
    const manager = p.reports_to ? byId.get(p.reports_to) : undefined;
    const direct = me.people.filter((x) => x.reports_to === p.id && x.is_active).length;
    const team = [...reportsBelow(p.id, me.parentOf)].filter((id) => byId.get(id)?.is_active).length;
    const verdict = canManage(me, { id: p.id, rank: p.rank, name: p.first_name || p.name, platform: p.platform }, me.parentOf);
    return {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      name: p.name,
      email: p.email,
      phone: p.phone,
      designation: p.designation,
      department: p.department,
      reports_to: p.reports_to,
      manager: manager ? { id: manager.id, name: manager.name, designation: manager.designation } : null,
      is_active: p.is_active,
      last_login: p.last_login,
      created_at: p.created_at,
      roles: p.roles.map((r) => ({ id: r.id, name: r.name, level: r.level, scope: r.scope })),
      rank: p.rank,
      admin: p.admin,
      platform: p.platform,
      direct_reports: direct,
      team_size: team,
      is_me: p.id === me.id,
      can_manage: verdict.ok,
      why_not: verdict.ok ? null : verdict.reason,
    };
  }

  /** Roles the caller may give, highest first. */
  private async assignableRoles(companyId: number, me: ActorContext) {
    await this.companyRoles.ensureDefaults(companyId);
    const roles: any[] = await this.db.db.roles.findAll({
      where: { company_id: companyId, scope: 'COMPANY' },
      order: [['level', 'ASC'], ['name', 'ASC']],
    });
    return roles
      .filter((r) => canGiveRoles(me, [{ name: r.name, level: Number(r.level) }]).ok)
      .map((r) => ({ id: Number(r.id), name: r.name, level: Number(r.level), description: r.description ?? null, is_system: Number(r.is_system) || 0 }));
  }

  /**
   * Everything the Team page needs in one go: every person (active and
   * deactivated), the caller's own standing, the roles and managers they may
   * pick, and a few counts.
   */
  async team(companyId: number, userId: number) {
    const me = await this.access.actor(userId, companyId);
    const byId = new Map(me.people.map((p) => [p.id, p]));
    const people = me.people.map((p) => this.view(p, me, byId));
    const active = me.people.filter((p) => p.is_active);
    const below = reportsBelow(me.id, me.parentOf);
    const managerChoices = me.admin ? active.map((p) => p.id) : [me.id, ...[...below].filter((id) => byId.get(id)?.is_active)];
    return {
      people,
      me: {
        id: me.id,
        rank: me.rank,
        admin: me.admin,
        platform: me.platform,
        can_create: me.permissions.includes('users.create'),
        can_edit: me.permissions.includes('users.edit'),
        can_deactivate: me.permissions.includes('users.delete'),
        team: [...below],
        manager_choices: managerChoices,
        assignable_roles: await this.assignableRoles(companyId, me),
      },
      stats: {
        active: active.length,
        deactivated: me.people.length - active.length,
        admins: AccessService.activeAdmins(me.people).length,
        managers: active.filter((p) => active.some((x) => x.reports_to === p.id)).length,
        departments: new Set(active.map((p) => (p.department || '').trim().toLowerCase()).filter(Boolean)).size,
        without_manager: active.filter((p) => !p.reports_to && !p.admin).length,
      },
    };
  }

  /** The paged list (kept for older screens); active people unless `status` says otherwise. */
  async listUsers(companyId: number, page = 1, limit = 10, search?: string, userId?: number, status = 'active') {
    const me = await this.access.actor(Number(userId), companyId);
    const byId = new Map(me.people.map((p) => [p.id, p]));
    const q = String(search || '').trim().toLowerCase();
    const rows = me.people
      .filter((p) => (status === 'all' ? true : status === 'inactive' ? !p.is_active : p.is_active))
      .filter((p) => !q || [p.name, p.email, p.designation, p.department, p.phone].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    const size = Math.max(1, Math.min(Number(limit) || 10, 500));
    const p = Math.max(1, Number(page) || 1);
    return {
      users: rows.slice((p - 1) * size, p * size).map((x) => this.view(x, me, byId)),
      pagination: { total: rows.length, page: p, limit: size, pages: Math.ceil(rows.length / size) },
    };
  }

  async getUserById(companyId: number, userId: number, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    const p = me.people.find((x) => x.id === Number(userId));
    if (!p) throw new NotFoundException('User not found');
    return this.view(p, me, new Map(me.people.map((x) => [x.id, x])));
  }

  /** Roles the caller may give (the add / edit form). */
  async getRoles(companyId: number, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    return this.assignableRoles(companyId, me);
  }

  // ── Checks shared by create / update ────────────────────────────────────

  private async rolesById(companyId: number, roleIds: unknown) {
    if (!Array.isArray(roleIds)) throw new BadRequestException('role_ids must be a list');
    const ids = [...new Set(roleIds.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new BadRequestException('role_ids must contain role ids');
    if (!ids.length) return [];
    const roles: any[] = await this.db.db.roles.findAll({ where: { id: { [Op.in]: ids } } });
    const bad = roles.filter((r) => isPlatformRole({ scope: r.scope || 'COMPANY' }));
    if (bad.length) throw new ForbiddenException('Super Admin is a platform role and can only be given from the platform console');
    if (roles.length !== ids.length || roles.some((r) => Number(r.company_id) !== Number(companyId))) {
      throw new BadRequestException('One or more roles are not roles of your company');
    }
    return roles.map((r) => ({ id: Number(r.id), name: r.name, level: Number(r.level), scope: String(r.scope || 'COMPANY') }));
  }

  private async emailFree(email: string, exceptId?: number) {
    const taken = await this.db.db.users.findOne({
      where: { email, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
      attributes: ['id'],
    });
    if (taken) throw new ConflictException('Someone already uses this email address');
  }

  private managerId(me: ActorContext, raw: unknown): number | null {
    if (raw === null || raw === '' || raw === undefined) return null;
    const id = Number(raw);
    const m = me.people.find((p) => p.id === id);
    if (!Number.isInteger(id) || !m) throw new BadRequestException('The manager must be someone in your company');
    if (!m.is_active) throw new BadRequestException(`${m.name} is deactivated — pick an active manager`);
    return id;
  }

  /** Active Admins left if `personId` ends up with `roleLevels` / active state. */
  private adminsAfter(me: ActorContext, personId: number, change: { active?: boolean; admin?: boolean }) {
    return me.people.filter((p) => {
      const isTarget = p.id === personId;
      const active = isTarget && change.active !== undefined ? change.active : p.is_active;
      const admin = isTarget && change.admin !== undefined ? change.admin : p.admin;
      return active && admin;
    }).length;
  }

  // ── Changing ────────────────────────────────────────────────────────────

  async createUser(companyId: number, payload: any, callerId?: number) {
    const ctx = new LogContext('UsersService', 'createUser', { companyId });
    const me = await this.access.actor(Number(callerId), companyId);

    const first = text(payload?.first_name, 100);
    const email = String(payload?.email || '').trim().toLowerCase();
    if (!first) throw new BadRequestException('Enter a first name');
    if (!emailOk(email)) throw new BadRequestException('Enter a valid email address');
    if (String(payload?.password || '').length < 8) throw new BadRequestException('The password needs at least 8 characters');

    const roles = await this.rolesById(companyId, payload?.role_ids ?? []);
    if (!roles.length) throw new BadRequestException('Give the person at least one role');
    must(canGiveRoles(me, roles));

    // Someone added by a manager joins that manager's team unless another member is picked.
    const managerRaw = payload?.reports_to === undefined && !me.admin ? me.id : payload?.reports_to;
    const reportsTo = this.managerId(me, managerRaw);
    must(canSetManager(me, null, reportsTo, me.parentOf));
    await this.emailFree(email);

    const hash = await bcrypt.hash(String(payload.password), 10);
    const t = await this.db.sequelize.transaction();
    try {
      const user = await this.db.db.users.create(
        {
          company_id: companyId,
          first_name: first,
          last_name: text(payload?.last_name, 100),
          email,
          phone: text(payload?.phone, 30),
          designation: text(payload?.designation, 100),
          department: text(payload?.department, 100),
          reports_to: reportsTo,
          password: hash,
          is_active: 1,
        },
        { transaction: t },
      );
      await this.db.db.user_roles.bulkCreate(
        roles.map((r) => ({ user_id: user.id, role_id: r.id })),
        { transaction: t },
      );
      await t.commit();
      return { id: Number(user.id), name: [first, text(payload?.last_name, 100)].filter(Boolean).join(' '), message: `${first} was added` };
    } catch (error) {
      await t.rollback();
      this.logger.error(ctx, 'Error creating user', error);
      throw error;
    }
  }

  async updateUser(companyId: number, userId: number, payload: any, callerId?: number) {
    const ctx = new LogContext('UsersService', 'updateUser', { companyId, userId });
    const me = await this.access.actor(Number(callerId), companyId);
    const target = me.people.find((p) => p.id === Number(userId));
    if (!target) throw new NotFoundException('User not found');
    must(canManage(me, { id: target.id, rank: target.rank, name: target.first_name || target.name, platform: target.platform }, me.parentOf));

    const changes: Record<string, unknown> = {};
    if (payload?.first_name !== undefined) {
      const first = text(payload.first_name, 100);
      if (!first) throw new BadRequestException('Enter a first name');
      changes.first_name = first;
    }
    if (payload?.last_name !== undefined) changes.last_name = text(payload.last_name, 100);
    if (payload?.phone !== undefined) changes.phone = text(payload.phone, 30);
    if (payload?.designation !== undefined) changes.designation = text(payload.designation, 100);
    if (payload?.department !== undefined) changes.department = text(payload.department, 100);
    if (payload?.email !== undefined) {
      const email = String(payload.email || '').trim().toLowerCase();
      if (!emailOk(email)) throw new BadRequestException('Enter a valid email address');
      if (email !== target.email) await this.emailFree(email, target.id);
      changes.email = email;
    }
    if (payload?.password) {
      if (String(payload.password).length < 8) throw new BadRequestException('The password needs at least 8 characters');
      changes.password = await bcrypt.hash(String(payload.password), 10);
    }
    if (payload?.reports_to !== undefined) {
      const reportsTo = this.managerId(me, payload.reports_to);
      must(canSetManager(me, target.id, reportsTo, me.parentOf));
      changes.reports_to = reportsTo;
    }

    let roles: { id: number; name: string; level: number; scope: string }[] | null = null;
    if (payload?.role_ids !== undefined && payload?.role_ids !== null) {
      roles = await this.rolesById(companyId, payload.role_ids);
      if (!roles.length) throw new BadRequestException('Give the person at least one role');
      must(canGiveRoles(me, roles));
      const willBeAdmin = roles.some((r) => r.level === ADMIN_LEVEL);
      if (target.admin && !willBeAdmin && !keepsAnAdmin(this.adminsAfter(me, target.id, { admin: false }))) {
        throw new ForbiddenException(`${target.first_name || target.name} is the only Admin — make someone else Admin first`);
      }
    }

    const t = await this.db.sequelize.transaction();
    try {
      if (Object.keys(changes).length) {
        await this.db.db.users.update(changes, { where: { id: target.id, company_id: companyId }, transaction: t });
      }
      if (roles) await this.replaceRoles(target.id, roles.map((r) => r.id), t);
      await t.commit();
      return { id: target.id, message: `${target.first_name || target.name} was updated` };
    } catch (error) {
      await t.rollback();
      this.logger.error(ctx, 'Error updating user', error);
      throw error;
    }
  }

  /** Replaces a person's company roles (a platform role they hold is kept). */
  private async replaceRoles(userId: number, roleIds: number[], transaction: any) {
    const current: any[] = await this.db.db.user_roles.findAll({
      where: { user_id: userId },
      include: [{ model: this.db.db.roles, as: 'role' }],
      transaction,
    });
    const drop = current.filter((ur) => !isPlatformRole({ scope: ur.role?.scope || 'COMPANY' })).map((ur) => Number(ur.role_id));
    if (drop.length) await this.db.db.user_roles.destroy({ where: { user_id: userId, role_id: { [Op.in]: drop } }, transaction });
    if (roleIds.length) {
      await this.db.db.user_roles.bulkCreate(roleIds.map((role_id) => ({ user_id: userId, role_id })), { transaction });
    }
  }

  async setRoles(companyId: number, userId: number, roleIds: unknown, callerId?: number) {
    return this.updateUser(companyId, userId, { role_ids: roleIds }, callerId);
  }

  /**
   * Deactivates a person: they can no longer sign in (their sessions end), and
   * the people who reported to them now report to their manager.
   */
  async softDeleteUser(companyId: number, userId: number, callerId?: number) {
    const ctx = new LogContext('UsersService', 'softDeleteUser', { companyId, userId });
    const me = await this.access.actor(Number(callerId), companyId);
    const target = me.people.find((p) => p.id === Number(userId));
    if (!target) throw new NotFoundException('User not found');
    must(canManage(me, { id: target.id, rank: target.rank, name: target.first_name || target.name, platform: target.platform }, me.parentOf));
    if (!target.is_active) return { id: target.id, message: `${target.first_name || target.name} is already deactivated`, moved: 0 };
    if (target.admin && !keepsAnAdmin(this.adminsAfter(me, target.id, { active: false }))) {
      throw new ForbiddenException(`${target.first_name || target.name} is the only Admin — make someone else Admin first`);
    }

    const moves = moveTeamUp(target.id, me.parentOf);
    const t = await this.db.sequelize.transaction();
    try {
      await this.db.db.users.update({ is_active: 0 }, { where: { id: target.id, company_id: companyId }, transaction: t });
      for (const [personId, managerId] of moves) {
        await this.db.db.users.update({ reports_to: managerId }, { where: { id: personId, company_id: companyId }, transaction: t });
      }
      await this.db.db.refresh_tokens.update(
        { revoked_at: new Date() },
        { where: { user_id: target.id, revoked_at: null }, transaction: t },
      );
      await t.commit();
    } catch (error) {
      await t.rollback();
      this.logger.error(ctx, 'Error deactivating user', error);
      throw error;
    }
    const up = target.reports_to ? me.people.find((p) => p.id === target.reports_to) : null;
    return {
      id: target.id,
      moved: moves.size,
      message: moves.size
        ? `${target.first_name || target.name} was deactivated — ${moves.size} ${moves.size === 1 ? 'person now reports' : 'people now report'} to ${up ? up.name : 'no one (top level)'}`
        : `${target.first_name || target.name} was deactivated`,
    };
  }

  async activateUser(companyId: number, userId: number, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    const target = me.people.find((p) => p.id === Number(userId));
    if (!target) throw new NotFoundException('User not found');
    must(canManage(me, { id: target.id, rank: target.rank, name: target.first_name || target.name, platform: target.platform }, me.parentOf));
    if (target.is_active) return { id: target.id, message: `${target.first_name || target.name} is already active` };
    const manager = target.reports_to ? me.people.find((p) => p.id === target.reports_to) : null;
    // A manager who has left in the meantime: report to the person who brought them back (or the top).
    const reportsTo = manager && manager.is_active ? manager.id : me.admin ? null : me.id;
    await this.db.db.users.update({ is_active: 1, reports_to: reportsTo }, { where: { id: target.id, company_id: companyId } });
    return { id: target.id, message: `${target.first_name || target.name} can sign in again` };
  }
}
