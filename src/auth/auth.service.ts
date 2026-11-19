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
import { CompanyModulesService } from '../company-modules/company-modules.service';
import { CacheService, companyScope } from '../common/cache/cache.service';
import {
  filterPermissionsByModules,
  withCoreModules,
} from '../company-modules/module-catalog';
import { AccessService } from '../rbac/access.service';
import { TenantOnboardingService } from '../rbac/tenant-onboarding.service';

const COMPANY_ATTRIBUTES = [
  'id',
  'name',
  'primary_email',
  'primary_phone',
  'default_terms_conditions',
  'logo',
  'status',
  'is_active',
];

const SUSPENDED_MESSAGE =
  "Your company's SameBook account is suspended. Please contact SameBook support.";

/** A suspended company can't sign in — except Super Admins, who must be able to fix things. */
export const companyBlocked = (company: any, platform: boolean): string | null => {
  if (platform || !company) return null;
  const suspended =
    String(company.status || '').toLowerCase() === 'suspended' || Number(company.is_active) === 0;
  return suspended ? SUSPENDED_MESSAGE : null;
};

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
    private readonly companyModules: CompanyModulesService,
    private readonly cache: CacheService,
    private readonly access: AccessService,
    private readonly onboarding: TenantOnboardingService,
  ) {
    this.Users = this.dbProvider.db.users;
    this.UserRole = this.dbProvider.db.user_roles;
    this.RolePermissions = this.dbProvider.db.role_permissions;
    this.Permissions = this.dbProvider.db.permission;
    this.Roles = this.dbProvider.db.roles;
    this.Companies = this.dbProvider.db.companies;
    this.RefreshTokens = this.dbProvider.db.refresh_tokens;
  }

  /**
   * Roles + EFFECTIVE permissions: permissions of add-on modules the company
   * has not connected are dropped, so login, refresh and /auth/session all
   * agree. Module lookup never throws (fails closed for add-ons only).
   */
  private async loadRolesAndPermissions(userId: number, companyId: number) {
    const access = await this.access.accessOf(userId, companyId);
    const enabledAddOns = await this.companyModules.getEnabledModuleKeys(companyId);
    return {
      roleNames: access.roleNames,
      permissionNames: filterPermissionsByModules(access.permissions, enabledAddOns),
      modules: withCoreModules(enabledAddOns),
      platform: access.platform,
      admin: access.admin,
      rank: access.rank,
    };
  }

  /** Fresh roles, effective permissions and enabled modules for the UI. */
  async getSession(userId: number, companyId: number) {
    const user: any = await this.Users.findOne({
      where: { id: userId, company_id: companyId },
      attributes: ['id', 'company_id', 'is_active'],
    });
    if (!user || !user.is_active) {
      return { success: false as const, message: 'Account is inactive' };
    }
    // Cached (polled by every open tab). Login and token refresh always read
    // fresh, so what a token actually grants never comes from this cache;
    // role / permission / user changes, add-on connects and a company being
    // suspended bump 'access'.
    const raw = await this.cache.wrap(
      {
        scopes: [companyScope(user.company_id, 'access'), 'g:access'],
        key: `u${Number(user.id)}:access:v2`,
        ttl: 300,
      },
      async () => {
        const [access, company] = await Promise.all([
          this.access.accessOf(user.id, user.company_id),
          this.Companies.findOne({ where: { id: user.company_id }, attributes: ['id', 'status', 'is_active'] }),
        ]);
        return {
          roleNames: access.roleNames,
          permissionNames: access.permissions,
          platform: access.platform,
          admin: access.admin,
          rank: access.rank,
          blocked: companyBlocked(company, access.platform),
        };
      },
    );
    if (raw.blocked) return { success: false as const, message: raw.blocked };
    const enabledAddOns = await this.companyModules.getEnabledModuleKeys(user.company_id);
    const roleNames = raw.roleNames;
    const permissionNames = filterPermissionsByModules(raw.permissionNames, enabledAddOns);
    const modules = withCoreModules(enabledAddOns);
    return {
      success: true as const,
      message: 'Session fetched',
      data: {
        user_id: user.id,
        company_id: user.company_id,
        roles: roleNames,
        permissions: permissionNames,
        modules,
        /** SameBook Super Admin (sees the platform console). */
        platform: raw.platform,
        /** The company's Admin (top role). */
        admin: raw.admin,
        /** Highest company role level (1 = Admin … 5; 99 = none). */
        rank: raw.rank,
      },
    };
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
      // Same message as a wrong password, so the login form can't be used to
      // find out which email addresses have accounts.
      return { success: false, message: 'Invalid email or password' };
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
    let modules: string[];
    let platform = false;
    try {
      ({ roleNames, permissionNames, modules, platform } = await this.loadRolesAndPermissions(
        user.id,
        user.company_id,
      ));
    } catch (err) {
      logU.error('DB error while fetching roles', err);
      throw new Error('DATABASE_ERROR');
    }

    const blocked = companyBlocked(user.company, platform);
    if (blocked) {
      logU.warn('Login failed — company suspended');
      return { success: false, message: blocked };
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
      platform,
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
          modules,
        },
      },
    };
  }

  /**
   * Sign-up: every new account gets its own company (with the default roles)
   * and is that company's Admin. Nobody joins an existing company by signing
   * up — people are added to a company by its Admin (or a manager) instead.
   */
  async register(
    first_name: string,
    last_name: string,
    email: string,
    phone: string,
    password: string,
    company_name?: string,
  ) {
    const log = this.appLogger.forContext('AuthService', 'register', {
      email,
    });

    log.info('Registration attempt started');

    const companyName =
      String(company_name || '').trim() || `${String(first_name || '').trim() || 'My'}'s Business`;
    const result = await this.onboarding.createCompanyWithAdmin({
      companyName,
      admin: { first_name, last_name, email, phone, password },
    });

    if (result.success === false) {
      log.warn(`Registration failed — ${result.message}`);
      return {
        success: false,
        message: result.status === 409 ? 'Email already exists' : result.message,
      };
    }

    log.enrich({ userId: result.user.id }).info('User registered with a new company', {
      companyId: result.company.id,
    });

    return {
      success: true,
      message: 'Account created — you are the Admin of your new company',
      data: {
        ...result.user,
        company: result.company,
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

    try {
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

      const { roleNames, permissionNames, platform } = await this.loadRolesAndPermissions(
        user.id,
        user.company_id,
      );
      const blocked = companyBlocked(user.company, platform);
      if (blocked) {
        log.warn('Refresh rejected — company suspended', { userId: user.id });
        return { success: false, message: blocked };
      }
      const payload: TokenPayload = {
        userId: user.id,
        companyId: user.company_id,
        email: user.email,
        roles: roleNames,
        permissions: permissionNames,
        platform,
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
    } catch (err) {
      // Transient DB/connection errors land here (see database.provider.ts
      // for the connection-pool hardening + auto-retry that should keep most
      // of these from ever reaching this point). Fail as a clean, expected
      // 401 rather than an opaque 500 — the frontend already treats a failed
      // refresh as "session ended, go to login" either way, but this keeps
      // the response consistent with every other auth failure path.
      log.error('DB error during refresh', err);
      return {
        success: false,
        transient: true,
        message: 'Service temporarily unavailable. Please try again.',
      };
    }
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
