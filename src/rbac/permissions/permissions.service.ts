import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { LogContext } from '../../common/logger/logger.context';
import { AccessService } from '../access.service';
import { ADMIN_LEVEL, PLATFORM_PERMISSIONS, isPlatformPermission } from '../access.rules';

const shape = (p: any) => ({
  id: Number(p.id),
  name: p.name,
  module_name: p.module_name ?? null,
  description: p.description ?? null,
  platform: isPlatformPermission(p.name),
  created_at: p.created_at,
});

/**
 * The master list of permissions. Companies only read it (without the
 * platform permissions) to tick permissions on their roles; adding, renaming
 * or removing permissions is for SameBook Super Admins (PlatformGuard).
 */
@Injectable()
export class PermissionsService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
    private access: AccessService,
  ) {}

  private visible(platform: boolean) {
    return platform ? {} : { name: { [Op.notIn]: [...PLATFORM_PERMISSIONS] } };
  }

  async listPermissions(page = 1, limit = 10, search?: string, platform = false) {
    const where: any = { ...this.visible(platform) };
    if (search) {
      where[Op.or] = [{ name: { [Op.like]: `%${search}%` } }, { description: { [Op.like]: `%${search}%` } }, { module_name: { [Op.like]: `%${search}%` } }];
    }
    const size = Math.max(1, Math.min(Number(limit) || 10, 500));
    const p = Math.max(1, Number(page) || 1);
    const { count, rows } = await this.db.db.permission.findAndCountAll({
      where,
      limit: size,
      offset: (p - 1) * size,
      order: [['name', 'ASC']],
    });
    return {
      permissions: rows.map(shape),
      pagination: { total: count, page: p, limit: size, pages: Math.ceil(count / size) },
    };
  }

  async getPermissions(platform = false) {
    const rows: any[] = await this.db.db.permission.findAll({ where: this.visible(platform), order: [['name', 'ASC']] });
    return rows.map(shape);
  }

  async getPermissionById(permissionId: number, platform = false) {
    const p = await this.db.db.permission.findOne({ where: { id: permissionId } });
    if (!p || (!platform && isPlatformPermission(p.name))) throw new NotFoundException('Permission not found');
    return shape(p);
  }

  /**
   * "What each permission allows": every permission grouped by area, with the
   * caller's company roles that give it (the Admin gives every one).
   */
  async catalogue(companyId: number, platform = false) {
    const [perms, roles] = await Promise.all([
      this.db.db.permission.findAll({ where: this.visible(platform), order: [['module_name', 'ASC'], ['name', 'ASC']] }),
      this.db.db.roles.findAll({
        where: { company_id: companyId, scope: 'COMPANY' },
        include: [{ model: this.db.db.role_permissions, as: 'role_permissions' }],
        order: [['level', 'ASC'], ['name', 'ASC']],
      }),
    ]);
    const holders = (permId: number, name: string) =>
      (roles as any[])
        .filter((r) =>
          isPlatformPermission(name)
            ? false
            : Number(r.level) === ADMIN_LEVEL || (r.role_permissions || []).some((rp: any) => Number(rp.permission_id) === permId),
        )
        .map((r) => ({ id: Number(r.id), name: r.name, level: Number(r.level) }));
    const groups = new Map<string, any[]>();
    (perms as any[]).forEach((p) => {
      const area = isPlatformPermission(p.name) ? 'Platform' : p.module_name || String(p.name).split('.')[0];
      const list = groups.get(area) || [];
      list.push({ ...shape(p), roles: holders(Number(p.id), p.name) });
      groups.set(area, list);
    });
    return {
      groups: [...groups.entries()].map(([area, permissions]) => ({ area, permissions })),
      total: (perms as any[]).length,
      can_edit: platform,
    };
  }

  // ── Platform only (the controller adds PlatformGuard) ───────────────────

  private checkName(name: string) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) {
      throw new BadRequestException('A permission name looks like "area.action", e.g. "quotations.approve"');
    }
  }

  async createPermission(payload: any) {
    const ctx = new LogContext('PermissionsService', 'createPermission', { name: payload?.name });
    const name = String(payload?.name || '').trim().toLowerCase();
    this.checkName(name);
    const existing = await this.db.db.permission.findOne({ where: { name } });
    if (existing) throw new ConflictException('Permission already exists');
    try {
      const p = await this.db.db.permission.create({
        name,
        module_name: String(payload?.module_name || '').trim() || null,
        description: String(payload?.description || '').trim() || null,
        is_active: 1,
      });
      this.access.forgetCatalogue();
      return { ...shape(p), message: 'Permission created' };
    } catch (error) {
      this.logger.error(ctx, 'Error creating permission', error);
      throw error;
    }
  }

  async updatePermission(permissionId: number, payload: any) {
    const p = await this.db.db.permission.findOne({ where: { id: permissionId } });
    if (!p) throw new NotFoundException('Permission not found');
    const changes: Record<string, unknown> = {};
    if (payload?.name !== undefined) {
      const name = String(payload.name || '').trim().toLowerCase();
      this.checkName(name);
      if (name !== p.name) {
        const clash = await this.db.db.permission.findOne({ where: { name, id: { [Op.ne]: p.id } } });
        if (clash) throw new ConflictException('Permission already exists');
      }
      changes.name = name;
    }
    if (payload?.module_name !== undefined) changes.module_name = String(payload.module_name || '').trim() || null;
    if (payload?.description !== undefined) changes.description = String(payload.description || '').trim() || null;
    await p.update(changes);
    this.access.forgetCatalogue();
    return { ...shape(p), message: 'Permission saved' };
  }

  async deletePermission(permissionId: number) {
    const p = await this.db.db.permission.findOne({ where: { id: permissionId } });
    if (!p) throw new NotFoundException('Permission not found');
    const t = await this.db.sequelize.transaction();
    try {
      await this.db.db.role_permissions.destroy({ where: { permission_id: permissionId }, transaction: t });
      await p.destroy({ transaction: t });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
    this.access.forgetCatalogue();
    return { message: 'Permission deleted' };
  }
}
