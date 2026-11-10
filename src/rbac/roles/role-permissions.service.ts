import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Op } from 'sequelize';

import { AppLogger } from 'src/common/logger/logger.service';
import { LogContext } from 'src/common/logger/logger.context';

@Injectable()
export class RolePermissionsService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
  ) {}

  async getRolePermissions(
    companyId: number,
    roleId: number,
  ) {
    const ctx = new LogContext(
      'RolePermissionsService',
      'getRolePermissions',
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
              model: this.db.db.role_permissions,
              as: 'role_permissions',
              include: [
                {
                  model: this.db.db.permission,
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
        role_id: role.id,
        role_name: role.name,
        permissions:
          role.role_permissions?.map(
            (rp: any) => ({
              id: rp.permission?.id,
              name: rp.permission?.name,
              description:
                rp.permission?.description,
            }),
          ) || [],
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching role permissions',
        error,
      );

      throw error;
    }
  }

  async assignPermissions(
    companyId: number,
    roleId: number,
    permissionIds: number[],
  ) {
    const ctx = new LogContext(
      'RolePermissionsService',
      'assignPermissions',
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

      // System roles are shared by every tenant, so no tenant may change
      // their permissions. Also require ownership explicitly.
      if (
        Number(role.is_system) === 1 ||
        Number(role.company_id) !== Number(companyId)
      ) {
        throw new ForbiddenException(
          'System roles cannot be modified',
        );
      }

      if (!Array.isArray(permissionIds)) {
        throw new BadRequestException(
          'permission_ids must be an array',
        );
      }

      const ids = permissionIds.map(
        (id: any) => Number(id),
      );

      if (
        ids.some(
          (id) =>
            !Number.isInteger(id) || id <= 0,
        )
      ) {
        throw new BadRequestException(
          'permission_ids must contain positive integers',
        );
      }

      const uniqueIds = [...new Set(ids)];

      if (uniqueIds.length) {
        const existingCount =
          await this.db.db.permission.count({
            where: {
              id: { [Op.in]: uniqueIds },
            },
          });

        if (existingCount !== uniqueIds.length) {
          throw new BadRequestException(
            'One or more permissions are invalid',
          );
        }
      }

      await this.db.db.role_permissions.destroy({
        where: {
          role_id: roleId,
        },
      });

      if (uniqueIds.length) {
        await this.db.db.role_permissions.bulkCreate(
          uniqueIds.map(
            (permissionId: number) => ({
              role_id: roleId,
              permission_id: permissionId,
            }),
          ),
        );
      }

      return {
        message:
          'Permissions assigned successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error assigning permissions',
        error,
      );

      throw error;
    }
  }
}