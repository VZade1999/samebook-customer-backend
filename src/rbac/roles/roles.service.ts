
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';

import { AppLogger } from 'src/common/logger/logger.service';
import { LogContext } from 'src/common/logger/logger.context';

@Injectable()
export class RolesService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
  ) {}

  async listRoles(
    companyId: number,
    page = 1,
    limit = 10,
    search?: string,
  ) {
    const ctx = new LogContext(
      'RolesService',
      'listRoles',
      {
        companyId,
        page,
        limit,
        search,
      },
    );

    try {
      const offset = (page - 1) * limit;

      const where: any = {
        [Op.or]: [
          { company_id: companyId },
          { is_system: 1 },
        ],
      };

      if (search) {
        where.name = {
          [Op.like]: `%${search}%`,
        };
      }

      const { count, rows } =
        await this.db.db.roles.findAndCountAll({
          where,
          limit,
          offset,
          order: [['name', 'ASC']],
        });

      return {
        roles: rows.map((role: any) => ({
          id: role.id,
          company_id: role.company_id,
          name: role.name,
          description: role.description,
          is_system: role.is_system,
          created_at: role.created_at,
          updated_at: role.updated_at,
        })),
        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(count / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error listing roles',
        error,
      );
      throw error;
    }
  }

  async createRole(
    companyId: number,
    payload: any,
  ) {
    const ctx = new LogContext(
      'RolesService',
      'createRole',
      { companyId },
    );

    try {
      const existingRole =
        await this.db.db.roles.findOne({
          where: {
            company_id: companyId,
            name: payload.name,
          },
        });

      if (existingRole) {
        throw new ConflictException(
          'Role already exists',
        );
      }

      const role =
        await this.db.db.roles.create({
          company_id: companyId,
          name: payload.name,
          description: payload.description,
          is_system: 0,
        });

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        message:
          'Role created successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error creating role',
        error,
      );
      throw error;
    }
  }

  async updateRole(
    companyId: number,
    roleId: number,
    payload: any,
  ) {
    const ctx = new LogContext(
      'RolesService',
      'updateRole',
      {
        companyId,
        roleId,
      },
    );

    try {
      const role =
        await this.db.db.roles.findOne({
          where: {
            id: roleId,
            [Op.or]: [
              { company_id: companyId },
              { is_system: 1 },
            ],
          },
        });

      if (!role) {
        throw new NotFoundException(
          'Role not found',
        );
      }

      await role.update({
        name:
          payload.name ?? role.name,
        description:
          payload.description ??
          role.description,
      });

      return {
        id: role.id,
        name: role.name,
        description:
          role.description,
        message:
          'Role updated successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error updating role',
        error,
      );
      throw error;
    }
  }

  async deleteRole(
    companyId: number,
    roleId: number,
  ) {
    const ctx = new LogContext(
      'RolesService',
      'deleteRole',
      {
        companyId,
        roleId,
      },
    );

    try {
      const role =
        await this.db.db.roles.findOne({
          where: {
            id: roleId,
            company_id: companyId,
          },
        });

      if (!role) {
        throw new NotFoundException(
          'Role not found',
        );
      }

      await this.db.db.user_roles.destroy({
        where: {
          role_id: roleId,
        },
      });

      await this.db.db.role_permissions.destroy(
        {
          where: {
            role_id: roleId,
          },
        },
      );

      await role.destroy();

      return {
        message:
          'Role deleted successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error deleting role',
        error,
      );
      throw error;
    }
  }

  async getRoles(companyId: number) {
    const ctx = new LogContext(
      'RolesService',
      'getRoles',
      { companyId },
    );

    try {
      const roles =
        await this.db.db.roles.findAll({
          where: {
            [Op.or]: [
              { company_id: companyId },
              { is_system: 1 },
            ],
          },
          order: [['name', 'ASC']],
        });

      return roles.map((role: any) => ({
        id: role.id,
        name: role.name,
        description:
          role.description,
      }));
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching roles',
        error,
      );
      throw error;
    }
  }

  async getRoleById(
    companyId: number,
    roleId: number,
  ) {
    const ctx = new LogContext(
      'RolesService',
      'getRoleById',
      {
        companyId,
        roleId,
      },
    );

    try {
      const role =
        await this.db.db.roles.findOne({
          where: {
            id: roleId,
            [Op.or]: [
              { company_id: companyId },
              { is_system: 1 },
            ],
          },
          include: [
            {
              model:
                this.db.db.role_permissions,
              as: 'role_permissions',
              include: [
                {
                  model:
                    this.db.db.permission,
                  as: 'permission',
                },
              ],
            },
          ],
        });

      if (!role) {
        throw new NotFoundException(
          'Role not found',
        );
      }

      return {
        id: role.id,
        name: role.name,
        description:
          role.description,
        permissions:
          role.role_permissions?.map(
            (rp: any) => ({
              id:
                rp.permission?.id,
              name:
                rp.permission?.name,
            }),
          ) || [],
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching role',
        error,
      );
      throw error;
    }
  }
}

