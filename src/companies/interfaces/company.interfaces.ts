export interface IAddressInput {
  id?: number;
  type?: string;
  label?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  phone?: string;
  fax?: string;
  notes?: string;
  is_default?: boolean;
}

export interface ILocationInput {
  id?: number;
  name?: string;
  location_type?: string;
  address_id?: number | null;
  manager_name?: string;
  manager_phone?: string;
  capacity?: string;
  operational_hours?: string;
  address_line_1?: string;
  address_line_2?: string;
  address_city?: string;
  address_state?: string;
  address_country?: string;
  address_postal_code?: string;
  notes?: string;
}

export interface IMetadataInput {
  id?: number;
  key: string;
  value?: string;
  data_type?: string;
  is_sensitive?: boolean;
}

export interface IBankAccountInput {
  id?: number;
  bank_name?: string;
  account_holder_name?: string;
  account_number?: string;
  ifsc_code?: string;
  branch_name?: string;
  branch_address?: string;
  account_type?: string;
  notes?: string;
  is_default?: boolean;
}