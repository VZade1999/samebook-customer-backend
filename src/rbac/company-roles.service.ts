import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { ADMIN_LEVEL } from './access.rules';
import { ROLE_TEMPLATES } from './role-templates';

/**
 * Each company owns its roles. A company that has none yet (a new sign-up, a
 * company added from the platform console, or one that never had people) gets
 * the default set; one that somehow lost its Admin role gets it back.
 */
@Injectable()
export class CompanyRolesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    private readonly appLogger: AppLogger,
  ) {}

  /** Returns the id of the company's Admin role (creating the defaults when needed). */
  async ensureDefaults(companyId: number, transaction?: any): Promise<number> {
    const Roles = this.db.db.roles;
    const existing: any[] = await Roles.findAll({ where: { company_id: companyId, scope: 'COMPANY' }, transaction });
    const admin = existing.find((r) => Number(r.level) === ADMIN_LEVEL);
    if (admin) return Number(admin.id);

    const log = this.appLogger.forContext('CompanyRolesService', 'ensureDefaults', { companyId });
    const perms: any[] = await this.db.db.permission.findAll({ attributes: ['id', 'name'], transaction });
    const idOf = new Map(perms.map((p) => [String(p.name), Number(p.id)]));
    const taken = new Set(existing.map((r) => String(r.name).toUpperCase()));
    let adminId = 0;

    for (const t of ROLE_TEMPLATES) {
      const isAdmin = t.level === ADMIN_LEVEL;
      // A company that already has roles only gets the missing Admin role.
      if (existing.length && !isAdmin) continue;
      const name = taken.has(t.name) ? `${t.name} (COMPANY)` : t.name;
      const role = await Roles.create(
        { company_id: companyId, name, description: t.description, level: t.level, scope: 'COMPANY', is_system: t.system ? 1 : 0 },
        { transaction },
      );
      const ids = [...new Set(t.permissions.map((n) => idOf.get(n)).filter((id): id is number => !!id))];
      const missing = t.permissions.filter((n) => !idOf.has(n));
      if (missing.length) log.warn(`Role ${t.name}: permissions not in the catalogue, skipped — ${missing.join(', ')}`);
      if (ids.length) {
        await this.db.db.role_permissions.bulkCreate(
          ids.map((permission_id) => ({ role_id: role.id, permission_id })),
          { transaction },
        );
      }
      if (isAdmin) adminId = Number(role.id);
    }
    log.info(existing.length ? 'Admin role restored' : 'Default roles created');
    return adminId;
  }
}
