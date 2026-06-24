import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';

import { AppLogger } from '../../common/logger/logger.service';
import { LogContext } from '../../common/logger/logger.context';

@Injectable()
export class UserRolesService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
  ) {}

  async getUserRoles(
    companyId: number,
    userId: number,
  ) {
    const ctx = new LogContext(
      'UserRolesService',
      'getUserRoles',
      {
        companyId,
        userId,
      },
    );

    try {
      const user =
        await this.db.db.users.findOne({
          where: {
            id: userId,
            company_id: companyId,
          },
          include: [
            {
              model: this.db.db.user_roles,
              as: 'user_roles',
              include: [
                {
                  model: this.db.db.roles,
                  as: 'role',
                },
              ],
            },
          ],
        });

      if (!user) {
        throw new NotFoundException(
          'User not found',
        );
      }

      return {
        user_id: user.id,
        user_name:
          `${user.first_name} ${user.last_name}`,
        roles:
          user.user_roles?.map(
            (ur: any) => ({
              id: ur.role?.id,
              name: ur.role?.name,
              description:
                ur.role?.description,
            }),
          ) || [],
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error fetching user roles',
        error,
      );

      throw error;
    }
  }

  async assignRoles(
    companyId: number,
    userId: number,
    roleIds: number[],
  ) {
    const ctx = new LogContext(
      'UserRolesService',
      'assignRoles',
      {
        companyId,
        userId,
      },
    );

    try {
      const user =
        await this.db.db.users.findOne({
          where: {
            id: userId,
            company_id: companyId,
          },
        });

      if (!user) {
        throw new NotFoundException(
          'User not found',
        );
      }

      await this.db.db.user_roles.destroy({
        where: {
          user_id: userId,
        },
      });

      if (roleIds.length) {
        await this.db.db.user_roles.bulkCreate(
          roleIds.map(
            (roleId: number) => ({
              user_id: userId,
              role_id: roleId,
            }),
          ),
        );
      }

      return {
        message:
          'Roles assigned successfully',
      };
    } catch (error) {
      this.logger.error(
        ctx,
        'Error assigning roles',
        error,
      );

      throw error;
    }
  }
}