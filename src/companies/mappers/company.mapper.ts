
import {
  company_locationsCreationAttributes,
} from '../../models/company_locations';
import {
  company_metadataCreationAttributes,
} from '../../models/company_metadata';
import {
  company_bank_accountsCreationAttributes,
} from '../../models/company_bank_accounts';
import {
  IAddressInput,
  IBankAccountInput,
  ILocationInput,
  IMetadataInput,
} from '../interfaces/company.interfaces';
import { company_addressesCreationAttributes } from 'src/models/company_addresses';

/**
 * Removes undefined values from an object while preserving full type safety.
 * null values are preserved intentionally (used for FK clearing).
 */
export function stripUndefined<T extends object>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== undefined),
  ) as Partial<T>;
}

export class CompanyMapper {
  static toAddressPayload(
    companyId: number,
    input: IAddressInput,
  ): company_addressesCreationAttributes {
    return stripUndefined({
      company_id: companyId,
      type: input.type,
      label: input.label,
      line_1: input.line_1,
      line_2: input.line_2,
      city: input.city,
      state: input.state,
      country: input.country,
      postal_code: input.postal_code,
      phone: input.phone,
      fax: input.fax,
      notes: input.notes,
      is_default: input.is_default !== undefined
        ? (input.is_default ? 1 : 0)
        : undefined,
      is_active: input.id ? 1 : undefined,
    }) as company_addressesCreationAttributes;
  }

  static toLocationPayload(
    companyId: number,
    input: ILocationInput,
  ): company_locationsCreationAttributes {
    return stripUndefined({
      company_id: companyId,
      name: input.name,
      location_type: input.location_type,
      address_id: input.address_id,        // null allowed — clears FK
      manager_name: input.manager_name,
      manager_phone: input.manager_phone,
      capacity: input.capacity,
      operational_hours: input.operational_hours,
      address_line_1: input.address_line_1,
      address_line_2: input.address_line_2,
      address_city: input.address_city,
      address_state: input.address_state,
      address_country: input.address_country,
      address_postal_code: input.address_postal_code,
      notes: input.notes,
      is_active: input.id ? 1 : undefined,
    }) as company_locationsCreationAttributes;
  }

  static toMetadataPayload(
    companyId: number,
    input: IMetadataInput,
  ): company_metadataCreationAttributes {
    return stripUndefined({
      company_id: companyId,
      key: input.key,
      value: input.value,
      data_type: input.data_type,
      is_sensitive: input.is_sensitive !== undefined
        ? (input.is_sensitive ? 1 : 0)
        : undefined,
      is_active: input.id ? 1 : undefined,
    }) as company_metadataCreationAttributes;
  }

  static toBankAccountPayload(
    companyId: number,
    input: IBankAccountInput,
  ): company_bank_accountsCreationAttributes {
    return stripUndefined({
      company_id: companyId,
      bank_name: input.bank_name,
      account_holder_name: input.account_holder_name,
      account_number: input.account_number,
      ifsc_code: input.ifsc_code,
      branch_name: input.branch_name,
      branch_address: input.branch_address,
      account_type: input.account_type,
      notes: input.notes,
      is_default: input.is_default !== undefined
        ? (input.is_default ? 1 : 0)
        : undefined,
      is_active: input.id ? 1 : undefined,
    }) as company_bank_accountsCreationAttributes;
  }
}