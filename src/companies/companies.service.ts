import { AppLogger } from 'src/common/logger/logger.service';
import { Inject } from '@nestjs/common';
import { companies } from '../models/companies';
import { company_addresses } from '../models/company_addresses';
import { company_locations } from '../models/company_locations';
import { company_metadata } from '../models/company_metadata';
import { company_bank_accounts } from '../models/company_bank_accounts';
import { Model, ModelStatic, Op } from 'sequelize';
import { CreateCompanyDto } from './dto/createCompany.dto';
import { CompaniesListDto } from './companies-list.dto';
import { UpdateCompanyDto } from './dto/updateCompany.dto';
import { CompanyMapper } from './mappers/company.mapper';

export class CompanyService {
  private readonly Companies: typeof companies;
  private readonly CompanyAddresses: typeof company_addresses;
  private readonly CompanyLocations: typeof company_locations;
  private readonly CompanyMetadata: typeof company_metadata;
  private readonly CompanyBankAccounts: typeof company_bank_accounts;

  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {
    this.Companies = this.dbProvider.db.companies;
    this.CompanyAddresses = this.dbProvider.db.company_addresses;
    this.CompanyLocations = this.dbProvider.db.company_locations;
    this.CompanyMetadata = this.dbProvider.db.company_metadata;
    this.CompanyBankAccounts = this.dbProvider.db.company_bank_accounts;
  }

  // Normalize the prefix to uppercase alphanumeric characters and enforce a 10-character maximum.
  private normalizeCompanyPrefix(prefix: string): string {
    return prefix?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }

  // Ensure the prefix is unique across companies, excluding the current company when updating.
  private async ensureUniqueCompanyPrefix(
    companyPrefix: string,
    currentCompanyId?: number,
  ) {
    const existingCompany = await this.Companies.findOne({
      where: {
        company_prefix: companyPrefix,
      },
    });

    if (existingCompany && existingCompany.id !== currentCompanyId) {
      return false;
    }

    return true;
  }

  private parseBase64Logo(logo?: string): Buffer | undefined {
    if (!logo) {
      return undefined;
    }

    const trimmed = logo.trim();
    const matches = trimmed.match(/^data:image\/png;base64,(.+)$/);
    const base64Data = matches ? matches[1] : trimmed;

    if (!base64Data || !/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      return undefined;
    }

    try {
      return Buffer.from(base64Data, 'base64');
    } catch {
      return undefined;
    }
  }

  async createCompany(data: CreateCompanyDto) {
    const log = this.appLogger.forContext('CompanyService', 'createCompany', {
      companyName: data.name,
    });

    log.info('Create company attempt started');

    const normalizedPrefix = this.normalizeCompanyPrefix(data.company_prefix);
    if (!normalizedPrefix) {
      return { success: false, message: 'Company prefix is required' };
    }

    const isUnique = await this.ensureUniqueCompanyPrefix(normalizedPrefix);
    if (!isUnique) {
      return { success: false, message: 'Company prefix already exists' };
    }

    const logoBuffer = this.parseBase64Logo(data.logo);
    if (data.logo !== undefined && data.logo !== null && !logoBuffer) {
      return { success: false, message: 'Invalid PNG logo data' };
    }

    let company: companies;
    try {
      company = await this.Companies.create({
        name: data.name,
        company_prefix: normalizedPrefix,
        legal_name: data.legal_name,
        registration_number: data.registration_number,
        gst_no: data.gst_no,
        website: data.website,
        industry: data.industry,
        primary_email: data.primary_email,
        primary_phone: data.primary_phone,
        default_terms_conditions: data.default_terms_conditions,
        status: data.status ?? 'active',
        logo: this.parseBase64Logo(data.logo),
      });
    } catch (err) {
      const error = err as any;
      log.error('DB error while creating company', err, {
        mysqlError: error?.original?.message ?? error?.message,
        sql: error?.sql,
      });
      throw new Error('DATABASE_ERROR');
    }

    if (data.addresses?.length) {
      try {
        await this.CompanyAddresses.bulkCreate(
          data.addresses.map((address) => ({
            company_id: company.id,
            type: address.type,
            label: address.label,
            line_1: address.line_1,
            line_2: address.line_2,
            city: address.city,
            state: address.state,
            country: address.country,
            postal_code: address.postal_code,
            phone: address.phone,
            fax: address.fax,
            notes: address.notes,
            is_default: address.is_default ? 1 : 0,
          })),
        );
      } catch (err) {
        log.error('DB error while creating company addresses', err);
        throw new Error('DATABASE_ERROR');
      }
    }

    if (data.locations?.length) {
      try {
        await this.CompanyLocations.bulkCreate(
          data.locations.map((location) => ({
            company_id: company.id,
            name: location.name,
            location_type: location.location_type,
            address_id: location.address_id,
            manager_name: location.manager_name,
            manager_phone: location.manager_phone,
            capacity: location.capacity,
            operational_hours: location.operational_hours,
            address_line_1: location.address_line_1,
            address_line_2: location.address_line_2,
            address_city: location.address_city,
            address_state: location.address_state,
            address_country: location.address_country,
            address_postal_code: location.address_postal_code,
            notes: location.notes,
          })),
        );
      } catch (err) {
        log.error('DB error while creating company locations', err);
        throw new Error('DATABASE_ERROR');
      }
    }

    if (data.metadata?.length) {
      try {
        await this.CompanyMetadata.bulkCreate(
          data.metadata.map((meta) => ({
            company_id: company.id,
            key: meta.key,
            value: meta.value,
            data_type: meta.data_type,
            is_sensitive: meta.is_sensitive ? 1 : 0,
          })),
        );
      } catch (err) {
        log.error('DB error while creating company metadata', err);
        throw new Error('DATABASE_ERROR');
      }
    }

    if (data.bank_accounts?.length) {
      try {
        await this.CompanyBankAccounts.bulkCreate(
          data.bank_accounts.map((account) => ({
            company_id: company.id,
            bank_name: account.bank_name,
            account_holder_name: account.account_holder_name,
            account_number: account.account_number,
            ifsc_code: account.ifsc_code,
            branch_name: account.branch_name,
            branch_address: account.branch_address,
            account_type: account.account_type,
            notes: account.notes,
            is_default: account.is_default ? 1 : 0,
          })),
        );
      } catch (err) {
        log.error('DB error while creating company bank accounts', err);
        throw new Error('DATABASE_ERROR');
      }
    }

    log.enrich({ companyId: company.id }).info('Company created successfully');

    return {
      success: true,
      message: 'Company created successfully',
      data: { id: company.id },
    };
  }

