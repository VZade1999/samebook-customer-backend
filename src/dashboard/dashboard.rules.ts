// Pure helpers for the dashboard: date-range resolution, period comparison and
// permission → section mapping. No DB access here, so it is unit-tested.

export const MAX_RANGE_DAYS = 731; // two years (+ a leap day)
export const DEFAULT_TZ_MINUTES = 330; // Asia/Kolkata

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const toUtcMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromUtcMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, n: number): string => fromUtcMs(toUtcMs(date) + n * 86_400_000);

/** Inclusive number of days from `from` to `to` (same day = 1). */
export const daysInclusive = (from: string, to: string): number =>
  Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000) + 1;

/** Minutes east of UTC; browsers report the opposite sign (getTimezoneOffset). */
export const parseTz = (v: unknown): number => {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isInteger(n) || Math.abs(n) > 14 * 60) {
    return DEFAULT_TZ_MINUTES;
  }
  return n;
};

/** "Today" in a fixed-offset zone, as YYYY-MM-DD. */
export const todayIn = (now: Date, tzMinutes: number): string => fromUtcMs(now.getTime() + tzMinutes * 60_000);

/** Local midnight of `date` in the zone, as a UTC DATETIME string for SQL. */
export const localMidnightUtc = (date: string, tzMinutes: number): string =>
  new Date(toUtcMs(date) - tzMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');

export interface DashboardRange {
  from: string;
  to: string;
  days: number;
  prevFrom: string;
  prevTo: string;
  today: string;
  tz: number;
  /** [from 00:00, to+1 00:00) local time, as UTC DATETIME strings. */
  fromUtc: string;
  toUtcEnd: string;
  prevFromUtc: string;
  prevToUtcEnd: string;
}

export type RangeResult = { ok: true; range: DashboardRange } | { ok: false; message: string };

/**
 * Resolves the requested period. Defaults: the last 30 days ending today. The
 * comparison period has the same number of days: by default immediately
 * before it, or starting at `cmp_from` (e.g. the same days last month), which
 * must end before the period starts.
 */
export const resolveRange = (
  q: { from?: unknown; to?: unknown; today?: unknown; tz?: unknown; cmp_from?: unknown },
  now: Date = new Date(),
): RangeResult => {
  const tz = parseTz(q.tz);
  const today = isIsoDate(q.today) ? q.today : todayIn(now, tz);
  if (q.to !== undefined && q.to !== '' && !isIsoDate(q.to)) return { ok: false, message: 'to must be a date (YYYY-MM-DD)' };
  if (q.from !== undefined && q.from !== '' && !isIsoDate(q.from)) return { ok: false, message: 'from must be a date (YYYY-MM-DD)' };
  const to = isIsoDate(q.to) ? q.to : today;
  const from = isIsoDate(q.from) ? q.from : addDays(to, -29);
  if (from > to) return { ok: false, message: 'The start date must be on or before the end date' };
  const days = daysInclusive(from, to);
  if (days > MAX_RANGE_DAYS) return { ok: false, message: 'Pick a period of two years or less' };
  let prevTo = addDays(from, -1);
  let prevFrom = addDays(prevTo, -(days - 1));
  if (q.cmp_from !== undefined && q.cmp_from !== '') {
    if (!isIsoDate(q.cmp_from)) return { ok: false, message: 'cmp_from must be a date (YYYY-MM-DD)' };
    const end = addDays(q.cmp_from, days - 1);
    if (end >= from) return { ok: false, message: 'The comparison period must end before the selected period starts' };
    if (daysInclusive(q.cmp_from, to) > MAX_RANGE_DAYS * 2) return { ok: false, message: 'The comparison period is too far back' };
    prevFrom = q.cmp_from;
    prevTo = end;
  }
  return {
    ok: true,
    range: {
      from,
      to,
      days,
      prevFrom,
      prevTo,
      today,
      tz,
      fromUtc: localMidnightUtc(from, tz),
      toUtcEnd: localMidnightUtc(addDays(to, 1), tz),
      prevFromUtc: localMidnightUtc(prevFrom, tz),
      prevToUtcEnd: localMidnightUtc(addDays(prevTo, 1), tz),
    },
  };
};

export interface DashboardAccess {
  /** Invoice-level data (counts, recent invoices and payments). */
  invoices: boolean;
  /** Money totals (revenue, collections, receivables, GST, top lists). */
  insights: boolean;
  quotations: boolean;
  challans: boolean;
  customers: boolean;
  products: boolean;
  tasks: false | 'company' | 'mine';
  attendance: false | 'team' | 'me';
  drive: boolean;
}

/**
 * Which sections a user may see. Money aggregates follow the invoice list:
 * they need invoices.insides on top of invoices.view. Add-ons need the module
 * to be connected for the company as well as their own permission.
 */
export const accessFor = (permissions: string[], enabledModules: string[]): DashboardAccess => {
  const has = (p: string) => permissions.includes(p);
  const mod = (m: string) => enabledModules.includes(m);
  return {
    invoices: has('invoices.view'),
    insights: has('invoices.view') && has('invoices.insides'),
    quotations: has('quotations.view'),
    challans: has('challans.view'),
    customers: has('customers.view'),
    products: has('products.view'),
    tasks: mod('tasks') && has('tasks.view') ? (has('tasks.manage') ? 'company' : 'mine') : false,
    attendance: mod('attendance') && has('attendance.view') ? (has('attendance.manage') ? 'team' : 'me') : false,
    drive: mod('drive') && has('drive.view'),
  };
};

/** Percentage change, or null when there is nothing to compare against. */
export const pctChange = (current: number, previous: number): number | null => {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Rounds money to paise so float noise never shows up in the UI. */
export const money = (v: unknown): number => Math.round(num(v) * 100) / 100;
