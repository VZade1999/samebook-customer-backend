import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { CacheService, companyScope } from '../common/cache/cache.service';
import { MODULE_CATALOG, getModuleDefinition } from './module-catalog';

// Redis copy: invalidated on connect/disconnect; the TTL is a safety net
// (e.g. an add-on whose expires_at passes). Memory copy: a few seconds.
const CACHE_TTL_S = 300;
const L1_MS = 5_000;
// The cached list is keyed by the add-on catalog, so code with a different
// catalog (e.g. old and new versions side by side during a deploy) never reads
// a list the other computed — the old one drops add-ons it doesn't know.
const CATALOG_SIG = MODULE_CATALOG.filter((m) => !m.core)
  .map((m) => m.key)
  .sort()
  .join('.');

export interface ModulesRequester {
  userId: number;
  companyId: number;
  roles: string[];
}

type ServiceResult<T = any> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; status: number };

@Injectable()
export class CompanyModulesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly cache: CacheService,
  ) {}

  private get CompanyModules() {
    return this.dbProvider.db.company_modules;
  }

  /** After connect/disconnect: add-on status and (granted) role access changed. */
  async invalidate(companyId: number) {
    await this.cache.bump(companyScope(companyId, 'modules'), companyScope(companyId, 'access'));
  }

  /**
   * Enabled ADD-ON keys for a company (core modules are implied). Checked on
   * every add-on request, so it's cached in Redis plus a few seconds in memory.
   * Never throws: on any DB problem (e.g. the table is not migrated yet) it
   * logs and returns [] so login keeps working and add-ons stay hidden.
   */
  async getEnabledModuleKeys(companyId: number): Promise<string[]> {
    const id = Number(companyId);
    if (!id) return [];
    try {
      return await this.cache.wrap(
        { scopes: [companyScope(id, 'modules')], key: `enabled:${CATALOG_SIG}`, ttl: CACHE_TTL_S, l1Ms: L1_MS },
        async () => {
          const rows: any[] = await this.CompanyModules.findAll({
            where: {
              company_id: id,
              enabled: 1,
              [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: new Date() } }],
            },
            attributes: ['module_key'],
          });
          const known = new Set(MODULE_CATALOG.filter((m) => !m.core).map((m) => m.key));
          return rows.map((r) => r.module_key).filter((k: string) => known.has(k));
        },
      );
    } catch (err) {
      this.appLogger
        .forContext('CompanyModulesService', 'getEnabledModuleKeys', { companyId: id })
        .error('Could not load company modules — treating add-ons as disabled', err);
      return [];
    }
  }

  async isEnabled(companyId: number, key: string): Promise<boolean> {
    const def = getModuleDefinition(key);
    if (!def) return false;
    if (def.core) return true;
    return (await this.getEnabledModuleKeys(companyId)).includes(key);
  }

  async list(companyId: number) {
    const rows: any[] = await this.CompanyModules.findAll({
      where: { company_id: companyId },
      include: [
        {
          model: this.dbProvider.db.users,
          as: 'enabled_by_user',
          attributes: ['id', 'first_name', 'last_name', 'email'],
          required: false,
        },
      ],
    });
    const byKey = new Map(rows.map((r) => [r.module_key, r]));
    const now = Date.now();

    return MODULE_CATALOG.map((m) => {
      const row: any = byKey.get(m.key);
      const expired = row?.expires_at ? new Date(row.expires_at).getTime() <= now : false;
      const u = row?.enabled_by_user;
      return {
        key: m.key,
        name: m.name,
        description: m.description,
        core: m.core,
        plan: m.core ? 'INCLUDED' : row?.plan || m.plan,
        enabled: m.core ? true : !!(row && Number(row.enabled) === 1 && !expired),
        enabled_at: row?.enabled_at ?? null,
        enabled_by: u
          ? { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }
          : null,
        disabled_at: row?.disabled_at ?? null,
        expires_at: row?.expires_at ?? null,
      };
    });
  }

  async connect(
    key: string,
    requester: ModulesRequester,
    grantRoleIds: number[] = [],
  ): Promise<ServiceResult> {
    const log = this.appLogger.forContext('CompanyModulesService', 'connect', {
      companyId: requester.companyId,
      module: key,
    });
    const def = getModuleDefinition(key);
    if (!def) return { success: false, message: 'Module not found', status: 404 };
    if (def.core) {
      return {
        success: false,
        message: 'Core modules cannot be connected or disconnected',
        status: 400,
      };
    }

    const roleIds = [...new Set((grantRoleIds || []).map(Number))];
    let rolesToGrant: any[] = [];
    if (roleIds.length) {
      if (!def.grantPermissions?.length) {
        return { success: false, message: 'This module has no role access to grant', status: 400 };
      }
      const roles: any[] = await this.dbProvider.db.roles.findAll({
        where: { id: { [Op.in]: roleIds }, company_id: requester.companyId },
      });
      const isSuperAdmin = (requester.roles || []).includes('SUPER_ADMIN');
      rolesToGrant = roles.filter((r) => r.name !== 'SUPER_ADMIN' || isSuperAdmin);
      const allowed = new Set(rolesToGrant.map((r) => Number(r.id)));
      const invalid = roleIds.filter((id) => !allowed.has(id));
      if (invalid.length) {
        return {
          success: false,
          message: `These roles cannot be given access: ${invalid.join(', ')}`,
          status: 400,
        };
      }
    }

    const t = await this.dbProvider.sequelize.transaction();
    try {
      const existing: any = await this.CompanyModules.findOne({
        where: { company_id: requester.companyId, module_key: key },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const now = new Date();
      if (existing) {
        if (Number(existing.enabled) !== 1) {
          await existing.update(
            { enabled: 1, enabled_by: requester.userId, enabled_at: now, plan: def.plan },
            { transaction: t },
          );
        }
      } else {
        await this.CompanyModules.create(
          {
            company_id: requester.companyId,
            module_key: key,
            enabled: 1,
            plan: def.plan,
            enabled_by: requester.userId,
            enabled_at: now,
          },
          { transaction: t },
        );
      }

      if (rolesToGrant.length && def.grantPermissions?.length) {
        const perms: any[] = await this.dbProvider.db.permission.findAll({
          where: { name: { [Op.in]: def.grantPermissions } },
          transaction: t,
        });
        if (perms.length !== def.grantPermissions.length) {
          throw new Error(`Permissions missing for module ${key} — run its SQL script`);
        }
        const roleIdsToGrant = rolesToGrant.map((r) => r.id);
        const already: any[] = await this.dbProvider.db.role_permissions.findAll({
          where: {
            permission_id: { [Op.in]: perms.map((p) => p.id) },
            role_id: { [Op.in]: roleIdsToGrant },
          },
          transaction: t,
        });
        const have = new Set(already.map((rp) => `${rp.role_id}:${rp.permission_id}`));
        const toCreate = roleIdsToGrant.flatMap((roleId) =>
          perms
            .filter((p) => !have.has(`${roleId}:${p.id}`))
            .map((p) => ({ role_id: roleId, permission_id: p.id })),
        );
        if (toCreate.length) {
          await this.dbProvider.db.role_permissions.bulkCreate(toCreate, { transaction: t });
        }
      }

      await t.commit();
      await this.invalidate(requester.companyId);
      log.info('Module connected', { grantedRoles: rolesToGrant.length });
      const data = (await this.list(requester.companyId)).find((m) => m.key === key);
      return { success: true, message: `${def.name} connected`, data };
    } catch (err) {
      await t.rollback();
      log.error('Failed to connect module', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async disconnect(key: string, requester: ModulesRequester): Promise<ServiceResult> {
    const log = this.appLogger.forContext('CompanyModulesService', 'disconnect', {
      companyId: requester.companyId,
      module: key,
    });
    const def = getModuleDefinition(key);
    if (!def) return { success: false, message: 'Module not found', status: 404 };
    if (def.core) {
      return {
        success: false,
        message: 'Core modules cannot be connected or disconnected',
        status: 400,
      };
    }

    try {
      const existing: any = await this.CompanyModules.findOne({
        where: { company_id: requester.companyId, module_key: key },
      });
      if (existing && Number(existing.enabled) === 1) {
        // Data of the module is never touched — reconnecting restores it.
        await existing.update({
          enabled: 0,
          disabled_by: requester.userId,
          disabled_at: new Date(),
        });
      }
      await this.invalidate(requester.companyId);
      log.info('Module disconnected');
      const data = (await this.list(requester.companyId)).find((m) => m.key === key);
      return { success: true, message: `${def.name} disconnected`, data };
    } catch (err) {
      log.error('Failed to disconnect module', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