  async getCompaniesList(data: CompaniesListDto) {
    const log = this.appLogger.forContext('CompanyService', 'getCompaniesList');

    log.info('Fetching companies list');

    const page = Number(data.page) || 1;
    const limit = Number(data.limit) || 10;
    const offset = (page - 1) * limit;

    const andConditions: any[] = [];
    if (data.search) {
      andConditions.push({
        name: { [Op.like]: `%${data.search}%` },
      });
    }

    const whereClause = andConditions.length ? { [Op.and]: [...andConditions, { is_active: 1 }] } : { is_active: 1 };

    let result: { rows: companies[]; count: number };
    try {
      result = await this.Companies.findAndCountAll({
        attributes: { exclude: ['logo'] },
        where: whereClause,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        include: [
          { model: this.CompanyAddresses, as: 'addresses', where: { is_active: 1 }, required: false },
          { model: this.CompanyLocations, as: 'locations', where: { is_active: 1 }, required: false },
          { model: this.CompanyMetadata, as: 'metadata', where: { is_active: 1 }, required: false },
          { model: this.CompanyBankAccounts, as: 'bank_accounts', where: { is_active: 1 }, required: false },
        ],
        distinct: true,
      });
    } catch (err) {
      log.error('DB error while listing companies', err);
      throw new Error('DATABASE_ERROR');
    }

    const totalPages = Math.ceil(result.count / limit);

    log.info('Companies list fetched successfully');

    return {
      success: true,
      message: 'Companies list fetched successfully',
      data: {
        companies: result.rows,
        pagination: {
          total: result.count,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    };
  }

  async getCompanyById(id: number) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyById', {
      companyId: id,
    });

    log.info('Fetching company details');

    let company: companies | null;
    try {
      company = await this.Companies.findOne({
        where: { id, is_active: 1 },
        attributes: { exclude: ['logo'] },
        include: [
          { model: this.CompanyAddresses, as: 'addresses', where: { is_active: 1 }, required: false },
          { model: this.CompanyLocations, as: 'locations', where: { is_active: 1 }, required: false },
          { model: this.CompanyMetadata, as: 'metadata', where: { is_active: 1 }, required: false },
          { model: this.CompanyBankAccounts, as: 'bank_accounts', where: { is_active: 1 }, required: false },
        ],
      });
    } catch (err) {
      log.error('DB error while fetching company details', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!company) {
      log.warn('Company not found');
      return { success: false, message: `Company with id ${id} not found` };
    }

    log.info('Company details fetched successfully');

    const jsonCompany = company.toJSON() as any;
    if (jsonCompany.logo && Buffer.isBuffer(jsonCompany.logo)) {
      jsonCompany.logo = `data:image/png;base64,${jsonCompany.logo.toString('base64')}`;
    }

    console.log('Fetched company details:', jsonCompany)

    return {
      success: true,
      message: 'Company details fetched successfully',
      data: jsonCompany,
    };
  }

