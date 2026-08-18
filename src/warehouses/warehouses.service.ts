import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
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
  ) {}

  private get Warehouses() {
    return this.dbProvider.db.warehouses;
  }

  private get Inventory() {
    return this.dbProvider.db.product_inventory;
  }

  async listWarehouses(requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'listWarehouses', {
      companyId: requester.companyId,
    });

    log.info('Fetching warehouses list');

    try {
      const warehouses = await this.Warehouses.findAll({
        where: { company_id: requester.companyId, is_active: 1 },
        order: [['name', 'ASC']],
      });
      return { success: true, message: 'Warehouses fetched successfully', data: warehouses };
    } catch (err) {
      log.error('DB error while listing warehouses', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async createWarehouse(data: CreateWarehouseDto, requester: WarehouseRequester) {
    const log = this.appLogger.forContext('WarehousesService', 'createWarehouse', {
      companyId: requester.companyId,
    });

    log.info('Create warehouse attempt started');

    try {
      const warehouse = await this.Warehouses.create({
        company_id: requester.companyId,
        name: data.name,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
      });
      log.info('Warehouse created successfully');
      return { success: true, message: 'Warehouse created successfully', data: warehouse };
    } catch (err) {
      log.error('DB error while creating warehouse', err);
      throw new Error('DATABASE_ERROR');
    }
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

    try {
      await warehouse.update({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.state !== undefined && { state: data.state }),
      });
      log.info('Warehouse updated successfully');
      return { success: true, message: 'Warehouse updated successfully', data: warehouse };
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

    const inventoryInUse = await this.Inventory.count({
      where: { warehouse_id: id, is_active: 1 },
    });
    if (inventoryInUse > 0) {
      log.warn('Delete rejected — warehouse still in use by inventory records');
      return {
        success: false,
        message: `Cannot delete — ${inventoryInUse} inventory record(s) still use this warehouse`,
      };
    }

    try {
      await warehouse.update({ is_active: 0 });
      log.info('Warehouse deleted successfully');
      return { success: true, message: 'Warehouse deleted successfully', data: { id } };
    } catch (err) {
      log.error('DB error while deleting warehouse', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
