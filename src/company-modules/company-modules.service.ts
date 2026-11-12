import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { MODULE_CATALOG, getModuleDefinition } from './module-catalog';

const CACHE_TTL_MS = 30_000;

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
  // companyId -> enabled add-on keys. Per-process; every connect/disconnect in
  // this process invalidates it, other processes converge within the TTL.
  private readonly cache = new Map<number, { keys: string[]; expires: number }>();

  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {}

  private get CompanyModules() {
    return this.dbProvider.db.company_modules;
  }

  invalidate(companyId: number) {
    this.cache.delete(Number(companyId));
  }

  /**
   * Enabled ADD-ON keys for a company (core modules are implied).
   * Never throws: on any DB problem (e.g. the table is not migrated yet) it
   * logs and returns [] so login keeps working and add-ons stay hidden.
   */
  async getEnabledModuleKeys(companyId: number): Promise<string[]> {
    const id = Number(companyId);
    if (!id) return [];
    const hit = this.cache.get(id);
    if (hit && hit.expires > Date.now()) return hit.keys;

    try {
      const rows: any[] = await this.CompanyModules.findAll({
        where: {
          company_id: id,
          enabled: 1,
          [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: new Date() } }],
        },
        attributes: ['module_key'],
      });
      const known = new Set(MODULE_CATALOG.filter((m) => !m.core).map((m) => m.key));
      const keys = rows.map((r) => r.module_key).filter((k: string) => known.has(k));
      this.cache.set(id, { keys, expires: Date.now() + CACHE_TTL_MS });
      return keys;
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
      this.invalidate(requester.companyId);
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
      this.invalidate(requester.companyId);
      log.info('Module disconnected');
      const data = (await this.list(requester.companyId)).find((m) => m.key === key);
      return { success: true, message: `${def.name} disconnected`, data };
    } catch (err) {
      log.error('Failed to disconnect module', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