  private cleanPayload(payload: Record<string, any>) {
    return Object.entries(payload).reduce((result, [key, value]) => {
      if (value !== undefined) {
        result[key] = value;
      }
      return result;
    }, {} as Record<string, any>);
  }

  async updateCompany(id: number, data: UpdateCompanyDto) {
    const log = this.appLogger.forContext('CompanyService', 'updateCompany', {
      companyId: id,
    });

    log.info('Update company attempt started');

    let company: companies | null;
    try {
      company = await this.Companies.findByPk(id);
    } catch (err) {
      log.error('DB error while fetching company', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!company) {
      log.warn('Company not found');
      return { success: false, message: `Company with id ${id} not found` };
    }

     // ── Validate company prefix ───────────────────────────────────────────────
    if (data.company_prefix !== undefined) {
      const normalizedPrefix = this.normalizeCompanyPrefix(data.company_prefix);
      if (!normalizedPrefix) {
        return { success: false, message: 'Company prefix is required' };
      }

      const isUnique = await this.ensureUniqueCompanyPrefix(normalizedPrefix, id);
      if (!isUnique) {
        return { success: false, message: 'Company prefix already exists' };
      }

      data.company_prefix = normalizedPrefix;
    }

    // ── Resolve logo ──────────────────────────────────────────────────────────
    let logoUpdateValue: Buffer | null | undefined = undefined;
    if (data.logo !== undefined) {
      if (data.logo === null || data.logo === '') {
        logoUpdateValue = null; // explicit clear
      } else {
        const parsed = this.parseBase64Logo(data.logo as any);
        if (!parsed) {
          return { success: false, message: 'Invalid PNG logo data' };
        }
        logoUpdateValue = parsed;
      }
    }
// ── Update core company fields ────────────────────────────────────────────
    try {
      await company.update(this.cleanPayload({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.company_prefix !== undefined && { company_prefix: data.company_prefix }),
        ...(data.legal_name !== undefined && { legal_name: data.legal_name }),
        ...(data.registration_number !== undefined && {
          registration_number: data.registration_number,
        }),
        ...(data.gst_no !== undefined && { gst_no: data.gst_no }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.industry !== undefined && { industry: data.industry }),
        ...(data.primary_email !== undefined && { primary_email: data.primary_email }),
        ...(data.primary_phone !== undefined && { primary_phone: data.primary_phone }),
        ...(data.default_terms_conditions !== undefined && {
          default_terms_conditions: data.default_terms_conditions,
        }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.logo !== null && { logo: logoUpdateValue }),
      }));
    } catch (err) {
      log.error('DB error while updating company', err);
      throw new Error('DATABASE_ERROR');
    }

    // ── Soft-delete removed nested records ───────────────────────────────────
     try {
    await Promise.all([
      this.softDeleteRemoved(
        this.CompanyAddresses,
        id,
        (data.addresses ?? []).map((a) => a.id),
        // also null out the FK on locations referencing deleted addresses
      ).then(async () => {
        const deletedAddressIds = await this.CompanyAddresses.findAll({
          where: { company_id: id, is_active: 0 },
          attributes: ['id'],
        });
        if (deletedAddressIds.length) {
          await this.CompanyLocations.update(
            { address_id: null },
            { where: { address_id: deletedAddressIds.map((a: any) => a.id) } },
          );
        }
      }),
      this.softDeleteRemoved(
        this.CompanyLocations,
        id,
        (data.locations ?? []).map((l) => l.id),
      ),
      this.softDeleteRemoved(
        this.CompanyMetadata,
        id,
        (data.metadata ?? []).map((m) => m.id),
      ),
      this.softDeleteRemoved(
        this.CompanyBankAccounts,
        id,
        (data.bank_accounts ?? []).map((b) => b.id),
      ),
    ]);
  } catch (err) {
    log.error('DB error while cleaning up nested records', err);
    throw new Error('DATABASE_ERROR');
  }

   // ── Upsert nested records ─────────────────────────────────────────────────
  try {
    await Promise.all([
      ...(data.addresses ?? []).map((address) =>
        this.upsertRecord(
          this.CompanyAddresses,
          address.id,
          id,
          CompanyMapper.toAddressPayload(id, address),
        ),
      ),
      ...(data.locations ?? []).map((location) =>
        this.upsertRecord(
          this.CompanyLocations,
          location.id,
          id,
          CompanyMapper.toLocationPayload(id, location),
        ),
      ),
      ...(data.metadata ?? []).map((meta) =>
        this.upsertRecord(
          this.CompanyMetadata,
          meta.id,
          id,
          CompanyMapper.toMetadataPayload(id, meta),
        ),
      ),
      ...(data.bank_accounts ?? []).map((account) =>
        this.upsertRecord(
          this.CompanyBankAccounts,
          account.id,
          id,
          CompanyMapper.toBankAccountPayload(id, account),
        ),
      ),
    ]);
  } catch (err) {
    log.error('DB error while upserting nested records', err, {
      mysqlError: (err as any)?.original?.message ?? (err as any)?.message,
      sql: (err as any)?.sql,
    });
    throw new Error('DATABASE_ERROR');
  }


    log.info('Company updated successfully');
    return {
      success: true,
      message: 'Company updated successfully',
      data: { id },
    };
  }

