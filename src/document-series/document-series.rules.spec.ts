import {
  businessDayStart,
  datePartsIn,
  effectiveNext,
  fyStartYear,
  periodKey,
  renderNumber,
  standardExample,
  tokensIn,
  validateSeries,
  SeriesInput,
} from './document-series.rules';

// 2026-11-13 10:00 IST
const NOV = new Date('2026-11-13T04:30:00Z');
const base: SeriesInput = {
  doc_type: 'INVOICE',
  name: 'Main',
  format: '{PREFIX}/{FY}/{SEQ}',
  padding: 4,
  reset_period: 'YEARLY',
  next_number: 1,
};
const check = (patch: Partial<SeriesInput>, now = NOV) => validateSeries({ ...base, ...patch }, { prefix: 'kd', now });

describe('document series rules', () => {
  describe('dates in India time', () => {
    it('uses the Indian date, not UTC, just after midnight IST', () => {
      // 2026-03-31 19:00 UTC = 2026-04-01 00:30 IST — already the new financial year
      expect(datePartsIn(new Date('2026-03-31T19:00:00Z'))).toEqual({ y: 2026, m: 4, d: 1 });
    });
    it('financial year runs April to March', () => {
      expect(fyStartYear({ y: 2026, m: 3, d: 31 })).toBe(2025);
      expect(fyStartYear({ y: 2026, m: 4, d: 1 })).toBe(2026);
    });
    it('business day starts at IST midnight', () => {
      expect(businessDayStart(NOV).toISOString()).toBe('2026-11-12T18:30:00.000Z');
      expect(businessDayStart(new Date('2026-11-12T19:00:00Z')).toISOString()).toBe('2026-11-12T18:30:00.000Z');
    });
  });

  describe('rendering', () => {
    const parts = { y: 2026, m: 1, d: 5 };
    it('fills every token', () => {
      expect(renderNumber({ format: '{PREFIX}/{FY}/{SEQ}', padding: 4, seq: 42, prefix: 'kd', parts })).toBe('KD/25-26/0042');
      expect(renderNumber({ format: 'INV{FY_LONG}-{SEQ}', padding: 3, seq: 7, parts })).toBe('INV2025-26-007');
      expect(renderNumber({ format: '{YYYY}{MM}{DD}-{SEQ}', padding: 2, seq: 3, parts })).toBe('20260105-03');
      expect(renderNumber({ format: '{YY}/{SEQ}', padding: 1, seq: 1543, parts })).toBe('26/1543');
    });
    it('lets the number grow past the padding', () => {
      expect(renderNumber({ format: '{SEQ}', padding: 3, seq: 12345, parts })).toBe('12345');
    });
    it('tokens are case-insensitive', () => {
      expect(renderNumber({ format: 'A-{seq}', padding: 2, seq: 5, parts })).toBe('A-05');
      expect(tokensIn('{seq}/{ fy }')).toEqual(['SEQ', 'FY']);
    });
    it('falls back to COMP without a prefix', () => {
      expect(renderNumber({ format: '{PREFIX}-{SEQ}', padding: 2, seq: 1, prefix: '  ', parts })).toBe('COMP-01');
    });
  });

  describe('counter periods', () => {
    const apr = { y: 2026, m: 4, d: 1 };
    const mar = { y: 2026, m: 3, d: 31 };
    it('keys', () => {
      expect(periodKey('YEARLY', mar)).toBe('FY2025');
      expect(periodKey('YEARLY', apr)).toBe('FY2026');
      expect(periodKey('MONTHLY', apr)).toBe('2026-04');
      expect(periodKey('DAILY', apr)).toBe('2026-04-01');
      expect(periodKey('NEVER', apr)).toBe('ALL');
    });
    it('continues within the period and restarts in a new one', () => {
      const s = { next_number: 1543, current_period: 'FY2025', reset_period: 'YEARLY' as const };
      expect(effectiveNext(s, mar)).toBe(1543);
      expect(effectiveNext(s, apr)).toBe(1);
      expect(effectiveNext({ ...s, reset_period: 'NEVER', current_period: 'ALL' }, apr)).toBe(1543);
    });
  });

  describe('validation', () => {
    it('accepts a typical GST series and previews the next number', () => {
      const v = check({ next_number: 1543 });
      expect(v.errors).toEqual([]);
      expect(v.preview).toBe('KD/26-27/1543');
      expect(v.warnings).toEqual([]);
    });
    it('needs {SEQ} exactly once', () => {
      expect(check({ format: 'KD/{FY}' }).errors.join()).toMatch(/must contain \{SEQ\}/);
      expect(check({ format: '{SEQ}/{FY}/{SEQ}' }).errors.join()).toMatch(/only once/);
    });
    it('rejects unknown tokens, open braces and odd characters', () => {
      expect(check({ format: '{FY}/{NUM}/{SEQ}' }).errors.join()).toMatch(/Unknown token: \{NUM\}/);
      expect(check({ format: '{FY}/{SEQ' }).errors.join()).toMatch(/not closed/);
      expect(check({ format: 'KD {FY} {SEQ}' }).errors.join()).toMatch(/no spaces/);
    });
    it('a restarting counter needs its period in the format, or numbers repeat', () => {
      expect(check({ format: 'INV-{SEQ}' }).errors.join()).toMatch(/financial year/);
      expect(check({ format: '{YYYY}/{SEQ}' }).errors.join()).toMatch(/financial year/);
      expect(check({ format: '{YYYY}/{SEQ}', reset_period: 'MONTHLY' }).errors.join()).toMatch(/\{MM\}/);
      expect(check({ format: '{FY}/{MM}/{SEQ}', reset_period: 'MONTHLY' }).errors).toEqual([]);
      expect(check({ format: '{YY}{MM}/{SEQ}', reset_period: 'DAILY' }).errors.join()).toMatch(/\{DD\}/);
      expect(check({ format: 'INV-{SEQ}', reset_period: 'NEVER' }).errors).toEqual([]);
    });
    it('warns about GST limits on invoices only', () => {
      const long = check({ format: 'KDELECTRICALS/{FY_LONG}/{SEQ}' });
      expect(long.errors).toEqual([]);
      expect(long.warnings.join()).toMatch(/16 characters/);
      expect(check({ format: 'KD_{FY}_{SEQ}' }).warnings.join()).toMatch(/"-" and "\/"/);
      expect(check({ doc_type: 'QUOTATION', format: 'KDELECTRICALS_{FY_LONG}_{SEQ}' }).warnings).toEqual([]);
    });
    it('counts the widest number the padding allows against the GST limit', () => {
      // KD/26-27/0001: 13 chars now, still 13 at 9999
      expect(check({ format: 'KD/{FY}/{SEQ}' }).warnings).toEqual([]);
      // INV/2026-27/0001 = 16, fine; padding 5 → 17
      expect(check({ format: 'INV/{FY_LONG}/{SEQ}', padding: 5 }).warnings.join()).toMatch(/reach 17/);
    });
    it('checks name, digits and next number', () => {
      expect(check({ name: ' ' }).errors.join()).toMatch(/name/);
      expect(check({ padding: 0 }).errors.join()).toMatch(/Digits/);
      expect(check({ next_number: 0 }).errors.join()).toMatch(/Next number/);
      expect(check({ next_number: 1.5 }).errors.join()).toMatch(/Next number/);
    });
    it('caps the rendered length', () => {
      expect(check({ doc_type: 'QUOTATION', format: 'ABCDEFGHIJABCDEFGHIJABCDEFGHIJABCDEFGHIJ-{SEQ}', reset_period: 'NEVER' }).errors.join()).toMatch(/characters long/);
    });
  });

  it('standard examples match the built-in formats', () => {
    expect(standardExample('INVOICE', 'kd', NOV)).toBe('INV-20261113-0001');
    expect(standardExample('QUOTATION', 'kd', NOV)).toBe('QT-KD-261113-001-0001');
    expect(standardExample('DELIVERY_CHALLAN', null, NOV)).toBe('DC-COMP-261113-001-0001');
  });
});
