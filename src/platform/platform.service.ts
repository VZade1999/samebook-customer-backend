import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../common/logger/logger.service';
import { CacheService, companyScope } from '../common/cache/cache.service';
import { CompanyModulesService } from '../company-modules/company-modules.service';
import { MODULE_CATALOG } from '../company-modules/module-catalog';
import { AccessService } from '../rbac/access.service';
import { CompanyRolesService } from '../rbac/company-roles.service';
import { TenantOnboardingService, type NewAdmin } from '../rbac/tenant-onboarding.service';
import { adminProblem } from '../rbac/tenant.rules';

const n = (v: unknown) => Number(v) || 0;
const status = (c: any) => (String(c.status || '').toLowerCase() === 'suspended' || Number(c.is_active) === 0 ? 'suspended' : 'active');

/**
 * The SameBook platform console (Super Admins only — PlatformGuard): every
 * company with its people, admins, add-ons and activity; add a company;
 * suspend / reactivate; switch add-ons; give a company an Admin. It counts
 * documents but never reads their contents.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly db: any,
    private readonly appLogger: AppLogger,
    private readonly cache: CacheService,
    private readonly access: AccessService,
    private readonly companyRoles: CompanyRolesService,
    private readonly onboarding: TenantOnboardingService,
    private readonly modules: CompanyModulesService,
  ) {}

  private q(sql: string, replacements: Record<string, unknown> = {}) {
    return this.db.sequelize.query(sql, { type: QueryTypes.SELECT, replacements }) as Promise<any[]>;
  }

  /** Every company with counts, admins and add-ons. */
  async companies(viewerCompanyId: number) {
    const [rows, admins, mods] = await Promise.all([
      this.q(`
        SELECT c.id, c.name, c.company_prefix, c.status, c.is_active, c.gst_no, c.primary_email, c.primary_phone, c.created_at,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active = 1) AS people_active,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS people_total,
          (SELECT MAX(u.last_login) FROM users u WHERE u.company_id = c.id) AS last_active,
          (SELECT COUNT(*) FROM quotations q WHERE q.company_id = c.id) AS quotations,
          (SELECT COUNT(*) FROM invoices i WHERE i.company_id = c.id) AS invoices,
          (SELECT COUNT(*) FROM delivery_challans d WHERE d.company_id = c.id) AS challans,
          (SELECT COUNT(*) FROM invoices i WHERE i.company_id = c.id AND i.created_at >= NOW() - INTERVAL 30 DAY) AS invoices_30d
        FROM companies c ORDER BY c.id`),
      this.q(`
        SELECT u.company_id, u.id, u.first_name, u.last_name, u.email, u.last_login
        FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.scope = 'COMPANY' AND r.level = 1 AND r.company_id = u.company_id
        WHERE u.is_active = 1 ORDER BY u.id`),
      this.q(`SELECT company_id, module_key FROM company_modules WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > NOW())`),
    ]);
    const addOns = new Set(MODULE_CATALOG.filter((m) => !m.core).map((m) => m.key));
    return rows.map((c) => ({
      id: n(c.id),
      name: c.name,
      prefix: c.company_prefix,
      status: status(c),
      gst_no: c.gst_no ?? null,
      email: c.primary_email ?? null,
      phone: c.primary_phone ?? null,
      created_at: c.created_at,
      last_active: c.last_active ?? null,
      people: { active: n(c.people_active), total: n(c.people_total) },
      documents: { quotations: n(c.quotations), invoices: n(c.invoices), challans: n(c.challans), invoices_30d: n(c.invoices_30d) },
      admins: admins
        .filter((a) => n(a.company_id) === n(c.id))
        .map((a) => ({ id: n(a.id), name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email, email: a.email, last_login: a.last_login ?? null })),
      add_ons: mods.filter((m) => n(m.company_id) === n(c.id) && addOns.has(m.module_key)).map((m) => m.module_key),
      yours: n(c.id) === n(viewerCompanyId),
    }));
  }

  async overview(viewerCompanyId: number) {
    const companies = await this.companies(viewerCompanyId);
    const [docs] = await this.q(`
      SELECT
        (SELECT COUNT(*) FROM quotations WHERE created_at >= NOW() - INTERVAL 30 DAY) AS quotations_30d,
        (SELECT COUNT(*) FROM invoices WHERE created_at >= NOW() - INTERVAL 30 DAY) AS invoices_30d,
        (SELECT COUNT(*) FROM delivery_challans WHERE created_at >= NOW() - INTERVAL 30 DAY) AS challans_30d,
        (SELECT COUNT(*) FROM companies WHERE created_at >= NOW() - INTERVAL 30 DAY) AS companies_30d`);
    const platformAdmins = await this.q(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.company_id, c.name AS company
      FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.scope = 'PLATFORM'
      LEFT JOIN companies c ON c.id = u.company_id WHERE u.is_active = 1 ORDER BY u.id`);
    return {
      companies: {
        total: companies.length,
        active: companies.filter((c) => c.status === 'active').length,
        suspended: companies.filter((c) => c.status === 'suspended').length,
        without_admin: companies.filter((c) => !c.admins.length).length,
        new_30d: n(docs?.companies_30d),
      },
      people: {
        active: companies.reduce((s, c) => s + c.people.active, 0),
        total: companies.reduce((s, c) => s + c.people.total, 0),
      },
      documents_30d: { quotations: n(docs?.quotations_30d), invoices: n(docs?.invoices_30d), challans: n(docs?.challans_30d) },
      add_ons: MODULE_CATALOG.filter((m) => !m.core).map((m) => ({
        key: m.key,
        name: m.name,
        companies: companies.filter((c) => c.add_ons.includes(m.key)).length,
      })),
      super_admins: platformAdmins.map((a) => ({
        id: n(a.id),
        name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
        email: a.email,
        company: a.company ?? null,
      })),
    };
  }

  private async findCompany(companyId: number) {
    const c = await this.db.db.companies.findOne({ where: { id: companyId } });
    if (!c) throw new NotFoundException('Company not found');
    return c;
  }

  /** One company: its people with roles and job titles, and its add-ons. */
  async company(companyId: number, viewerCompanyId: number) {
    const list = await this.companies(viewerCompanyId);
    const summary = list.find((c) => c.id === Number(companyId));
    if (!summary) throw new NotFoundException('Company not found');
    const [people, modules] = await Promise.all([this.access.companyPeople(companyId), this.modules.list(companyId)]);
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      ...summary,
      people: people
        .map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          designation: p.designation,
          department: p.department,
          manager: p.reports_to ? byId.get(p.reports_to)?.name ?? null : null,
          roles: p.roles.map((r) => ({ name: r.name, level: r.level, scope: r.scope })),
          admin: p.admin,
          platform: p.platform,
          is_active: p.is_active,
          last_login: p.last_login,
        }))
        .sort((a, b) => Number(b.is_active) - Number(a.is_active) || Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name)),
      counts: summary.people,
      modules,
    };
  }

  async createCompany(body: any) {
    const result = await this.onboarding.createCompanyWithAdmin({
      companyName: body?.company_name,
      prefix: body?.prefix,
      admin: body?.admin || {},
    });
    if (result.success === false) {
      if (result.status === 409) throw new ConflictException(result.message);
      throw new BadRequestException(result.message);
    }
    return { company: result.company, admin: result.user, message: `${result.company.name} is ready — ${result.user.first_name} is its Admin` };
  }

  /** Suspend (nobody there can sign in; their sessions end) or reactivate. */
  async setStatus(companyId: number, value: unknown, viewer: { user_id: number; company_id: number }) {
    const next = String(value || '').toLowerCase();
    if (next !== 'active' && next !== 'suspended') throw new BadRequestException('Status must be active or suspended');
    const c = await this.findCompany(companyId);
    if (next === 'suspended' && Number(c.id) === Number(viewer.company_id)) {
      throw new ForbiddenException("You can't suspend your own company from here");
    }
    await c.update({ status: next, updated_at: new Date() });
    if (next === 'suspended') {
      // End their sessions: refresh tokens stop working at once; access tokens within 15 minutes.
      await this.db.sequelize.query(
        `UPDATE refresh_tokens rt JOIN users u ON u.id = rt.user_id SET rt.revoked_at = NOW()
         WHERE u.company_id = :id AND rt.revoked_at IS NULL`,
        { type: QueryTypes.UPDATE, replacements: { id: Number(c.id) } },
      );
    }
    await this.cache.bump(companyScope(c.id, 'access'), companyScope(c.id, 'company'));
    this.appLogger.forContext('PlatformService', 'setStatus', { companyId: c.id }).info(`Company ${next} by user ${viewer.user_id}`);
    return {
      id: Number(c.id),
      status: next,
      message: next === 'suspended' ? `${c.name} is suspended — its people are signed out` : `${c.name} is active again`,
    };
  }

  /** Switch an add-on on or off for a company. */
  async setAddOn(companyId: number, key: string, enabled: unknown, viewer: { user_id: number; roles?: string[] }) {
    await this.findCompany(companyId);
    const requester = { userId: Number(viewer.user_id), companyId: Number(companyId), roles: viewer.roles || [] };
    const r = enabled ? await this.modules.connect(key, requester, []) : await this.modules.disconnect(key, requester);
    if (!r.success) {
      if (r.status === 404) throw new NotFoundException(r.message);
      throw new BadRequestException(r.message);
    }
    return { message: r.message, data: r.data };
  }

  /**
   * Gives a company an Admin: an existing person (by id) is promoted, or a
   * new person is added with the Admin role.
   */
  async addAdmin(companyId: number, body: any) {
    const c = await this.findCompany(companyId);
    const adminRoleId = await this.companyRoles.ensureDefaults(Number(c.id));
    if (body?.user_id) {
      const user = await this.db.db.users.findOne({ where: { id: Number(body.user_id), company_id: c.id } });
      if (!user) throw new NotFoundException('That person is not in this company');
      const has = await this.db.db.user_roles.findOne({ where: { user_id: user.id, role_id: adminRoleId } });
      if (!has) await this.db.db.user_roles.create({ user_id: user.id, role_id: adminRoleId });
      if (!Number(user.is_active)) await user.update({ is_active: 1 });
      await this.cache.bump(companyScope(c.id, 'access'));
      return { message: `${user.first_name || user.email} is now an Admin of ${c.name}` };
    }
    const a: NewAdmin = body || {};
    const problem = adminProblem(a);
    if (problem) throw new BadRequestException(problem);
    const email = String(a.email).trim().toLowerCase();
    if (await this.db.db.users.findOne({ where: { email }, attributes: ['id'] })) {
      throw new ConflictException('An account with this email already exists');
    }
    const t = await this.db.sequelize.transaction();
    try {
      const user = await this.db.db.users.create(
        {
          company_id: c.id,
          first_name: String(a.first_name).trim(),
          last_name: String(a.last_name || '').trim() || null,
          email,
          phone: String(a.phone || '').trim() || null,
          password: await bcrypt.hash(String(a.password), 10),
          is_active: 1,
        },
        { transaction: t },
      );
      await this.db.db.user_roles.create({ user_id: user.id, role_id: adminRoleId }, { transaction: t });
      await t.commit();
      await this.cache.bump(companyScope(c.id, 'access'));
      return { id: Number(user.id), message: `${user.first_name} is now an Admin of ${c.name}` };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }
}
