import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { CacheService, companyScope } from '../common/cache/cache.service';
import { CreateWarehouseDto } from './dto/createWarehouse.dto';
import { UpdateWarehouseDto } from './dto/updateWarehouse.dto';

// Self-service only: every method here resolves to the caller's own company
// (req.user.company_id, set by AuthGuard from the JWT) — there is no
// cross-company listing, creation, or deletion in this app.
export interface WarehouseRequester {
  companyId: number;
}

@Injectable()
export class WarehousesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly cache: CacheService,
  ) {}

  private get Warehouses() {
    return this.dbProvider.db.warehouses;
  }

  async listWarehouses(requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'listWarehouses', {
      companyId: requester.companyId,
    });

    log.info('Fetching warehouses list');

    try {
      // Rarely changes; create/update/delete bump c<id>:warehouses (controller).
      const warehouses = await this.cache.wrap(
        { scopes: [companyScope(requester.companyId, 'warehouses')], key: 'list', ttl: 600 },
        async () =>
          (
            await this.Warehouses.findAll({
              where: { company_id: requester.companyId, is_active: 1 },
              order: [['name', 'ASC']],
            })
          ).map((w: any) => w.toJSON()),
      );
      return { success: true, message: 'Warehouses fetched successfully', data: warehouses };
    } catch (err) {
      log.error('DB error while listing warehouses', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  private sql(sql: string, replacements: Record<string, unknown>, transaction?: any) {
    return this.dbProvider.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction }) as Promise<any[]>;
  }

  /** Another active warehouse of the company with this name (trimmed, any case). */
  private async nameTaken(companyId: number, name: string, exceptId = 0) {
    const [hit] = await this.sql(
      `SELECT id FROM warehouses WHERE company_id = :c AND is_active = 1 AND id <> :x AND LOWER(TRIM(name)) = LOWER(TRIM(:n)) LIMIT 1`,
      { c: companyId, x: exceptId, n: name },
    );
    return !!hit;
  }

  /** Makes this the company's one default warehouse. */
  private async makeDefault(companyId: number, id: number, transaction?: any) {
    await this.dbProvider.sequelize.query(
      `UPDATE warehouses SET is_default = CASE WHEN id = :id THEN 1 ELSE 0 END WHERE company_id = :c`,
      { replacements: { id, c: companyId }, transaction },
    );
  }

  /** When no active warehouse is the default, the oldest active one becomes it. */
  private async ensureDefault(companyId: number, transaction?: any) {
    const [has] = await this.sql(`SELECT id FROM warehouses WHERE company_id = :c AND is_active = 1 AND is_default = 1 LIMIT 1`, { c: companyId }, transaction);
    if (has) return;
    const [oldest] = await this.sql(`SELECT id FROM warehouses WHERE company_id = :c AND is_active = 1 ORDER BY id LIMIT 1`, { c: companyId }, transaction);
    if (oldest) await this.makeDefault(companyId, Number(oldest.id), transaction);
  }

  async createWarehouse(data: CreateWarehouseDto, requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'createWarehouse', {
      companyId: requester.companyId,
    });

    log.info('Create warehouse attempt started');

    const name = String(data.name ?? '').trim();
    if (!name) return { success: false, message: 'Give the warehouse a name' };
    if (await this.nameTaken(requester.companyId, name)) {
      return { success: false, message: `You already have a warehouse called "${name}"` };
    }

    try {
      const warehouse = await this.Warehouses.create({
        company_id: requester.companyId,
        name,
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        state: data.state?.trim() || null,
      });
      // The first warehouse — or one asked to be — is the default.
      if (data.is_default) await this.makeDefault(requester.companyId, Number(warehouse.id));
      else await this.ensureDefault(requester.companyId);
      log.info('Warehouse created successfully');
      return { success: true, message: `${name} added`, data: warehouse };
    } catch (err) {
      log.error('DB error while creating warehouse', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  /** Makes a warehouse the one new stock and new products go to. */
  async setDefault(id: number, requester: WarehouseRequester) {
    const [w] = await this.sql(`SELECT id, name FROM warehouses WHERE id = :id AND company_id = :c AND is_active = 1`, { id, c: requester.companyId });
    if (!w) return { success: false, message: `Warehouse with id ${id} not found` };
    await this.makeDefault(requester.companyId, id);
    return { success: true, message: `${w.name} is now your default warehouse`, data: { id } };
  }

  async updateWarehouse(id: number, data: UpdateWarehouseDto, requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'updateWarehouse', {
      companyId: requester.companyId,
      warehouseId: id,
    });

    log.info('Update warehouse attempt started');

    const warehouse = await this.Warehouses.findOne({
      where: { id, company_id: requester.companyId, is_active: 1 },
    });
    if (!warehouse) {
      log.warn('Update failed — warehouse not found');
      return { success: false, message: `Warehouse with id ${id} not found` };
    }

    const name = data.name !== undefined ? String(data.name).trim() : undefined;
    if (name !== undefined) {
      if (!name) return { success: false, message: 'Give the warehouse a name' };
      if (await this.nameTaken(requester.companyId, name, id)) {
        return { success: false, message: `You already have a warehouse called "${name}"` };
      }
    }

    try {
      await warehouse.update({
        ...(name !== undefined && { name }),
        ...(data.address !== undefined && { address: data.address?.trim() || null }),
        ...(data.city !== undefined && { city: data.city?.trim() || null }),
        ...(data.state !== undefined && { state: data.state?.trim() || null }),
      });
      if (data.is_default === true) await this.makeDefault(requester.companyId, id);
      log.info('Warehouse updated successfully');
      return { success: true, message: `${name ?? warehouse.name} saved`, data: warehouse };
    } catch (err) {
      log.error('DB error while updating warehouse', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async deleteWarehouse(id: number, requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'deleteWarehouse', {
      companyId: requester.companyId,
      warehouseId: id,
    });

    log.info('Delete warehouse attempt started');

    const warehouse = await this.Warehouses.findOne({
      where: { id, company_id: requester.companyId, is_active: 1 },
    });
    if (!warehouse) {
      log.warn('Delete failed — warehouse not found');
      return { success: false, message: `Warehouse with id ${id} not found` };
    }

    // Only an empty warehouse can be archived: stock must be moved out first.
    const [held] = await this.sql(
      `SELECT COUNT(DISTINCT product_id) AS products, COALESCE(SUM(stock_level), 0) AS units
       FROM product_inventory WHERE warehouse_id = :id AND is_active = 1 AND stock_level <> 0`,
      { id },
    );
    if (Number(held?.units) !== 0 || Number(held?.products) > 0) {
      log.warn('Archive rejected — warehouse still holds stock');
      return {
        success: false,
        message: `${warehouse.name} still holds ${Number(held.units)} units of ${Number(held.products)} product(s) — move them to another warehouse first`,
      };
    }

    try {
      const t = await this.dbProvider.sequelize.transaction();
      try {
        await warehouse.update({ is_active: 0 }, { transaction: t });
        // Products it merely listed (stock 0) stop being kept there.
        await this.dbProvider.sequelize.query(
          `UPDATE product_inventory SET is_active = 0, updated_at = NOW() WHERE warehouse_id = :id AND is_active = 1 AND stock_level = 0`,
          { replacements: { id }, transaction: t },
        );
        await this.dbProvider.sequelize.query(`UPDATE warehouses SET is_default = 0 WHERE id = :id`, { replacements: { id }, transaction: t });
        await this.ensureDefault(requester.companyId, t);
        await t.commit();
      } catch (e) {
        await t.rollback();
        throw e;
      }
      log.info('Warehouse deleted successfully');
      return { success: true, message: `${warehouse.name} archived`, data: { id } };
    } catch (err) {
      log.error('DB error while deleting warehouse', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
