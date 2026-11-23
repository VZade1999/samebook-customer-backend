import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { CacheService, companyScope } from '../common/cache/cache.service';
import { CreateCategoryDto } from './dto/createCategory.dto';
import { UpdateCategoryDto } from './dto/updateCategory.dto';

// Self-service only: every method here resolves to the caller's own company
// (req.user.company_id, set by AuthGuard from the JWT) — there is no
// cross-company listing, creation, or deletion in this app.
export interface CategoryRequester {
  companyId: number;
}

@Injectable()
export class CategoriesService {
  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly cache: CacheService,
  ) {}

  private get Categories() {
    return this.dbProvider.db.product_categories;
  }

  private get Products() {
    return this.dbProvider.db.products;
  }

  private sql(sql: string, replacements: Record<string, unknown>, transaction?: any) {
    return this.dbProvider.sequelize.query(sql, { type: QueryTypes.SELECT, replacements, transaction }) as Promise<any[]>;
  }

  /**
   * Where a category may sit: two levels at most (category › sub-category),
   * never under itself, and no two with the same name side by side.
   * Returns a message when not allowed.
   */
  private async placementProblem(companyId: number, name: string, parentId: number | null, exceptId = 0): Promise<string | null> {
    if (parentId) {
      if (parentId === exceptId) return 'A category cannot be its own parent';
      const [parent] = await this.sql(
        `SELECT id, parent_category_id FROM product_categories WHERE id = :p AND company_id = :c AND is_active = 1`,
        { p: parentId, c: companyId },
      );
      if (!parent) return `Parent category with id ${parentId} not found`;
      if (parent.parent_category_id) return 'Sub-categories can’t have their own sub-categories — pick a main category';
      if (exceptId) {
        const [kids] = await this.sql(
          `SELECT COUNT(*) AS n FROM product_categories WHERE parent_category_id = :id AND company_id = :c AND is_active = 1`,
          { id: exceptId, c: companyId },
        );
        if (Number(kids?.n) > 0) return 'This category has sub-categories, so it can’t go under another one';
      }
    }
    const [clash] = await this.sql(
      `SELECT id FROM product_categories
       WHERE company_id = :c AND is_active = 1 AND id <> :x AND parent_category_id <=> :p AND LOWER(TRIM(name)) = LOWER(TRIM(:n)) LIMIT 1`,
      { c: companyId, x: exceptId, p: parentId ?? null, n: name },
    );
    return clash ? `There's already a category called "${name}" ${parentId ? 'there' : ''}`.trim() : null;
  }

  /** Every category with its product count (sub-categories included), and how many products have none. */
  async directory(requester: CategoryRequester) {
    const [cats, [totals]] = await Promise.all([
      this.sql(
        `SELECT c.id, c.name, c.description, c.parent_category_id, DATE_FORMAT(c.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
                COUNT(p.id) AS products, COALESCE(SUM(GREATEST(p.stock_quantity, 0)), 0) AS units
         FROM product_categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.company_id = c.company_id AND p.is_active = 1
         WHERE c.company_id = :c AND c.is_active = 1
         GROUP BY c.id ORDER BY c.name`,
        { c: requester.companyId },
      ),
      this.sql(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(p.category_id IS NULL OR c.id IS NULL), 0) AS uncategorised
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id AND c.company_id = p.company_id AND c.is_active = 1
         WHERE p.company_id = :c AND p.is_active = 1`,
        { c: requester.companyId },
      ),
    ]);
    const rows = cats.map((c) => ({
      id: Number(c.id),
      name: String(c.name),
      description: c.description ? String(c.description) : null,
      parent_id: c.parent_category_id ? Number(c.parent_category_id) : null,
      products: Number(c.products) || 0,
      units: Number(c.units) || 0,
      created_at: c.created_at,
    }));
    const known = new Set(rows.map((r) => r.id));
    // A sub-category whose parent is gone shows as a main category.
    rows.forEach((r) => r.parent_id && !known.has(r.parent_id) && (r.parent_id = null));
    return {
      categories: rows.map((r) => ({
        ...r,
        children: rows.filter((k) => k.parent_id === r.id).length,
        total: r.products + rows.filter((k) => k.parent_id === r.id).reduce((s, k) => s + k.products, 0),
      })),
      total_products: Number(totals?.total) || 0,
      uncategorised: Number(totals?.uncategorised) || 0,
    };
  }

  /**
   * Delete a category: its products move to another category (or to none),
   * its sub-categories become main categories.
   */
  async removeCategory(id: number, moveTo: number | null, requester: CategoryRequester) {
    const [cat] = await this.sql(`SELECT id, name FROM product_categories WHERE id = :id AND company_id = :c AND is_active = 1`, { id, c: requester.companyId });
    if (!cat) return { success: false, message: `Category with id ${id} not found` };
    let target: any = null;
    if (moveTo) {
      if (moveTo === id) return { success: false, message: 'Pick a different category for its products' };
      [target] = await this.sql(`SELECT id, name FROM product_categories WHERE id = :id AND company_id = :c AND is_active = 1`, { id: moveTo, c: requester.companyId });
      if (!target) return { success: false, message: 'The category to move its products to was not found' };
    }
    const t = await this.dbProvider.sequelize.transaction();
    try {
      const [moved]: any = await this.dbProvider.sequelize.query(
        `UPDATE products SET category_id = :to, updated_at = NOW() WHERE company_id = :c AND category_id = :id`,
        { replacements: { to: target ? Number(target.id) : null, c: requester.companyId, id }, transaction: t },
      );
      await this.dbProvider.sequelize.query(
        `UPDATE product_categories SET parent_category_id = NULL, updated_at = NOW() WHERE company_id = :c AND parent_category_id = :id`,
        { replacements: { c: requester.companyId, id }, transaction: t },
      );
      await this.dbProvider.sequelize.query(`UPDATE product_categories SET is_active = 0, updated_at = NOW() WHERE id = :id`, {
        replacements: { id },
        transaction: t,
      });
      await t.commit();
      const n = Number(moved?.affectedRows ?? moved) || 0;
      return {
        success: true,
        message: n ? `${cat.name} deleted — ${n} product${n === 1 ? '' : 's'} ${target ? `moved to ${target.name}` : 'now have no category'}` : `${cat.name} deleted`,
        data: { id, moved: n },
      };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  async listCategories(requester: CategoryRequester) {
    const log = this.appLogger.forContext('CategoriesService', 'listCategories', {
      companyId: requester.companyId,
    });

    log.info('Fetching categories list');

    try {
      // Rarely changes; create/update/delete bump c<id>:categories (controller).
      const categories = await this.cache.wrap(
        { scopes: [companyScope(requester.companyId, 'categories')], key: 'list', ttl: 600 },
        async () =>
          (
            await this.Categories.findAll({
              where: { company_id: requester.companyId, is_active: 1 },
              order: [['name', 'ASC']],
            })
          ).map((c: any) => c.toJSON()),
      );
      return { success: true, message: 'Categories fetched successfully', data: categories };
    } catch (err) {
      log.error('DB error while listing categories', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async createCategory(data: CreateCategoryDto, requester: CategoryRequester) {
    const log = this.appLogger.forContext('CategoriesService', 'createCategory', {
      companyId: requester.companyId,
    });

    log.info('Create category attempt started');

    const name = String(data.name ?? '').trim();
    if (!name) return { success: false, message: 'Give the category a name' };
    const problem = await this.placementProblem(requester.companyId, name, data.parent_category_id ?? null);
    if (problem) {
      log.warn(`Creation rejected — ${problem}`);
      return { success: false, message: problem };
    }

    try {
      const category = await this.Categories.create({
        company_id: requester.companyId,
        name,
        description: data.description?.trim() || null,
        parent_category_id: data.parent_category_id ?? null,
      });
      log.info('Category created successfully');
      return { success: true, message: `${name} added`, data: category };
    } catch (err) {
      log.error('DB error while creating category', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async updateCategory(id: number, data: UpdateCategoryDto, requester: CategoryRequester) {
    const log = this.appLogger.forContext('CategoriesService', 'updateCategory', {
      companyId: requester.companyId,
      categoryId: id,
    });

    log.info('Update category attempt started');

    const category = await this.Categories.findOne({
      where: { id, company_id: requester.companyId, is_active: 1 },
    });
    if (!category) {
      log.warn('Update failed — category not found');
      return { success: false, message: `Category with id ${id} not found` };
    }

    const name = data.name !== undefined ? String(data.name).trim() : String(category.name);
    if (!name) return { success: false, message: 'Give the category a name' };
    const parent = data.parent_category_id !== undefined ? data.parent_category_id ?? null : category.parent_category_id ?? null;
    const problem = await this.placementProblem(requester.companyId, name, parent ? Number(parent) : null, id);
    if (problem) {
      log.warn(`Update rejected — ${problem}`);
      return { success: false, message: problem };
    }

    try {
      await category.update({
        ...(data.name !== undefined && { name }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.parent_category_id !== undefined && { parent_category_id: data.parent_category_id ?? null }),
      });
      log.info('Category updated successfully');
      return { success: true, message: `${name} saved`, data: category };
    } catch (err) {
      log.error('DB error while updating category', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async deleteCategory(id: number, requester: CategoryRequester) {
    const log = this.appLogger.forContext('CategoriesService', 'deleteCategory', {
      companyId: requester.companyId,
      categoryId: id,
    });

    log.info('Delete category attempt started');

    const category = await this.Categories.findOne({
      where: { id, company_id: requester.companyId, is_active: 1 },
    });
    if (!category) {
      log.warn('Delete failed — category not found');
      return { success: false, message: `Category with id ${id} not found` };
    }

    const productsInUse = await this.Products.count({
      where: { category_id: id, company_id: requester.companyId, is_active: 1 },
    });
    if (productsInUse > 0) {
      log.warn('Delete rejected — category still in use by products');
      return {
        success: false,
        message: `Cannot delete — ${productsInUse} product(s) still use this category`,
      };
    }

    const subcategoriesInUse = await this.Categories.count({
      where: { parent_category_id: id, company_id: requester.companyId, is_active: 1 },
    });
    if (subcategoriesInUse > 0) {
      log.warn('Delete rejected — category still has subcategories');
      return {
        success: false,
        message: `Cannot delete — ${subcategoriesInUse} subcategory(ies) still use this category as parent`,
      };
    }

    try {
      await category.update({ is_active: 0 });
      log.info('Category deleted successfully');
      return { success: true, message: 'Category deleted successfully', data: { id } };
    } catch (err) {
      log.error('DB error while deleting category', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
