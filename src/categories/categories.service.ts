import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
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
  ) {}

  private get Categories() {
    return this.dbProvider.db.product_categories;
  }

  private get Products() {
    return this.dbProvider.db.products;
  }

  private async assertParentBelongsToCompany(
    parentCategoryId: number | undefined,
    companyId: number,
  ): Promise<{ success: false; message: string } | null> {
    if (parentCategoryId === undefined || parentCategoryId === null) return null;
    const parent = await this.Categories.findOne({
      where: { id: parentCategoryId, company_id: companyId, is_active: 1 },
    });
    if (!parent) {
      return { success: false, message: `Parent category with id ${parentCategoryId} not found` };
    }
    return null;
  }

  async listCategories(requester: CategoryRequester) {
    const log = this.appLogger.forContext('CategoriesService', 'listCategories', {
      companyId: requester.companyId,
    });

    log.info('Fetching categories list');

    try {
      const categories = await this.Categories.findAll({
        where: { company_id: requester.companyId, is_active: 1 },
        order: [['name', 'ASC']],
      });
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

    const parentError = await this.assertParentBelongsToCompany(data.parent_category_id, requester.companyId);
    if (parentError) {
      log.warn('Creation failed — parent category does not belong to this company');
      return parentError;
    }

    try {
      const category = await this.Categories.create({
        company_id: requester.companyId,
        name: data.name,
        description: data.description ?? null,
        parent_category_id: data.parent_category_id ?? null,
      });
      log.info('Category created successfully');
      return { success: true, message: 'Category created successfully', data: category };
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

    if (data.parent_category_id !== undefined && data.parent_category_id !== null) {
      if (data.parent_category_id === id) {
        return { success: false, message: 'A category cannot be its own parent' };
      }
      const parentError = await this.assertParentBelongsToCompany(data.parent_category_id, requester.companyId);
      if (parentError) {
        log.warn('Update failed — parent category does not belong to this company');
        return parentError;
      }
    }

    try {
      await category.update({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.parent_category_id !== undefined && { parent_category_id: data.parent_category_id }),
      });
      log.info('Category updated successfully');
      return { success: true, message: 'Category updated successfully', data: category };
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
