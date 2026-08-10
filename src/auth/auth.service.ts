import { Inject, Injectable } from '@nestjs/common';
import { users } from '../models/users';
import { user_roles } from '../models/user.roles';
import { role_permissions } from '../models/role.permissions';
import { permissions } from '../models/permissions';
import { roles } from '../models/roles';
import { refresh_tokens } from '../models/refresh_tokens';

import * as bcrypt from 'bcrypt';
import { AppLogger } from '../common/logger/logger.service';
import { companies } from '../models/companies';
import {
  TokenPayload,
  REFRESH_TOKEN_TTL_MS,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './jwt.util';

const COMPANY_ATTRIBUTES = [
  'id',
  'name',
  'primary_email',
  'primary_phone',
  'default_terms_conditions',
  'logo',
];

@Injectable()
export class AuthService {
  private readonly Users: typeof users;
  private readonly UserRole: typeof user_roles;
  private readonly RolePermissions: typeof role_permissions;
  private readonly Permissions: typeof permissions;
  private readonly Roles: typeof roles;
  private readonly Companies: typeof companies;
  private readonly RefreshTokens: typeof refresh_tokens;

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
    this.RefreshTokens = this.dbProvider.db.refresh_tokens;
  }

  private async loadRolesAndPermissions(userId: number) {
    const userRoleRows: any[] = await this.UserRole.findAll({
      where: { user_id: userId },
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

    const roleNames: string[] = userRoleRows
      .map((i: any) => i.role?.name)
      .filter(Boolean);

    const permissionNames: string[] = [
      ...new Set(
        userRoleRows.flatMap(
          (i: any) =>
            i.role?.role_permissions
              ?.map((rp: any) => rp.permission?.name)
              .filter(Boolean) ?? [],
        ),
      ),
    ];

    return { roleNames, permissionNames };
  }

  private async persistRefreshToken(userId: number, refreshToken: string) {
    await this.RefreshTokens.create({
      user_id: userId,
      token_hash: hashToken(refreshToken),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
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
          { model: this.Companies, as: 'company', attributes: COMPANY_ATTRIBUTES },
        ],
      });
    } catch (err) {
      log.error('DB error while fetching user', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!user) {
      log.warn('Login failed — user not found');
      return { success: false, message: 'User not registed with this Email address' };
    }

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

    if (!user.is_active) {
      logU.warn('Login failed — inactive user');
      return {
        success: false,
        message: 'Your account has been deactivated. Contact your administrator.',
      };
    }

    let roleNames: string[];
    let permissionNames: string[];
    try {
      ({ roleNames, permissionNames } = await this.loadRolesAndPermissions(user.id));
    } catch (err) {
      logU.error('DB error while fetching roles', err);
      throw new Error('DATABASE_ERROR');
    }

    logU.debug('Roles resolved', {
      roles: roleNames.join(','),
      permissionCount: permissionNames.length,
    });

    const payload: TokenPayload = {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      roles: roleNames,
      permissions: permissionNames,
    };
    let accessToken: string;
    let refreshToken: string;

    try {
      accessToken = signAccessToken(payload);
      refreshToken = signRefreshToken(payload);
    } catch (err) {
      logU.error('Token generation failed', err);
      throw new Error('TOKEN_GENERATION_ERROR');
    }

    try {
      await this.persistRefreshToken(user.id, refreshToken);
    } catch (err) {
      logU.error('Failed to persist refresh token', err);
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

  async refresh(refreshTokenCookie: string) {
    const log = this.appLogger.forContext('AuthService', 'refresh', {});

    let decoded: TokenPayload;
    try {
      decoded = verifyRefreshToken(refreshTokenCookie);
    } catch (err) {
      log.warn('Refresh rejected — invalid or expired JWT signature');
      return { success: false, message: 'Invalid or expired refresh token' };
    }

    const tokenHash = hashToken(refreshTokenCookie);
    const record: any = await this.RefreshTokens.findOne({ where: { token_hash: tokenHash } });

    if (!record) {
      log.warn('Refresh rejected — token not found in DB', { userId: decoded.userId });
      return { success: false, message: 'Refresh token not recognized' };
    }

    if (record.revoked_at) {
      // A revoked token being presented again is a reuse/theft signal — kill
      // every active session for this user defensively.
      await this.RefreshTokens.update(
        { revoked_at: new Date() },
        { where: { user_id: record.user_id, revoked_at: null } },
      );
      log.warn('Refresh token REUSE detected — all sessions revoked', {
        userId: record.user_id,
      });
      return { success: false, message: 'Session invalidated. Please log in again.' };
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      log.warn('Refresh rejected — DB record expired', { userId: record.user_id });
      return { success: false, message: 'Refresh token expired' };
    }

    const user: any = await this.Users.findOne({
      where: { id: record.user_id },
      include: [
        { model: this.Companies, as: 'company', attributes: COMPANY_ATTRIBUTES },
      ],
    });
    if (!user || !user.is_active) {
      log.warn('Refresh rejected — user missing/inactive', { userId: record.user_id });
      return { success: false, message: 'Account is inactive' };
    }

    const { roleNames, permissionNames } = await this.loadRolesAndPermissions(user.id);
    const payload: TokenPayload = {
      userId: user.id,
      companyId: user.company_id,
      email: user.email,
      roles: roleNames,
      permissions: permissionNames,
    };

    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);
    const newHash = hashToken(newRefreshToken);

    await this.dbProvider.sequelize.transaction(async (t: any) => {
      await record.update(
        { revoked_at: new Date(), replaced_by_token_hash: newHash },
        { transaction: t },
      );
      await this.RefreshTokens.create(
        {
          user_id: user.id,
          token_hash: newHash,
          expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
        { transaction: t },
      );
    });

    log.info('Refresh successful', { userId: user.id });
    return {
      success: true,
      message: 'Token refreshed',
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    };
  }

  async logout(refreshTokenCookie?: string) {
    const log = this.appLogger.forContext('AuthService', 'logout', {});
    log.info('Logout attempt started');

    try {
      if (refreshTokenCookie) {
        const tokenHash = hashToken(refreshTokenCookie);
        await this.RefreshTokens.update(
          { revoked_at: new Date() },
          { where: { token_hash: tokenHash, revoked_at: null } },
        );
      }
      return { success: true, message: 'Logout successful' };
    } catch (err) {
      log.error('Logout failed', err);
      throw new Error('LOGOUT_ERROR');
    }
  }
}
