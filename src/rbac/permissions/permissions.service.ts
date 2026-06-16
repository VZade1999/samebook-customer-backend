
import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';

import { Op } from 'sequelize';

import { AppLogger } from 'src/common/logger/logger.service';
import { LogContext } from 'src/common/logger/logger.context';

@Injectable()
export class PermissionsService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
  ) {}

  async listPermissions(
    page = 1,
    limit = 10,
    search?: string,
  ) {
    const ctx = new LogContext(
      'PermissionsService',
      'listPermissions',
      {
        page,
        limit,
        search,
      },
    );

    try {
      const offset = (page - 1) * limit;

      const where: any = {};

      if (search) {
        where[Op.or] = [
          {
            name: {
              [Op.like]: `%${search}%`,
            },
          },
          {
            description: {
              [Op.like]: `%${search}%`,
            },
          },
        ];
      }
console.log('permissions')
      const { count, rows } =
        await this.db.db.permission.findAndCountAll({
          where,
          limit,
          offset,
          order: [['name', 'ASC']],
        });
console.log(rows,'permissions')
      return {
        permissions: rows.map(
          (permission: any) => ({
            id: permission.id,
            name: permission.name,
            module_name: permission.module_name,
            description:
              permission.description,
            created_at:
              permission.created_at,
          }),
        ),
        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(
            count / limit,
          ),
        },
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error listing permissions',
        error,
      );
      throw error;
    }
  }

  async createPermission(
    payload: any,
  ) {
    const ctx = new LogContext(
      'PermissionsService',
      'createPermission',
      payload,
    );

    try {
      const existingPermission =
        await this.db.db.permission.findOne({
          where: {
            name: payload.name,
          },
        });

      if (existingPermission) {
        throw new ConflictException(
          'Permission already exists',
        );
      }

      const permission =
        await this.db.db.permission.create({
          name: payload.name,
          description:
            payload.description,
        });

      return {
        id: permission.id,
        name: permission.name,
        description:
          permission.description,
        message:
          'Permission created successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error creating permission',
        error,
      );
      throw error;
    }
  }

  async updatePermission(
    permissionId: number,
    payload: any,
  ) {
    const ctx = new LogContext(
      'PermissionsService',
      'updatePermission',
      {
        permissionId,
      },
    );

    try {
      const permission =
        await this.db.db.permission.findOne({
          where: {
            id: permissionId,
          },
        });

      if (!permission) {
        throw new NotFoundException(
          'Permission not found',
        );
      }

      await permission.update({
        name:
          payload.name ??
          permission.name,
        description:
          payload.description ??
          permission.description,
      });

      return {
        id: permission.id,
        name: permission.name,
        description:
          permission.description,
        message:
          'Permission updated successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error updating permission',
        error,
      );
      throw error;
    }
  }

  async deletePermission(
    permissionId: number,
  ) {
    const ctx = new LogContext(
      'PermissionsService',
      'deletePermission',
      {
        permissionId,
      },
    );

    try {
      const permission =
        await this.db.db.permission.findOne({
          where: {
            id: permissionId,
          },
        });

      if (!permission) {
        throw new NotFoundException(
          'Permission not found',
        );
      }

      await this.db.db.role_permissions.destroy(
        {
          where: {
            permission_id:
              permissionId,
          },
        },
      );

      await permission.destroy();

      return {
        message:
          'Permission deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error deleting permission',
        error,
      );
      throw error;
    }
  }

  async getPermissions() {
    const ctx = new LogContext(
      'PermissionsService',
      'getPermissions',
      {},
    );

    try {
      const permissions =
        await this.db.db.permission.findAll({
          order: [['name', 'ASC']],
        });

      return permissions.map(
        (permission: any) => ({
          id: permission.id,
          name: permission.name,
          description:
            permission.description,
        }),
      );
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching permissions',
        error,
      );
      throw error;
    }
  }

  async getPermissionById(
    permissionId: number,
  ) {
    const ctx = new LogContext(
      'PermissionsService',
      'getPermissionById',
      {
        permissionId,
      },
    );

    try {
      const permission =
        await this.db.db.permission.findOne({
          where: {
            id: permissionId,
          },
        });

      if (!permission) {
        throw new NotFoundException(
          'Permission not found',
        );
      }

      return {
        id: permission.id,
        name: permission.name,
        description:
          permission.description,
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching permission',
        error,
      );
      throw error;
    }
  }
}

