import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { LogContext } from '../../common/logger/logger.context';
import { AccessService, type ActorContext } from '../access.service';
import { CompanyRolesService } from '../company-roles.service';
import { CompanyModulesService } from '../../company-modules/company-modules.service';
import {
  type Verdict,
  ADMIN_LEVEL,
  canGrantPermissions,
  canWorkOnRoleLevel,
  isPlatformPermission,
  isReservedRoleName,
} from '../access.rules';

const must = (v: Verdict) => {
  if (v.ok === false) throw new ForbiddenException(v.reason);
};
const cleanName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * A company's own roles: levels (1 = the locked Admin … 5), people per role,
 * and each role's permissions. Editing a role never affects another company.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
    private access: AccessService,
    private companyRoles: CompanyRolesService,
    private companyModules: CompanyModulesService,
  ) {}

  /** The company's roles with their permission names, highest first. */
  private async rolesOf(companyId: number) {
    await this.companyRoles.ensureDefaults(companyId);
    const rows: any[] = await this.db.db.roles.findAll({
      where: { company_id: companyId, scope: 'COMPANY' },
      include: [
        {
          model: this.db.db.role_permissions,
          as: 'role_permissions',
          include: [{ model: this.db.db.permission, as: 'permission' }],
        },
      ],
      order: [['level', 'ASC'], ['name', 'ASC']],
    });
    return rows;
  }

  private async findRole(companyId: number, roleId: number) {
    const role = await this.db.db.roles.findOne({ where: { id: roleId, company_id: companyId, scope: 'COMPANY' } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private shape(r: any, me: ActorContext, companyPerms: string[]) {
    const level = Number(r.level);
    const admin = level === ADMIN_LEVEL;
    const holders = me.people.filter((p) => p.is_active && p.roles.some((x) => x.id === Number(r.id)));
    const permissions = admin
      ? companyPerms
      : (r.role_permissions || []).map((rp: any) => rp.permission?.name).filter((n: string) => n && !isPlatformPermission(n));
    const verdict: Verdict = admin ? { ok: false, reason: 'The Admin role is locked — it always has every permission' } : canWorkOnRoleLevel(me, level);
    return {
      id: Number(r.id),
      company_id: Number(r.company_id),
      name: r.name,
      description: r.description ?? null,
      level,
      is_system: Number(r.is_system) || 0,
      admin,
      people: holders.length,
      people_preview: holders.slice(0, 5).map((p) => ({ id: p.id, name: p.name })),
      permissions: [...new Set(permissions as string[])].sort(),
      permission_count: admin ? companyPerms.length : new Set(permissions as string[]).size,
      can_edit: verdict.ok,
      why_not: verdict.ok ? null : verdict.reason,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  /** Everything the Roles page needs: roles, the permission catalogue and the caller's rights. */
  async overview(companyId: number, callerId: number) {
    const [me, rows, catalogueRows, modules] = await Promise.all([
      this.access.actor(callerId, companyId),
      this.rolesOf(companyId),
      this.db.db.permission.findAll({ order: [['module_name', 'ASC'], ['name', 'ASC']] }),
      this.companyModules.getEnabledModuleKeys(companyId),
    ]);
    const catalogue = (catalogueRows as any[])
      .filter((p) => !isPlatformPermission(p.name) && (p.is_active === null || p.is_active === undefined || Number(p.is_active) !== 0))
      .map((p) => ({ id: Number(p.id), name: p.name, module: p.module_name || p.name.split('.')[0], description: p.description ?? null }));
    const companyPerms = catalogue.map((p) => p.name);
    return {
      roles: rows.map((r) => this.shape(r, me, companyPerms)),
      catalogue,
      modules,
      me: {
        id: me.id,
        rank: me.rank,
        admin: me.admin,
        permissions: me.permissions,
        can_create: me.permissions.includes('roles.create'),
        can_edit: me.permissions.includes('roles.edit'),
        can_delete: me.permissions.includes('roles.delete'),
      },
    };
  }

  /** Paged list (older screens). */
  async listRoles(companyId: number, page = 1, limit = 10, search?: string, callerId?: number) {
    const { roles } = await this.overview(companyId, Number(callerId));
    const q = String(search || '').trim().toLowerCase();
    const rows = roles.filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.description || '').toLowerCase().includes(q));
    const size = Math.max(1, Math.min(Number(limit) || 10, 200));
    const p = Math.max(1, Number(page) || 1);
    return {
      roles: rows.slice((p - 1) * size, p * size),
      pagination: { total: rows.length, page: p, limit: size, pages: Math.ceil(rows.length / size) },
    };
  }

  /** Every role of the company (e.g. the Apps page picks roles to give an add-on to). */
  async getRoles(companyId: number, callerId?: number) {
    const { roles } = await this.overview(companyId, Number(callerId));
    return roles.map((r) => ({ id: r.id, name: r.name, description: r.description, company_id: r.company_id, is_system: r.is_system, level: r.level, people: r.people }));
  }

  async getRoleById(companyId: number, roleId: number, callerId?: number) {
    const { roles, catalogue } = await this.overview(companyId, Number(callerId));
    const role = roles.find((r) => r.id === Number(roleId));
    if (!role) throw new NotFoundException('Role not found');
    const idOf = new Map(catalogue.map((p) => [p.name, p.id]));
    return { ...role, permissions: role.permissions.map((name) => ({ id: idOf.get(name), name })) };
  }

  private async nameFree(companyId: number, name: string, exceptId?: number) {
    const rows: any[] = await this.db.db.roles.findAll({ where: { company_id: companyId }, attributes: ['id', 'name'] });
    const clash = rows.find((r) => String(r.name).toLowerCase() === name.toLowerCase() && Number(r.id) !== Number(exceptId));
    if (clash) throw new ConflictException('A role with this name already exists');
  }

  private checkName(name: string) {
    if (!name || name.length > 60) throw new BadRequestException('Enter a role name (up to 60 characters)');
    if (isReservedRoleName(name)) throw new BadRequestException("That name is reserved for SameBook's platform role");
  }

  async createRole(companyId: number, payload: any, callerId?: number) {
    const ctx = new LogContext('RolesService', 'createRole', { companyId });
    const me = await this.access.actor(Number(callerId), companyId);
    await this.companyRoles.ensureDefaults(companyId);
    const name = cleanName(payload?.name);
    this.checkName(name);
    const level = payload?.level === undefined || payload?.level === null || payload?.level === '' ? 4 : Number(payload.level);
    must(canWorkOnRoleLevel(me, level));
    await this.nameFree(companyId, name);

    // "Duplicate": start from another role's permissions (only ones the caller may give).
    let permissionIds: number[] = [];
    if (payload?.copy_from) {
      const source: any = await this.db.db.roles.findOne({
        where: { id: Number(payload.copy_from), company_id: companyId, scope: 'COMPANY' },
        include: [{ model: this.db.db.role_permissions, as: 'role_permissions', include: [{ model: this.db.db.permission, as: 'permission' }] }],
      });
      if (!source) throw new BadRequestException('The role to copy is not a role of your company');
      const all: any[] = Number(source.level) === ADMIN_LEVEL
        ? await this.db.db.permission.findAll({ attributes: ['id', 'name'] })
        : (source.role_permissions || []).map((rp: any) => rp.permission).filter(Boolean);
      permissionIds = all
        .filter((p) => !isPlatformPermission(p.name) && (me.admin || me.permissions.includes(p.name)))
        .map((p) => Number(p.id));
    }

    try {
      const role = await this.db.db.roles.create({
        company_id: companyId,
        name,
        description: String(payload?.description ?? '').trim() || null,
        level,
        scope: 'COMPANY',
        is_system: 0,
      });
      if (permissionIds.length) {
        await this.db.db.role_permissions.bulkCreate([...new Set(permissionIds)].map((permission_id) => ({ role_id: role.id, permission_id })));
      }
      return { id: Number(role.id), name: role.name, level, message: `Role "${role.name}" created` };
    } catch (error) {
      this.logger.error(ctx, 'Error creating role', error);
      throw error;
    }
  }

  async updateRole(companyId: number, roleId: number, payload: any, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    const role = await this.findRole(companyId, roleId);
    const changes: Record<string, unknown> = {};
    if (payload?.description !== undefined) changes.description = String(payload.description ?? '').trim() || null;

    if (Number(role.level) === ADMIN_LEVEL) {
      if (payload?.name !== undefined && cleanName(payload.name) !== role.name) throw new ForbiddenException('The Admin role is locked — it can’t be renamed');
      if (payload?.level !== undefined && Number(payload.level) !== ADMIN_LEVEL) throw new ForbiddenException('The Admin role is always level 1');
      if (!me.admin) throw new ForbiddenException('Only an Admin can change the Admin role');
    } else {
      must(canWorkOnRoleLevel(me, Number(role.level)));
      if (payload?.name !== undefined) {
        const name = cleanName(payload.name);
        this.checkName(name);
        if (name.toLowerCase() !== String(role.name).toLowerCase()) await this.nameFree(companyId, name, role.id);
        changes.name = name;
      }
      if (payload?.level !== undefined) {
        const level = Number(payload.level);
        must(canWorkOnRoleLevel(me, level));
        changes.level = level;
      }
    }
    if (Object.keys(changes).length) await role.update({ ...changes, updated_at: new Date() });
    return { id: Number(role.id), name: role.name, level: Number(role.level), message: `Role "${role.name}" saved` };
  }

  async deleteRole(companyId: number, roleId: number, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    const role = await this.findRole(companyId, roleId);
    if (Number(role.level) === ADMIN_LEVEL || Number(role.is_system) === 1) throw new ForbiddenException('The Admin role can’t be deleted');
    must(canWorkOnRoleLevel(me, Number(role.level)));
    const holders = me.people.filter((p) => p.roles.some((r) => r.id === Number(role.id)));
    const active = holders.filter((p) => p.is_active);
    if (active.length) {
      throw new ConflictException(
        `${active.length} ${active.length === 1 ? 'person still has' : 'people still have'} this role — give ${active.length === 1 ? 'them' : 'them'} another role first`,
      );
    }
    const t = await this.db.sequelize.transaction();
    try {
      await this.db.db.user_roles.destroy({ where: { role_id: role.id }, transaction: t });
      await this.db.db.role_permissions.destroy({ where: { role_id: role.id }, transaction: t });
      await role.destroy({ transaction: t });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
    return { message: `Role "${role.name}" deleted` };
  }

  // ── Permissions of a role ───────────────────────────────────────────────

  async getRolePermissions(companyId: number, roleId: number, callerId?: number) {
    const role = await this.getRoleById(companyId, roleId, callerId);
    return { role_id: role.id, role_name: role.name, admin: role.admin, permissions: role.permissions };
  }

  /**
   * Sets a role's permissions. Only company permissions; a non-Admin may only
   * add permissions they hold themselves (removing is always fine). The Admin
   * role always has everything, so it can't be changed.
   */
  async setPermissions(companyId: number, roleId: number, permissionIds: unknown, callerId?: number) {
    const me = await this.access.actor(Number(callerId), companyId);
    const role: any = await this.db.db.roles.findOne({
      where: { id: roleId, company_id: companyId, scope: 'COMPANY' },
      include: [{ model: this.db.db.role_permissions, as: 'role_permissions', include: [{ model: this.db.db.permission, as: 'permission' }] }],
    });
    if (!role) throw new NotFoundException('Role not found');
    if (Number(role.level) === ADMIN_LEVEL) throw new ForbiddenException('The Admin always has every permission — nothing to change');
    must(canWorkOnRoleLevel(me, Number(role.level)));

    if (!Array.isArray(permissionIds)) throw new BadRequestException('permission_ids must be a list');
    const ids = [...new Set(permissionIds.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new BadRequestException('permission_ids must contain permission ids');
    const perms: any[] = ids.length ? await this.db.db.permission.findAll({ where: { id: { [Op.in]: ids } } }) : [];
    if (perms.length !== ids.length) throw new BadRequestException('One or more permissions don’t exist');
    const platform = perms.find((p) => isPlatformPermission(p.name));
    if (platform) throw new ForbiddenException(`"${platform.name}" is a platform permission — companies can't give it`);

    const current = new Set((role.role_permissions || []).map((rp: any) => Number(rp.permission_id)));
    const added = perms.filter((p) => !current.has(Number(p.id))).map((p) => String(p.name));
    must(canGrantPermissions(me, added));

    const t = await this.db.sequelize.transaction();
    try {
      await this.db.db.role_permissions.destroy({ where: { role_id: role.id }, transaction: t });
      if (ids.length) {
        await this.db.db.role_permissions.bulkCreate(ids.map((permission_id) => ({ role_id: role.id, permission_id })), { transaction: t });
      }
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
    return { message: `Permissions of "${role.name}" saved`, count: ids.length };
  }
}
