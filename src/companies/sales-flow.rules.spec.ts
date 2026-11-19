import { SALES_FLOWS, parseSalesFlow, storedSalesFlow } from './sales-flow.rules';

describe('sales flow setting', () => {
  it('accepts the five flows in any case', () => {
    expect(SALES_FLOWS).toEqual(['ALL', 'WITH_GOODS', 'SEND_FIRST', 'BILL_FIRST', 'SERVICES']);
    expect(parseSalesFlow(' bill_first ')).toBe('BILL_FIRST');
    expect(parseSalesFlow('SERVICES')).toBe('SERVICES');
  });

  it('refuses anything else', () => {
    expect(parseSalesFlow('INVOICE_ONLY')).toBeNull();
    expect(parseSalesFlow('')).toBeNull();
    expect(parseSalesFlow(undefined)).toBeNull();
  });

  it('reads a stored value, null when never chosen', () => {
    expect(storedSalesFlow(null)).toBeNull();
    expect(storedSalesFlow('SEND_FIRST')).toBe('SEND_FIRST');
    expect(storedSalesFlow('garbage')).toBeNull();
  });
});
