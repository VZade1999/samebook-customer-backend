import { AppLogger } from '../common/logger/logger.service';
import { CreateProductDto } from './dto/createProduct.dto';
import { products } from '../models/products';

import { Op } from 'sequelize';
import { Inject, Injectable } from '@nestjs/common';
import { ProductsListDto } from './products-list.dto';
import { UpdateProductDto } from './dto/updateProduct.dto';


@Injectable()
export class ProductService {
  private readonly Products: typeof products;

  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {
    this.Products = this.dbProvider.db.products;
  }

  // A category_id the client sends must belong to the same company —
  // otherwise a product could reference (and thus leak/imply) another
  // tenant's category.
  private async assertCategoryBelongsToCompany(
    categoryId: number | undefined,
    companyId: number,
  ): Promise<{ success: false; message: string } | null> {
    if (categoryId === undefined || categoryId === null) return null;
    const CategoryModel = this.dbProvider.db.product_categories;
    const category = await CategoryModel.findOne({
      where: { id: categoryId, company_id: companyId, is_active: 1 },
    });
    if (!category) {
      return { success: false, message: `Category with id ${categoryId} not found` };
    }
    return null;
  }

  // A warehouse_id an inventory item carries must belong to the same
  // company — otherwise inventory could reference (and thus leak/imply)
  // another tenant's warehouse.
  private async assertWarehousesBelongToCompany(
    inventory: { warehouse_id?: number }[] | undefined,
    companyId: number,
  ): Promise<{ success: false; message: string } | null> {
    if (!Array.isArray(inventory) || inventory.length === 0) return null;
    const warehouseIds = [
      ...new Set(
        inventory
          .map((item) => item.warehouse_id)
          .filter((id): id is number => id !== undefined && id !== null),
      ),
    ];
    if (warehouseIds.length === 0) return null;

    const WarehouseModel = this.dbProvider.db.warehouses;
    const found = await WarehouseModel.findAll({
      where: { id: warehouseIds, company_id: companyId, is_active: 1 },
    });
    if (found.length !== warehouseIds.length) {
      return { success: false, message: 'One or more warehouses were not found' };
    }
    return null;
  }

