import {
  MAX_RANGE_DAYS,
  accessFor,
  addDays,
  daysInclusive,
  isIsoDate,
  localMidnightUtc,
  parseTz,
  pctChange,
  resolveRange,
  todayIn,
} from './dashboard.rules';

describe('dashboard rules', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-11-12')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate(20261112)).toBe(false);
  });

  it('does date arithmetic across months and leap years', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysInclusive('2026-11-12', '2026-11-12')).toBe(1);
    expect(daysInclusive('2026-01-01', '2026-12-31')).toBe(365);
  });

  it('reads the browser time zone safely', () => {
    expect(parseTz('330')).toBe(330);
    expect(parseTz('-300')).toBe(-300);
    expect(parseTz('abc')).toBe(330);
    expect(parseTz('5000')).toBe(330);
    expect(parseTz(undefined)).toBe(330);
  });

  it('works out "today" and local midnight in the viewer zone', () => {
    // 20:00 UTC on the 12th is already the 13th in India (UTC+5:30).
    expect(todayIn(new Date('2026-11-12T20:00:00Z'), 330)).toBe('2026-11-13');
    expect(todayIn(new Date('2026-11-12T20:00:00Z'), -300)).toBe('2026-11-12');
    expect(localMidnightUtc('2026-11-13', 330)).toBe('2026-11-12 18:30:00');
  });

  it('defaults to the last 30 days and compares with the 30 days before', () => {
    const r = resolveRange({ today: '2026-11-12' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.range).toMatchObject({ from: '2026-10-14', to: '2026-11-12', days: 30, prevFrom: '2026-09-14', prevTo: '2026-10-13' });
    expect(r.range.fromUtc).toBe('2026-10-13 18:30:00');
    expect(r.range.toUtcEnd).toBe('2026-11-12 18:30:00');
  });

  it('uses an equal-length previous period for custom ranges', () => {
    const r = resolveRange({ from: '2026-04-01', to: '2027-03-31', today: '2026-11-12' });
    expect(r.ok && r.range.days).toBe(365);
    expect(r.ok && [r.range.prevFrom, r.range.prevTo]).toEqual(['2025-04-01', '2026-03-31']);
  });

  it('can compare month-to-date with the same days of last month', () => {
    const r = resolveRange({ from: '2026-11-01', to: '2026-11-12', cmp_from: '2026-10-01', today: '2026-11-12' });
    expect(r.ok && [r.range.prevFrom, r.range.prevTo, r.range.days]).toEqual(['2026-10-01', '2026-10-12', 12]);
    expect(r.ok && r.range.prevToUtcEnd).toBe('2026-10-12 18:30:00');
    // The comparison period may not overlap the selected one.
    expect(resolveRange({ from: '2026-11-01', to: '2026-11-12', cmp_from: '2026-10-25' })).toMatchObject({ ok: false });
    expect(resolveRange({ from: '2026-11-01', to: '2026-11-12', cmp_from: 'last-month' })).toMatchObject({ ok: false });
  });

  it('rejects bad ranges with a readable message', () => {
    expect(resolveRange({ from: '2026-11-12', to: '2026-11-01' })).toMatchObject({ ok: false });
    expect(resolveRange({ from: 'yesterday' })).toMatchObject({ ok: false });
    const tooLong = resolveRange({ from: addDays('2026-11-12', -MAX_RANGE_DAYS), to: '2026-11-12' });
    expect(tooLong).toMatchObject({ ok: false, message: 'Pick a period of two years or less' });
  });

  it('gives money totals only with invoices.insides, add-ons only when connected', () => {
    const viewer = accessFor(['invoices.view', 'quotations.view', 'tasks.view'], []);
    expect(viewer).toMatchObject({ invoices: true, insights: false, quotations: true, tasks: false });
    const admin = accessFor(
      ['invoices.view', 'invoices.insides', 'tasks.view', 'tasks.manage', 'attendance.view', 'drive.view'],
      ['tasks', 'attendance'],
    );
    expect(admin).toMatchObject({ insights: true, tasks: 'company', attendance: 'me', drive: false });
  });

  it('computes period-over-period change', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
});
