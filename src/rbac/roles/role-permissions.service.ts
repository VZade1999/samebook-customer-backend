import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';

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
          },
        });

      if (!role) {
        throw new NotFoundException(
          'Role not found',
        );
      }

      await this.db.db.role_permissions.destroy({
        where: {
          role_id: roleId,
        },
      });

      if (permissionIds.length) {
        await this.db.db.role_permissions.bulkCreate(
          permissionIds.map(
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