  async deleteCompany(id: number) {
    const log = this.appLogger.forContext('CompanyService', 'deleteCompany', {
      companyId: id,
    });

    log.info('Delete company attempt started');

    let company: companies | null;
    try {
      company = await this.Companies.findByPk(id);
    } catch (err) {
      log.error('DB error while fetching company', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!company) {
      log.warn('Company not found');
      return { success: false, message: `Company with id ${id} not found` };
    }

    try {
      await this.Companies.update({ is_active: 0 }, { where: { id } });
      await this.CompanyAddresses.update({ is_active: 0 }, { where: { company_id: id } });
      await this.CompanyLocations.update({ is_active: 0 }, { where: { company_id: id } });
      await this.CompanyMetadata.update({ is_active: 0 }, { where: { company_id: id } });
      await this.CompanyBankAccounts.update({ is_active: 0 }, { where: { company_id: id } });
    } catch (err) {
      log.error('DB error while deleting company', err);
      throw new Error('DATABASE_ERROR');
    }

    log.info('Company deleted successfully');
    return {
      success: true,
      message: 'Company deleted successfully',
      data: { id },
    };
  }

  async getCompanyAddresses(companyId: number) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyAddresses', {
      companyId,
    });

    log.info('Fetching company addresses');

    let addresses: company_addresses[];
    try {
      addresses = await this.CompanyAddresses.findAll({
        where: { company_id: companyId, is_active: 1 },
      });
    } catch (err) {
      log.error('DB error while fetching company addresses', err);
      throw new Error('DATABASE_ERROR');
    }

    return {
      success: true,
      message: 'Company addresses fetched successfully',
      data: addresses,
    };
  }

  async getCompanyLocations(companyId: number) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyLocations', {
      companyId,
    });

    log.info('Fetching company locations');

    let locations: company_locations[];
    try {
      locations = await this.CompanyLocations.findAll({
        where: { company_id: companyId, is_active: 1 },
        include: [{ model: this.CompanyAddresses, as: 'address', where: { is_active: 1 }, required: false }],
      });
    } catch (err) {
      log.error('DB error while fetching company locations', err);
      throw new Error('DATABASE_ERROR');
    }

    return {
      success: true,
      message: 'Company locations fetched successfully',
      data: locations,
    };
  }

  // Generic upsert helper — eliminates the repetitive findOne + update/create pattern
private async upsertRecord<T extends Model>(
  model: ModelStatic<T>,
  recordId: number | undefined,
  companyId: number,
  payload: object,
): Promise<void> {
  if (recordId) {
    const existing = await (model as any).findOne({
      where: { id: recordId, company_id: companyId },
    });
    if (existing) {
      await existing.update(payload);
      return;
    }
  }
  await (model as any).create(payload);
}

// Generic soft-delete helper — eliminates the repetitive delete diffing pattern
private async softDeleteRemoved(
  model: any,
  companyId: number,
  incomingIds: (number | undefined)[],
  extraUpdate?: Record<string, any>,
): Promise<void> {
  const existing = await model.findAll({
    where: { company_id: companyId, is_active: 1 },
    attributes: ['id'],
  });

  const existingIds: number[] = existing.map((r: any) => r.id);
  const validIncoming = incomingIds.filter(Boolean) as number[];
  const toDelete = existingIds.filter((eid) => !validIncoming.includes(eid));

  if (toDelete.length) {
    await model.update(
      { is_active: 0, ...extraUpdate },
      { where: { id: toDelete } },
    );
  }
}

}
