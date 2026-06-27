import {
  Inject,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { users } from '../models/users';
import { user_roles } from '../models/user.roles';
import { role_permissions } from '../models/role.permissions';
import { permissions } from '../models/permissions';
import { roles } from '../models/roles';

import * as bcrypt from 'bcrypt';
import { AppLogger } from '../common/logger/logger.service';
import { companies } from '../models/companies';
import { generateAccessToken, generateRefreshToken } from 'src/Util/response.util';



@Injectable()
export class AuthService {
  private readonly Users: typeof users;
  private readonly UserRole: typeof user_roles;
  private readonly RolePermissions: typeof role_permissions;
  private readonly Permissions: typeof permissions;
  private readonly Roles: typeof roles;
  private readonly Companies: typeof companies;

  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {
    this.Users = this.dbProvider.db.users;
    this.UserRole = this.dbProvider.db.user_roles;
    this.RolePermissions = this.dbProvider.db.role_permissions;
    this.Permissions = this.dbProvider.db.permission;
    this.Roles = this.dbProvider.db.roles;
    this.Companies = this.dbProvider.db.companies;
  }

  async login(username: string, password: string) {
    const log = this.appLogger.forContext('AuthService', 'login', {
      email: username,
    });
    log.info('Login attempt started');

    let user: any;
    try {
      user = await this.Users.findOne({
        where: { email: username },

        include: [
          {
            model: this.Companies,
            as: 'company',
            attributes: [
              'id',
              'name',
              'primary_email',
              'primary_phone',
              'default_terms_conditions',
              'logo',
            ],
          },
        ],
      });
    } catch (err) {
      log.error('DB error while fetching user', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!user) {
      log.warn('Login failed — user not found');
      return { success: false, message: 'Invalid email or password' };
    }

    // Enrich all subsequent logs with userId
    const logU = log.enrich({ userId: user.id });

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (err) {
      logU.error('bcrypt comparison error', err);
      throw new Error('AUTH_INTERNAL_ERROR');
    }

    if (!isMatch) {
      logU.warn('Login failed — password mismatch');
      return { success: false, message: 'Invalid email or password' };
    }

    let userDetails: any[];
    try {
      userDetails = await this.UserRole.findAll({
        where: { user_id: user.id },
        include: [
          {
            model: this.Roles,
            as: 'role',
            include: [
              {
                model: this.RolePermissions,
                as: 'role_permissions',
                include: [{ model: this.Permissions, as: 'permission' }],
              },
            ],
          },
        ],
      });
    } catch (err) {
      logU.error('DB error while fetching roles', err);
      throw new Error('DATABASE_ERROR');
    }

    const roleNames: string[] = userDetails
      .map((i: any) => i.role?.name)
      .filter(Boolean);

    const permissionNames: string[] = [
      ...new Set(
        userDetails.flatMap(
          (i: any) =>
            i.role?.role_permissions
              ?.map((rp: any) => rp.permission?.name)
              .filter(Boolean) ?? [],
        ),
      ),
    ];

    logU.debug('Roles resolved', {
      roles: roleNames.join(','),
      permissionCount: permissionNames.length,
    });

    const payload = {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      roles: roleNames,
      permissions: permissionNames,
    };
    let accessToken: string;
    let refreshToken: string;

    try {
      accessToken = generateAccessToken(payload);
      refreshToken = generateRefreshToken(payload);
    } catch (err) {
      logU.error('Token generation failed', err);
      throw new Error('TOKEN_GENERATION_ERROR');
    }

    this.Users.update({ last_login: new Date() }, { where: { id: user.id } })
      .then(() => logU.debug('last_login updated'))
      .catch((err: any) =>
        logU.warn('Non-critical: last_login update failed', err),
      );

    logU.info('Login successful');

    return {
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          company_id: user.company_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone: user.phone,
          company: user.company
            ? {
                id: user.company.id,
                name: user.company.name,
                email: user.company.email,
                phone: user.company.phone,
                address: user.company.address,
                logo: user.company.logo,
                default_terms_conditions: user.company.default_terms_conditions,
                is_active: user.company.is_active,
              }
            : null,
          roles: roleNames,
          permissions: permissionNames,
        },
      },
    };
  }

  async register(
    first_name: string,
    last_name: string,
    email: string,
    phone: string,
    password: string,
  ) {
    const log = this.appLogger.forContext('AuthService', 'register', {
      email,
    });

    log.info('Registration attempt started');

    let existingUser: any;
    try {
      existingUser = await this.Users.findOne({ where: { email } });
    } catch (err) {
      log.error('DB error while checking existing email', err);
      throw new Error('DATABASE_ERROR');
    }

    if (existingUser) {
      log.warn('Registration failed — email already exists');
      return { success: false, message: 'Email already exists' };
    }

    let hashedPassword: string;
    try {
      hashedPassword = await bcrypt.hash(password, 10);
    } catch (err) {
      log.error('bcrypt hashing failed', err);
      throw new Error('AUTH_INTERNAL_ERROR');
    }

    let newUser: any;
    try {
      newUser = await this.Users.create({
        first_name,
        last_name,
        email,
        phone,
        password: hashedPassword,
        company_id: 1,
      });
    } catch (err) {
      log.error('DB error while creating user', err);
      throw new Error('DATABASE_ERROR');
    }

    log.enrich({ userId: newUser.id }).info('User registered successfully');

    return {
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        email: newUser.email,
        phone: newUser.phone,
        company_id: newUser.company_id,
      },
    };
  }

  async logout(userId?: number) {
    const log = this.appLogger.forContext('AuthService', 'logout', {
      userId,
    });

    log.info('Logout attempt started');

    try {
      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (err) {
      log.error('Logout failed', err);
      throw new Error('LOGOUT_ERROR');
    }
  }
}
