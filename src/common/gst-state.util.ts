// Canonical GST state/UT codes (GSTN), used to resolve a GSTIN's registered
// state and to normalize free-text state names typed on addresses/forms.
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

const STATE_NAME_TO_CODE: Record<string, string> = Object.entries(
  GST_STATE_CODES,
).reduce(
  (acc, [code, name]) => {
    acc[name.trim().toLowerCase()] = code;
    return acc;
  },
  {} as Record<string, string>,
);

export function getStateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin) return null;
  const prefix = gstin.trim().slice(0, 2);
  return GST_STATE_CODES[prefix] ? prefix : null;
}

export function getStateCodeFromName(name?: string | null): string | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  return STATE_NAME_TO_CODE[normalized] || null;
}

export type TaxType = 'INTRA_STATE' | 'INTER_STATE' | 'NO_GST';

// sellerStateCode null => seller has no GSTIN on record => GST does not apply.
// buyerStateCode unresolved => can't confirm same-state, so default to the
// safer inter-state (IGST) treatment rather than silently assuming intra-state.
export function determineTaxType(
  sellerStateCode: string | null,
  buyerStateCode: string | null,
): TaxType {
  if (!sellerStateCode) return 'NO_GST';
  if (!buyerStateCode) return 'INTER_STATE';
  return sellerStateCode === buyerStateCode ? 'INTRA_STATE' : 'INTER_STATE';
}
