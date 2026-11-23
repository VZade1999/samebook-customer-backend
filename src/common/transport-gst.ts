import { QueryTypes } from 'sequelize';
import { transportTaxed } from './transport-gst.rules';

/**
 * Does this company charge GST on transport (companies.transport_gst)? Read
 * straight from the database inside the caller's transaction — never from a
 * cache, because document totals depend on it. Unknown company → the GST rule.
 */
export async function companyTaxesTransport(sequelize: any, companyId: number, transaction?: any): Promise<boolean> {
  const rows: any[] = await sequelize.query('SELECT transport_gst FROM companies WHERE id = :c LIMIT 1', {
    replacements: { c: companyId },
    type: QueryTypes.SELECT,
    transaction,
  });
  return transportTaxed(rows[0]?.transport_gst);
}
