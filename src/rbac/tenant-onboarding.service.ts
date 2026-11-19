import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../common/logger/logger.service';
import { CompanyRolesService } from './company-roles.service';
import { adminProblem, cleanPrefix, companyNameProblem, prefixCandidates } from './tenant.rules';

export interface NewAdmin {
  first_name: string;
  last_name?: string;
  email: string;
  phone?: string;
  password: string;
}

export type OnboardResult =
  | { success: true; company: { id: number; name: string; company_prefix: string }; user: { id: number; first_name: string; last_name: string | null; email: string; phone: string | null; company_id: number } }
  | { success: false; message: string; status?: number };

/**
 * Adds a company (tenant) with its default roles and its first Admin — used by
 * sign-up and by Super Admins on the platform console.
 */
@Injectable()
export class TenantOnboardingService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    private readonly companyRoles: CompanyRolesService,
    private readonly appLogger: AppLogger,
  ) {}

  /** A free prefix for this name ("Ek Plate Parcels" → EPP, EPP2 …). */
  async freePrefix(name: string, transaction?: any): Promise<string> {
    for (const p of prefixCandidates(name)) {
      const taken = await this.db.db.companies.findOne({ where: { company_prefix: p }, attributes: ['id'], transaction });
      if (!taken) return p;
    }
    return `C${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
  }

  async createCompanyWithAdmin(input: { companyName: string; prefix?: string; admin: NewAdmin }): Promise<OnboardResult> {
    const log = this.appLogger.forContext('TenantOnboardingService', 'createCompanyWithAdmin', { email: input.admin?.email });
    const nameProblem = companyNameProblem(input.companyName);
    if (nameProblem) return { success: false, message: nameProblem, status: 400 };
    const problem = adminProblem(input.admin || ({} as NewAdmin));
    if (problem) return { success: false, message: problem, status: 400 };

    const email = String(input.admin.email).trim().toLowerCase();
    const taken = await this.db.db.users.findOne({ where: { email }, attributes: ['id'] });
    if (taken) return { success: false, message: 'An account with this email already exists', status: 409 };

    let prefix = cleanPrefix(input.prefix);
    if (prefix) {
      const used = await this.db.db.companies.findOne({ where: { company_prefix: prefix }, attributes: ['id'] });
      if (used) return { success: false, message: `The prefix ${prefix} is already used by another company`, status: 409 };
    }

    const hash = await bcrypt.hash(String(input.admin.password), 10);
    const t = await this.db.sequelize.transaction();
    try {
      if (!prefix) prefix = await this.freePrefix(input.companyName, t);
      const company = await this.db.db.companies.create(
        { name: String(input.companyName).trim(), company_prefix: prefix, status: 'active', is_active: 1 },
        { transaction: t },
      );
      const adminRoleId = await this.companyRoles.ensureDefaults(Number(company.id), t);
      const user = await this.db.db.users.create(
        {
          company_id: company.id,
          first_name: String(input.admin.first_name).trim(),
          last_name: String(input.admin.last_name || '').trim() || null,
          email,
          phone: String(input.admin.phone || '').trim() || null,
          password: hash,
          is_active: 1,
        },
        { transaction: t },
      );
      await this.db.db.user_roles.create({ user_id: user.id, role_id: adminRoleId }, { transaction: t });
      await t.commit();
      log.info('Company created', { companyId: company.id, userId: user.id });
      return {
        success: true,
        company: { id: Number(company.id), name: company.name, company_prefix: company.company_prefix },
        user: {
          id: Number(user.id),
          first_name: user.first_name,
          last_name: user.last_name ?? null,
          email: user.email,
          phone: user.phone ?? null,
          company_id: Number(company.id),
        },
      };
    } catch (err) {
      await t.rollback();
      log.error('Could not create the company', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
