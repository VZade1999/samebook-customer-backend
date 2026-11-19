import { Inject, Injectable } from '@nestjs/common';
import {
  type Actor,
  type ParentMap,
  type RoleFacts,
  effectivePermissions,
  isAdminRole,
  isPlatformRole,
  rankOf,
} from './access.rules';

export interface PersonRole {
  id: number;
  name: string;
  level: number;
  scope: string;
  is_system: number;
  description?: string | null;
}

export interface CompanyPerson {
  id: number;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  department: string | null;
  reports_to: number | null;
  is_active: boolean;
  last_login: Date | null;
  created_at: Date | null;
  /** Company roles (plus the platform role, if any), highest first. */
  roles: PersonRole[];
  rank: number;
  admin: boolean;
  platform: boolean;
}

export interface ActorContext extends Actor {
  platform: boolean;
  permissions: string[];
  people: CompanyPerson[];
  parentOf: ParentMap;
}

const fullName = (u: any) => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email;

/**
 * One place that reads who someone is: their roles (only their own company's,
 * plus the platform role), what they can do, and their company's reporting tree.
 */
@Injectable()
export class AccessService {
  private catalogueCache: { at: number; names: string[] } | null = null;

  constructor(@Inject('DATABASE_CONNECTION') private readonly db: any) {}

  /** Every active permission name (kept for a minute). */
  async catalogue(): Promise<string[]> {
    if (this.catalogueCache && Date.now() - this.catalogueCache.at < 60_000) return this.catalogueCache.names;
    const rows: any[] = await this.db.db.permission.findAll({ attributes: ['name', 'is_active'] });
    const names = rows.filter((r) => r.is_active === null || r.is_active === undefined || Number(r.is_active) !== 0).map((r) => String(r.name));
    this.catalogueCache = { at: Date.now(), names };
    return names;
  }

  forgetCatalogue() {
    this.catalogueCache = null;
  }

  /** A role that counts for someone in `companyId`: their company's own, or a platform role. */
  private counts(role: any, companyId: number) {
    return !!role && (isPlatformRole({ scope: role.scope || 'COMPANY' }) || Number(role.company_id) === Number(companyId));
  }

  private toRole(role: any): PersonRole {
    return {
      id: Number(role.id),
      name: role.name,
      level: Number(role.level ?? 4),
      scope: String(role.scope || 'COMPANY').toUpperCase(),
      is_system: Number(role.is_system) || 0,
      description: role.description ?? null,
    };
  }

  /** Someone's roles with their permission names. */
  async rolesOf(userId: number, companyId: number): Promise<(PersonRole & RoleFacts)[]> {
    const rows: any[] = await this.db.db.user_roles.findAll({
      where: { user_id: userId },
      include: [
        {
          model: this.db.db.roles,
          as: 'role',
          include: [
            {
              model: this.db.db.role_permissions,
              as: 'role_permissions',
              include: [{ model: this.db.db.permission, as: 'permission' }],
            },
          ],
        },
      ],
    });
    return rows
      .map((r) => r.role)
      .filter((role) => this.counts(role, companyId))
      .map((role) => ({
        ...this.toRole(role),
        permissions: (role.role_permissions || []).map((rp: any) => rp.permission?.name).filter(Boolean),
      }))
      .sort((a, b) => a.level - b.level);
  }

  /** What someone can do (before add-ons the company hasn't connected are dropped). */
  async accessOf(userId: number, companyId: number) {
    const [roles, catalogue] = await Promise.all([this.rolesOf(userId, companyId), this.catalogue()]);
    return { roles, roleNames: roles.map((r) => r.name), ...effectivePermissions(roles, catalogue) };
  }

  /** Everyone in a company, active or not, with their roles. */
  async companyPeople(companyId: number): Promise<CompanyPerson[]> {
    const users: any[] = await this.db.db.users.findAll({
      where: { company_id: companyId },
      attributes: ['id', 'first_name', 'last_name', 'email', 'phone', 'designation', 'department', 'reports_to', 'is_active', 'last_login', 'created_at'],
      include: [
        {
          model: this.db.db.user_roles,
          as: 'user_roles',
          required: false,
          include: [{ model: this.db.db.roles, as: 'role', required: false }],
        },
      ],
      order: [['id', 'ASC']],
    });
    return users.map((u) => {
      const roles = (u.user_roles || [])
        .map((ur: any) => ur.role)
        .filter((role: any) => this.counts(role, companyId))
        .map((role: any) => this.toRole(role))
        .sort((a: PersonRole, b: PersonRole) => a.level - b.level);
      return {
        id: Number(u.id),
        first_name: u.first_name ?? null,
        last_name: u.last_name ?? null,
        name: fullName(u),
        email: u.email,
        phone: u.phone ?? null,
        designation: u.designation ?? null,
        department: u.department ?? null,
        reports_to: u.reports_to === null || u.reports_to === undefined ? null : Number(u.reports_to),
        is_active: Number(u.is_active) === 1,
        last_login: u.last_login ?? null,
        created_at: u.created_at ?? null,
        roles,
        rank: rankOf(roles),
        admin: roles.some((r: PersonRole) => isAdminRole(r)),
        platform: roles.some((r: PersonRole) => isPlatformRole(r)),
      };
    });
  }

  static parentMap(people: Pick<CompanyPerson, 'id' | 'reports_to'>[]): ParentMap {
    return new Map(people.map((p) => [p.id, p.reports_to]));
  }

  /** Who is acting, with their company's people and reporting tree. */
  async actor(userId: number, companyId: number): Promise<ActorContext> {
    const [access, people] = await Promise.all([this.accessOf(userId, companyId), this.companyPeople(companyId)]);
    return {
      id: Number(userId),
      rank: access.rank,
      admin: access.admin,
      platform: access.platform,
      permissions: access.permissions,
      people,
      parentOf: AccessService.parentMap(people),
    };
  }

  /** Active people holding the company's Admin role. */
  static activeAdmins(people: CompanyPerson[]) {
    return people.filter((p) => p.is_active && p.admin);
  }
}
