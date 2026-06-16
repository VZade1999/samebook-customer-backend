import { ConflictException, Injectable, Inject } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from 'src/common/logger/logger.service';
import { LogContext } from 'src/common/logger/logger.context';

@Injectable()
export class UsersService {
  constructor(
    @Inject('DATABASE_CONNECTION')
    private db: any,
    private logger: AppLogger,
  ) {}

  async listUsers(
    companyId: number,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ) {
    const ctx = new LogContext('UsersService', 'listUsers', {
      companyId,
      page,
      limit,
      search,
    });

    try {
      const offset = (page - 1) * limit;
      const where: any = {
        company_id: companyId,
        is_active: 1,
      };

      if (search) {
        where[Op.or] = [
          { first_name: { [Op.like]: `%${search}%` } },
          { last_name: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } },
        ];
      }

      const { count, rows } = await this.db.db.users.findAndCountAll({
        where,
        include: [
          {
            model: this.db.db.user_roles,
            as: 'user_roles',
            required: false,
            include: [{ model: this.db.db.roles, as: 'role', required: false }],
          },
        ],
        distinct: true,
        limit,
        offset,
        order: [['created_at', 'DESC']],
      });
console.log('Fetched users:', rows);
      return {
        users: rows.map((user: any) => ({
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone: user.phone,
          roles: user.user_roles?.map((ur: any) => ({
            id: ur.role?.id,
            name: ur.role?.name,
          })),
          created_at: user.created_at,
          updated_at: user.updated_at,
        })),
        pagination: {
          total: count,
          page,
          limit,
          pages: Math.ceil(count / limit),
        },
      };
    } catch (error) {
      this.logger.error(ctx, 'Error listing users', error);
      throw error;
    }
  }

  async createUser(companyId: number, payload: any) {
    const ctx = new LogContext('UsersService', 'createUser', { companyId });

    try {
      const bcrypt = require('bcrypt');

      const existingUser = await this.db.db.users.findOne({
        where: {
          email: payload.email,
          company_id: companyId,
        },
      });

      if (existingUser) {
        throw new ConflictException('A user with this email already exists.');
      }

      const hashedPassword = await bcrypt.hash(payload.password, 10);

      const user = await this.db.db.users.create({
        company_id: companyId,
        first_name: payload.first_name,
        last_name: payload.last_name,
        email: payload.email,
        phone: payload.phone,
        password: hashedPassword,
        is_active: 1,
      });

      if (payload.role_ids && payload.role_ids.length) {
        await this.db.db.user_roles.bulkCreate(
          payload.role_ids.map((roleId: number) => ({
            user_id: user.id,
            role_id: roleId,
          })),
        );
      }

      return {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        message: 'User created successfully',
      };
    } catch (error) {
      this.logger.error(ctx, 'Error creating user', error);
      throw error;
    }
  }

  async updateUser(companyId: number, userId: number, payload: any) {
    const ctx = new LogContext('UsersService', 'updateUser', {
      companyId,
      userId,
    });

    try {
      const bcrypt = require('bcrypt');

      const user = await this.db.db.users.findOne({
        where: {
          id: userId,
          company_id: companyId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (payload.email && payload.email !== user.email) {
        const existingUser = await this.db.db.users.findOne({
          where: {
            email: payload.email,
            company_id: companyId,
            id: {
              [Op.ne]: userId,
            },
          },
        });

        if (existingUser) {
          throw new ConflictException('Email already exists');
        }
      }

      const updateData: any = {
        first_name: payload.first_name ?? user.first_name,

        last_name: payload.last_name ?? user.last_name,

        email: payload.email ?? user.email,

        phone: payload.phone ?? user.phone,
      };

      if (payload.password) {
        updateData.password = await bcrypt.hash(payload.password, 10);
      }

      await user.update(updateData);

      if (payload.role_ids && Array.isArray(payload.role_ids)) {
        await this.db.db.user_roles.destroy({
          where: {
            user_id: userId,
          },
        });

        if (payload.role_ids.length) {
          await this.db.db.user_roles.bulkCreate(
            payload.role_ids.map((roleId: number) => ({
              user_id: userId,
              role_id: roleId,
            })),
          );
        }
      }

      return {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        message: 'User updated successfully',
      };
    } catch (error) {
      this.logger.error(ctx, 'Error updating user', error);

      throw error;
    }
  }

  async getUserPermissions(companyId: number, userId: number) {
    const user = await this.db.db.users.findOne({
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
            },
          ],
        },
      ],
    });

    if (!user) {
      throw new Error('User not found');
    }

    const permissions = [
      ...new Set(
        user.user_roles.flatMap(
          (ur: any) =>
            ur.role?.role_permissions?.map((rp: any) => rp.permission?.name) ||
            [],
        ),
      ),
    ];

    return {
      user_id: user.id,
      permissions,
    };
  }

  async softDeleteUser(companyId: number, userId: number) {
    const ctx = new LogContext('UsersService', 'softDeleteUser', {
      companyId,
      userId,
    });

    try {
      const user = await this.db.db.users.findOne({
        where: { id: userId, company_id: companyId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      await user.update({ is_active: 0 });

      return {
        message: 'User deleted successfully',
      };
    } catch (error) {
      this.logger.error(ctx, 'Error deleting user', error);
      throw error;
    }
  }

  async getRoles(companyId: number) {
    const ctx = new LogContext('UsersService', 'getRoles', { companyId });

    try {
      const roles = await this.db.db.roles.findAll({
        where: {
          [Op.or]: [{ company_id: companyId }, { is_system: 1 }],
        },
        order: [['name', 'ASC']],
      });

      return roles.map((role: any) => ({
        id: role.id,
        name: role.name,
        description: role.description,
      }));
    } catch (error) {
      this.logger.error(ctx, 'Error fetching roles', error);
      throw error;
    }
  }

  async getUserById(companyId: number, userId: number) {
    const ctx = new LogContext('UsersService', 'getUserById', {
      companyId,
      userId,
    });

    try {
      const user = await this.db.db.users.findOne({
        where: { id: userId, company_id: companyId },
        include: [
          {
            model: this.db.db.user_roles,
            include: [{ model: this.db.db.roles }],
          },
        ],
      });

      if (!user) {
        throw new Error('User not found');
      }

      return {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        roles: user.user_roles?.map((ur: any) => ({
          id: ur.role?.id,
          name: ur.role?.name,
        })),
      };
    } catch (error) {
      this.logger.error(ctx, 'Error fetching user', error);
      throw error;
    }
  }
}
