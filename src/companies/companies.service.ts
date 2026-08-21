import { AppLogger } from 'src/common/logger/logger.service';
import { Inject } from '@nestjs/common';
import { companies } from '../models/companies';
import { company_addresses } from '../models/company_addresses';
import { company_locations } from '../models/company_locations';
import { company_metadata } from '../models/company_metadata';
import { company_bank_accounts } from '../models/company_bank_accounts';
import { Model, ModelStatic } from 'sequelize';
import { UpdateCompanyDto } from './dto/updateCompany.dto';
import { CompanyMapper } from './mappers/company.mapper';
import { getStateCodeFromGstin } from '../common/gst-state.util';

// Identity context passed down from the controller (and from the AI agent's
// tool-calling path, which invokes this service directly) for every call.
// There is no cross-tenant/admin access here — every request is always
// scoped to the single company the requester belongs to.
export interface CompanyRequester {
  companyId: number;
}

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
        is_active: 1,
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

  async getCompanyById(id: number, requester: CompanyRequester) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyById', {
      companyId: id,
    });

    log.info('Fetching company details');

    if (id !== requester.companyId) {
      log.warn('Rejected — requester does not belong to this company');
      return { success: false, message: `Company with id ${id} not found` };
    }

    let company: companies | null;
    try {
      company = await this.Companies.findOne({
        where: { id, is_active: 1 },
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

  async updateCompany(id: number, data: UpdateCompanyDto, requester: CompanyRequester) {
    const log = this.appLogger.forContext('CompanyService', 'updateCompany', {
      companyId: id,
    });

    log.info('Update company attempt started');

    if (id !== requester.companyId) {
      log.warn('Rejected — requester does not belong to this company');
      return { success: false, message: `Company with id ${id} not found` };
    }

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
    const sequelize = this.dbProvider.sequelize;
    const t = await sequelize.transaction();

    try {
      // ── Update core company fields ──────────────────────────────────────────
      // `data.logo !== undefined` — not `!== null` — so an explicit `logo: null`
      // (clear the logo) is actually included in the update instead of being
      // silently dropped; cleanPayload only strips `undefined`, so `null` still
      // reaches the DB and clears the column.
      await company.update(
        this.cleanPayload({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.company_prefix !== undefined && { company_prefix: data.company_prefix }),
          ...(data.legal_name !== undefined && { legal_name: data.legal_name }),
          ...(data.registration_number !== undefined && {
            registration_number: data.registration_number,
          }),
          ...(data.gst_no !== undefined && {
            gst_no: data.gst_no,
            gst_state_code: getStateCodeFromGstin(data.gst_no) ?? null,
          }),
          ...(data.website !== undefined && { website: data.website }),
          ...(data.industry !== undefined && { industry: data.industry }),
          ...(data.primary_email !== undefined && { primary_email: data.primary_email }),
          ...(data.primary_phone !== undefined && { primary_phone: data.primary_phone }),
          ...(data.default_terms_conditions !== undefined && {
            default_terms_conditions: data.default_terms_conditions,
          }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.logo !== undefined && { logo: logoUpdateValue }),
        }),
        { transaction: t },
      );

      // ── Soft-delete removed nested records ──────────────────────────────────
      // Only diff/delete a nested collection when the caller actually sent it —
      // an omitted field (per the DTO's @IsOptional()) must leave those existing
      // records untouched, not be treated the same as an explicit empty array.
      const softDeleteTasks: Promise<void>[] = [];

      if (data.addresses !== undefined) {
        softDeleteTasks.push(
          this.softDeleteRemoved(
            this.CompanyAddresses,
            id,
            data.addresses.map((a) => a.id),
            undefined,
            t,
            // also null out the FK on locations referencing deleted addresses
          ).then(async () => {
            const deletedAddressIds = await this.CompanyAddresses.findAll({
              where: { company_id: id, is_active: 0 },
              attributes: ['id'],
              transaction: t,
            });
            if (deletedAddressIds.length) {
              await this.CompanyLocations.update(
                { address_id: null },
                {
                  where: { address_id: deletedAddressIds.map((a: any) => a.id) },
                  transaction: t,
                },
              );
            }
          }),
        );
      }

      if (data.locations !== undefined) {
        softDeleteTasks.push(
          this.softDeleteRemoved(
            this.CompanyLocations,
            id,
            data.locations.map((l) => l.id),
            undefined,
            t,
          ),
        );
      }

      if (data.metadata !== undefined) {
        softDeleteTasks.push(
          this.softDeleteRemoved(
            this.CompanyMetadata,
            id,
            data.metadata.map((m) => m.id),
            undefined,
            t,
          ),
        );
      }

      if (data.bank_accounts !== undefined) {
        softDeleteTasks.push(
          this.softDeleteRemoved(
            this.CompanyBankAccounts,
            id,
            data.bank_accounts.map((b) => b.id),
            undefined,
            t,
          ),
        );
      }

      await Promise.all(softDeleteTasks);

      // ── Upsert nested records ───────────────────────────────────────────────
      await Promise.all([
        ...(data.addresses ?? []).map((address) =>
          this.upsertRecord(
            this.CompanyAddresses,
            address.id,
            id,
            CompanyMapper.toAddressPayload(id, address),
            t,
          ),
        ),
        ...(data.locations ?? []).map((location) =>
          this.upsertRecord(
            this.CompanyLocations,
            location.id,
            id,
            CompanyMapper.toLocationPayload(id, location),
            t,
          ),
        ),
        ...(data.metadata ?? []).map((meta) =>
          this.upsertRecord(
            this.CompanyMetadata,
            meta.id,
            id,
            CompanyMapper.toMetadataPayload(id, meta),
            t,
          ),
        ),
        ...(data.bank_accounts ?? []).map((account) =>
          this.upsertRecord(
            this.CompanyBankAccounts,
            account.id,
            id,
            CompanyMapper.toBankAccountPayload(id, account),
            t,
          ),
        ),
      ]);

      await t.commit();
    } catch (err) {
      await t.rollback();
      log.error('DB error while updating company', err, {
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

  async getCompanyAddresses(companyId: number, requester: CompanyRequester) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyAddresses', {
      companyId,
    });

    log.info('Fetching company addresses');

    if (companyId !== requester.companyId) {
      log.warn('Rejected — requester does not belong to this company');
      return { success: false, message: `Company with id ${companyId} not found` };
    }

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

  async getCompanyLocations(companyId: number, requester: CompanyRequester) {
    const log = this.appLogger.forContext('CompanyService', 'getCompanyLocations', {
      companyId,
    });

    log.info('Fetching company locations');

    if (companyId !== requester.companyId) {
      log.warn('Rejected — requester does not belong to this company');
      return { success: false, message: `Company with id ${companyId} not found` };
    }

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
  transaction?: any,
): Promise<void> {
  if (recordId) {
    const existing = await (model as any).findOne({
      where: { id: recordId, company_id: companyId },
      transaction,
    });
    if (existing) {
      await existing.update(payload, { transaction });
      return;
    }
  }
  await (model as any).create(payload, { transaction });
}

// Generic soft-delete helper — eliminates the repetitive delete diffing pattern
private async softDeleteRemoved(
  model: any,
  companyId: number,
  incomingIds: (number | undefined)[],
  extraUpdate?: Record<string, any>,
  transaction?: any,
): Promise<void> {
  const existing = await model.findAll({
    where: { company_id: companyId, is_active: 1 },
    attributes: ['id'],
    transaction,
  });

  const existingIds: number[] = existing.map((r: any) => r.id);
  const validIncoming = incomingIds.filter(Boolean) as number[];
  const toDelete = existingIds.filter((eid) => !validIncoming.includes(eid));

  if (toDelete.length) {
    await model.update(
      { is_active: 0, ...extraUpdate },
      { where: { id: toDelete }, transaction },
    );
  }
}

}