  async createProduct(data: CreateProductDto, currentUser: any) {
    const companyId = currentUser.company_id;
    const log = this.appLogger.forContext('ProductService', 'createProduct', {
      name: data.name,
      companyId,
    });

    log.info('Create product attempt started');

    const categoryError = await this.assertCategoryBelongsToCompany(data.category_id, companyId);
    if (categoryError) {
      log.warn('Creation failed — category does not belong to this company');
      return categoryError;
    }

    const warehouseError = await this.assertWarehousesBelongToCompany(data.inventory, companyId);
    if (warehouseError) {
      log.warn('Creation failed — warehouse does not belong to this company');
      return warehouseError;
    }

    if (data.product_code) {
      const existingProduct = await this.Products.findOne({
        where: {
          company_id: companyId,
          product_code: data.product_code,
        },
      });

      if (existingProduct) {
        log.warn('Creation failed — product code already exists');
        return {
          success: false,
          message: `${data.product_code} product code already exists`,
        };
      }
    }

    let product: products;
    const sequelize = this.dbProvider.sequelize;
    const VariantsModel = this.dbProvider.db.product_variants;
    const ImagesModel = this.dbProvider.db.product_images;
    const InventoryModel = this.dbProvider.db.product_inventory;
    const MetadataModel = this.dbProvider.db.product_metadata;

    const t = await sequelize.transaction();
    try {
      product = await this.Products.create(
        {
          // Always the caller's own company — never trust a company_id the
          // client sends, or one tenant could create products under
          // another tenant's account just by editing the request body.
          company_id: companyId,
          product_code: data.product_code,
          name: data.name,
          description: data.description,
          unit: data.unit,
          price: data.price,
          cost_price: data.cost_price,
          tax_percentage: data.tax_percentage,
          sku: data.sku,
          barcode: data.barcode,
          stock_quantity: data.stock_quantity,
          minimum_stock: data.minimum_stock,
          category_id: data.category_id,
          image_url: data.image_url,
        },
        { transaction: t },
      );

      // create nested variants
      if (Array.isArray(data.variants) && data.variants.length > 0) {
        for (const v of data.variants) {
          try {
            await VariantsModel.create(
              {
                product_id: product.id,
                sku: v.sku,
                attributes: v.attributes ?? null,
                price: v.price ?? 0,
                compare_at_price: v.compare_at_price ?? 0,
                cost_price: v.cost_price ?? 0,
                is_default: v.is_default ?? 0,
              },
              { transaction: t },
            );
          } catch (err:any) {
            log.error('DB error while creating variant', err, {
              mysqlError: err?.original?.message ?? err?.message,
              sql: err?.sql,
            });
            throw err;
          }
        }
      }

      // create nested images
      if (Array.isArray(data.images) && data.images.length > 0) {
        for (const img of data.images) {
          try {
            await ImagesModel.create(
              {
                product_id: product.id,
                variant_id: img.variant_id ?? null,
                url: img.url,
                sort_order: img.sort_order ?? 0,
                metadata: img.metadata ?? null,
              },
              { transaction: t },
            );
          } catch (err:any) {
            log.error('DB error while creating image', err, {
              mysqlError: err?.original?.message ?? err?.message,
              sql: err?.sql,
            });
            throw err;
          }
        }
      }

      // create inventory records
      if (Array.isArray(data.inventory) && data.inventory.length > 0) {
        for (const inv of data.inventory) {
          try {
            await InventoryModel.create(
              {
                product_id: product.id,
                variant_id: inv.variant_id ?? null,
                stock_level: inv.stock_level ?? 0,
                stock_policy: inv.stock_policy ?? null,
                warehouse_id: inv.warehouse_id ?? null,
              },
              { transaction: t },
            );
          } catch (err:any) {
            log.error('DB error while creating inventory', err, {
              mysqlError: err?.original?.message ?? err?.message,
              sql: err?.sql,
            });
            throw err;
          }
        }
      }

      // create metadata
      if (Array.isArray(data.metadata) && data.metadata.length > 0) {
        for (const m of data.metadata) {
          try {
            await MetadataModel.create(
              {
                product_id: product.id,
                key: m.key,
                value: m.value ?? null,
                data_type: m.data_type ?? null,
                is_sensitive: m.is_sensitive ?? 0,
              },
              { transaction: t },
            );
          } catch (err:any) {
            log.error('DB error while creating metadata', err, {
              mysqlError: err?.original?.message ?? err?.message,
              sql: err?.sql,
            });
            throw err;
          }
        }
      }

      await t.commit();
    } catch (err:any) {
      await t.rollback();
      log.error('DB error while creating product', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
        fields: err?.fields,
      });
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ productId: product.id }).info('Product created successfully');

    return {
      success: true,
      message: 'Product created successfully',
      data: {
        id: product.id,
        name: product.name,
        product_code: product.product_code,
        sku: product.sku,
        barcode: product.barcode,
      },
    };
  }

  async getProductsList(data: ProductsListDto, currentUser:any) {
    const log = this.appLogger.forContext('ProductService', 'getProductsList');

    log.info('Fetching products list');

    const page = Number(data.page) || 1;
    const limit = Number(data.limit) || 10;
    const offset = (page - 1) * limit;

    const andConditions: any[] = [];
    andConditions.push({ is_active: true });

      andConditions.push({ company_id: currentUser.company_id });
    if (data.name)
      andConditions.push({ name: { [Op.like]: `%${data.name}%` } });
    if (data.product_code)
      andConditions.push({ product_code: { [Op.like]: `%${data.product_code}%` } });
    if (data.sku) andConditions.push({ sku: { [Op.like]: `%${data.sku}%` } });
    if (data.barcode)
      andConditions.push({ barcode: { [Op.like]: `%${data.barcode}%` } });
    if (data.category_id)
      andConditions.push({ category_id: data.category_id });
    if (data.search)
      andConditions.push({
        [Op.or]: [
          { name: { [Op.like]: `%${data.search}%` } },
          { sku: { [Op.like]: `%${data.search}%` } },
          { product_code: { [Op.like]: `%${data.search}%` } },
          { barcode: { [Op.like]: `%${data.search}%` } },
        ],
      });

    const whereClause = andConditions.length > 0 ? { [Op.and]: andConditions } : {};

    log.debug('Query built', {
      activeFilters: andConditions.length,
      filters: {
        company_id: data.company_id ?? 'none',
        name: data.name ?? 'none',
        product_code: data.product_code ?? 'none',
        sku: data.sku ?? 'none',
        barcode: data.barcode ?? 'none',
        category_id: data.category_id ?? 'none',
      },
      page,
      limit,
      offset,
    });

    let result: { rows: products[]; count: number };

    try {
      result = await this.Products.findAndCountAll({
        where: whereClause,
        distinct: true,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        attributes: [
          'id',
          'company_id',
          'product_code',
          'name',
          'description',
          'unit',
          'price',
          'cost_price',
          'tax_percentage',
          'sku',
          'barcode',
          'stock_quantity',
          'minimum_stock',
          'image_url',
          'category_id',
          'created_at',
        ],
        include: [
          {
            association: 'category',
            required: false,
            where: { is_active: true },
            attributes: ['id', 'name', 'description'],
          },
          {
            association: 'variants',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'images',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'inventory',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'metadata',
            required: false,
            separate: true,
            where: { is_active: true },
          },
        ],
      });
    } catch (err) {
      log.error('DB error while fetching products list', err);
      throw new Error('DATABASE_ERROR');
    }

    const totalPages = Math.ceil(result.count / limit);

    log.debug('Products fetched', {
      total: result.count,
      fetched: result.rows.length,
      totalPages,
    });

    log.info('Products list fetched successfully');

    return {
      success: true,
      message: 'Products list fetched successfully',
      data: {
        products: result.rows,
        pagination: {
          total: result.count,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    };
  }

  async getProductById(id: number, currentUser: any) {
    const log = this.appLogger.forContext('ProductService', 'getProductById', {
      productId: id,
    });

    log.info('Fetching product details');

    try {
      const product = await this.Products.findOne({
        where: { id, company_id: currentUser.company_id, is_active: true },
        include: [
          {
            association: 'variants',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'images',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'inventory',
            required: false,
            separate: true,
            where: { is_active: true },
          },
          {
            association: 'metadata',
            required: false,
            separate: true,
            where: { is_active: true },
          },
        ],
      });

      if (!product) {
        log.warn('Product not found');
        return { success: false, message: `Product with id ${id} not found` };
      }

      return {
        success: true,
        message: 'Product details fetched successfully',
        data: product,
      };
    } catch (err:any) {
      log.error('DB error while fetching product details', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }
  }

  async deleteProduct(id: number, currentUser: any) {
    const log = this.appLogger.forContext('ProductService', 'deleteProduct', {
      productId: id,
    });

    log.info('Delete product attempt started');

    let product: products | null;
    try {
      product = await this.Products.findOne({ where: { id, company_id: currentUser.company_id } });
    } catch (err) {
      log.error('DB error while fetching product', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!product) {
      log.warn('Deletion failed — product not found');
      return { success: false, message: `Product with id ${id} not found` };
    }

    const VariantsModel = this.dbProvider.db.product_variants;
    const ImagesModel = this.dbProvider.db.product_images;
    const InventoryModel = this.dbProvider.db.product_inventory;
    const MetadataModel = this.dbProvider.db.product_metadata;
    const sequelize = this.dbProvider.sequelize;
    const transaction = await sequelize.transaction();

    try {
      await this.Products.update({ is_active: 0 }, { where: { id }, transaction });
      await VariantsModel.update(
        { is_active: 0 },
        { where: { product_id: id, is_active: 1 }, transaction },
      );
      await ImagesModel.update(
        { is_active: 0 },
        { where: { product_id: id, is_active: 1 }, transaction },
      );
      await InventoryModel.update(
        { is_active: 0 },
        { where: { product_id: id, is_active: 1 }, transaction },
      );
      await MetadataModel.update(
        { is_active: 0 },
        { where: { product_id: id, is_active: 1 }, transaction },
      );
      await transaction.commit();
    } catch (err:any) {
      await transaction.rollback();
      log.error('DB error while deleting product', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ productId: id }).info('Product deleted successfully');

    return {
      success: true,
      message: 'Product deleted successfully',
      data: { id },
    };
  }

  async activateProduct(id: number, currentUser: any) {
    const log = this.appLogger.forContext('ProductService', 'activateProduct', {
      productId: id,
    });

    log.info('Activate product attempt started');

    let product: products | null;
    try {
      product = await this.Products.findOne({ where: { id, company_id: currentUser.company_id } });
    } catch (err) {
      log.error('DB error while fetching product', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!product) {
      log.warn('Activation failed — product not found');
      return { success: false, message: `Product with id ${id} not found` };
    }

    try {
      await this.Products.update({ is_active: 1 }, { where: { id } });
    } catch (err:any) {
      log.error('DB error while activating product', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ productId: id }).info('Product activated successfully');

    return {
      success: true,
      message: 'Product activated successfully',
      data: { id },
    };
  }

  async deactivateProduct(id: number, currentUser: any) {
    const log = this.appLogger.forContext('ProductService', 'deactivateProduct', {
      productId: id,
    });

    log.info('Deactivate product attempt started');

    let product: products | null;
    try {
      product = await this.Products.findOne({ where: { id, company_id: currentUser.company_id } });
    } catch (err) {
      log.error('DB error while fetching product', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!product) {
      log.warn('Deactivation failed — product not found');
      return { success: false, message: `Product with id ${id} not found` };
    }

    try {
      await this.Products.update({ is_active: 0 }, { where: { id } });
    } catch (err:any) {
      log.error('DB error while deactivating product', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ productId: id }).info('Product deactivated successfully');

    return {
      success: true,
      message: 'Product deactivated successfully',
      data: { id },
    };
  }

  async updateProduct(id: number, data: UpdateProductDto, currentUser: any) {
    const log = this.appLogger.forContext('ProductService', 'updateProduct', {
      productId: id,
    });

    log.info('Update product attempt started');

    let product: products | null;
    try {
      product = await this.Products.findOne({
        where: { id, company_id: currentUser.company_id, is_active: true },
      });
    } catch (err) {
      log.error('DB error while fetching product', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!product) {
      log.warn('Update failed — product not found');
      return { success: false, message: `Product with id ${id} not found` };
    }

    const categoryError = await this.assertCategoryBelongsToCompany(data.category_id, product.company_id);
    if (categoryError) {
      log.warn('Update failed — category does not belong to this company');
      return categoryError;
    }

    const warehouseError = await this.assertWarehousesBelongToCompany(data.inventory, product.company_id);
    if (warehouseError) {
      log.warn('Update failed — warehouse does not belong to this company');
      return warehouseError;
    }

    if (data.product_code && data.product_code !== product.product_code) {
      let existingProduct: products | null;
      try {
        existingProduct = await this.Products.findOne({
          where: {
            company_id: product.company_id,
            product_code: data.product_code,
            id: { [Op.ne]: id },
          },
        });
      } catch (err) {
        log.error('DB error while checking product code uniqueness', err);
        throw new Error('DATABASE_ERROR');
      }

      if (existingProduct) {
        log.warn('Update failed — product code already in use');
        return {
          success: false,
          message: `${data.product_code} is already in use`,
        };
      }
    }

    const sequelize = this.dbProvider.sequelize;
    const VariantsModel = this.dbProvider.db.product_variants;
    const ImagesModel = this.dbProvider.db.product_images;
    const InventoryModel = this.dbProvider.db.product_inventory;
    const MetadataModel = this.dbProvider.db.product_metadata;
    const transaction = await sequelize.transaction();

    const syncNested = async (
      Model: any,
      payloadList: any[] | undefined,
      itemName: string,
      fieldsMapper: (item: any) => any,
      getRowKey?: (row: any) => string,
      getItemKey?: (item: any) => string,
    ) => {
      if (!Array.isArray(payloadList)) {
        return;
      }

      const existingRows = await Model.findAll({
        where: { product_id: id, is_active: 1 },
        transaction,
      });
      const existingIds = existingRows.map((row: any) => row.id);
      const existingByKey = getRowKey
        ? new Map(existingRows.map((row: any) => [getRowKey(row), row]))
        : new Map();

      const requestedIds = payloadList.filter((item) => item.id).map((item) => item.id);
      const requestedExistingIds = new Set<number>();

      if (getItemKey) {
        for (const item of payloadList) {
          if (item.id) {
            continue;
          }
          const key = getItemKey(item);
          if (key && existingByKey.has(key)) {
            requestedExistingIds.add(existingByKey.get(key).id);
          }
        }
      }

      if (existingIds.length > 0) {
        const idsToSoftDelete = existingIds.filter(
          (rowId) => !requestedIds.includes(rowId) && !requestedExistingIds.has(rowId),
        );
        if (idsToSoftDelete.length > 0) {
          await Model.update(
            { is_active: 0 },
            {
              where: {
                product_id: id,
                is_active: 1,
                id: { [Op.in]: idsToSoftDelete },
              },
              transaction,
            },
          );
        }
      }

      for (const item of payloadList) {
        const mappedData = fieldsMapper(item);
        const updateData = Object.fromEntries(
          Object.entries(mappedData).filter(([, value]) => value !== undefined),
        );

        if (item.id) {
          // Check row existence against `existingIds` (fetched up front) —
          // NOT against Model.update()'s returned affected-row count.
          // MySQL/mysql2 reports 0 affected rows whenever the WHERE
          // matches but no column value actually changed (e.g. saving a
          // variant/image without editing it) — that is NOT the same as
          // "row doesn't exist". Treating it as "doesn't exist" was
          // silently duplicating every unchanged existing row on each save.
          if (existingIds.includes(item.id)) {
            if (Object.keys(updateData).length > 0) {
              await Model.update(updateData, {
                where: { id: item.id, product_id: id },
                transaction,
              });
            }
          } else {
            // Client sent an id that doesn't belong to this product (e.g.
            // stale state) — create it fresh rather than silently no-op'ing.
            await Model.create({ product_id: id, ...mappedData }, { transaction });
          }

          continue;
        }

        if (getItemKey) {
          const itemKey = getItemKey(item);
          const existing = itemKey ? existingByKey.get(itemKey) : undefined;
          if (existing) {
            if (Object.keys(updateData).length === 0) {
              continue;
            }
            await Model.update(updateData, {
              where: { id: existing.id, product_id: id },
              transaction,
            });
            continue;
          }
        }

        await Model.create({ product_id: id, ...mappedData }, { transaction });
      }
    };

    try {
      await this.Products.update(
        {
          ...(data.product_code !== undefined && {
            product_code: data.product_code,
          }),
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          ...(data.unit !== undefined && { unit: data.unit }),
          ...(data.price !== undefined && { price: data.price }),
          ...(data.cost_price !== undefined && { cost_price: data.cost_price }),
          ...(data.tax_percentage !== undefined && {
            tax_percentage: data.tax_percentage,
          }),
          ...(data.sku !== undefined && { sku: data.sku }),
          ...(data.barcode !== undefined && { barcode: data.barcode }),
          ...(data.stock_quantity !== undefined && {
            stock_quantity: data.stock_quantity,
          }),
          ...(data.minimum_stock !== undefined && {
            minimum_stock: data.minimum_stock,
          }),
          ...(data.category_id !== undefined && {
            category_id: data.category_id,
          }),
          ...(data.image_url !== undefined && { image_url: data.image_url }),
        },
        { where: { id }, transaction },
      );

      await syncNested(
        VariantsModel,
        data.variants,
        'variant',
        (item) => ({
          sku: item.sku,
          attributes: item.attributes ?? null,
          price: item.price ?? 0,
          compare_at_price: item.compare_at_price ?? 0,
          cost_price: item.cost_price ?? 0,
          is_default: item.is_default ? 1 : 0,
          is_active: 1,
        }),
      );

      await syncNested(
        ImagesModel,
        data.images,
        'image',
        (item) => ({
          variant_id: item.variant_id ?? null,
          url: item.url,
          sort_order: item.sort_order ?? 0,
          metadata: item.metadata ?? null,
          is_active: 1,
        }),
      );

      await syncNested(
        InventoryModel,
        data.inventory,
        'inventory',
        (item) => ({
          variant_id: item.variant_id ?? null,
          stock_level: item.stock_level ?? 0,
          stock_policy: item.stock_policy ?? null,
          warehouse_id: item.warehouse_id ?? null,
          is_active: 1,
        }),
      );

      await syncNested(
        MetadataModel,
        data.metadata,
        'metadata',
        (item) => ({
          key: item.key,
          value: item.value ?? null,
          data_type: item.data_type ?? null,
          is_sensitive: item.is_sensitive ? 1 : 0,
          is_active: 1,
        }),
      );

      await transaction.commit();
    } catch (err:any) {
      await transaction.rollback();
      log.error('DB error while updating product', err, {
        mysqlError: err?.original?.message ?? err?.message,
        sql: err?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ productId: id }).info('Product updated successfully');

    const updated = await this.Products.findOne({
      where: { id },
      include: [
        {
          association: 'variants',
          required: false,
          separate: true,
          where: { is_active: true },
        },
        {
          association: 'images',
          required: false,
          separate: true,
          where: { is_active: true },
        },
        {
          association: 'inventory',
          required: false,
          separate: true,
          where: { is_active: true },
        },
        {
          association: 'metadata',
          required: false,
          separate: true,
          where: { is_active: true },
        },
      ],
    });

    return {
      success: true,
      message: 'Product updated successfully',
      data: updated,
    };
  }
}
