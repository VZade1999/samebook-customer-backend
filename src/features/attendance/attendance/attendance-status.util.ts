// Pure attendance status engine: no DB access, no Nest dependencies.
// Every date/time decision is made in the company timezone
// (settings.timezone) via Intl.DateTimeFormat, never server-local time.

export type DayStatusCode =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'HALF_DAY_LEAVE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF'
  | 'NOT_MARKED'
  | 'UPCOMING'
  | 'NA';

export interface AttendanceSettingsView {
  timezone: string;
  shift_start: string; // HH:mm
  shift_end: string; // HH:mm
  grace_minutes: number;
  half_day_minutes: number;
  full_day_minutes: number;
  weekly_offs: number[];
  shift_minutes: number;
  is_default: boolean;
}

export interface AttendanceSettingsRow {
  timezone?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  grace_minutes?: number | null;
  half_day_minutes?: number | null;
  full_day_minutes?: number | null;
  weekly_offs?: string | null;
}

export interface HolidayInput {
  holiday_date: string;
  name: string;
}

export interface SessionInput {
  work_date: string | Date;
  punch_in: Date | string;
  punch_out?: Date | string | null;
  total_minutes?: number | null;
  notes?: string | null;
}

export interface LeaveInput {
  id: number;
  from_date: string;
  to_date: string;
  leave_type?: string | null;
  half_day_period?: string | null;
  status?: string | null;
}

export interface DayLeaveInfo {
  id: number;
  leave_type: 'FULL_DAY' | 'HALF_DAY';
  half_day_period: string | null;
}

export interface DayStatus {
  date: string;
  weekday: number;
  status: DayStatusCode;
  punch_in: string | null;
  punch_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  in_progress: boolean;
  missed_punch_out: boolean;
  worked_on_off: boolean;
  holiday_name: string | null;
  leave: DayLeaveInfo | null;
}

export interface AttendanceStats {
  working_days: number;
  elapsed_working_days: number;
  present: number;
  late: number;
  half_day: number;
  absent: number;
  on_leave: number;
  holidays: number;
  weekly_offs: number;
  total_worked_minutes: number;
  overtime_minutes: number;
  avg_worked_minutes: number;
  attendance_percent: number;
}

export interface StatusContextInput {
  settings: AttendanceSettingsView;
  holidays: HolidayInput[];
  sessions: SessionInput[];
  leaves: LeaveInput[];
  now: Date;
  // users.created_at (Date, converted into the company tz) or a YYYY-MM-DD
  // string already in the company tz; null/undefined = no lower bound.
  joinDate?: Date | string | null;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const AUTO_PUNCH_OUT_MARKER = 'Auto punched-out';

export const DEFAULT_ATTENDANCE_SETTINGS: Omit<
  AttendanceSettingsView,
  'shift_minutes' | 'is_default'
> = {
  timezone: DEFAULT_TIMEZONE,
  shift_start: '09:30',
  shift_end: '18:30',
  grace_minutes: 15,
  half_day_minutes: 240,
  full_day_minutes: 480,
  weekly_offs: [0],
};

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string): Intl.DateTimeFormat => {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
};

export const isValidTimezone = (timeZone: unknown): boolean => {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const out: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatYmd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

// Calendar date (YYYY-MM-DD) of an instant in the given timezone.
export const toZonedDateString = (date: Date, timeZone: string): string => {
  const p = getZonedParts(date, timeZone);
  return formatYmd(p.year, p.month, p.day);
};

const tzOffsetMs = (instant: number, timeZone: string): number => {
  const base = Math.floor(instant / 1000) * 1000;
  const p = getZonedParts(new Date(base), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - base;
};

// The UTC instant for a wall-clock date + time in the given timezone.
export const zonedDateTimeToUtc = (dateStr: string, time: string, timeZone: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  const off1 = tzOffsetMs(naive, timeZone);
  let result = naive - off1;
  const off2 = tzOffsetMs(result, timeZone);
  if (off2 !== off1) result = naive - off2;
  return new Date(result);
};

export const weekdayOf = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export const isValidDateString = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export interface MonthRange {
  month: string;
  start: string;
  end: string;
  dates: string[];
}

export const parseMonth = (month: unknown): MonthRange | null => {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  if (m < 1 || m > 12 || y < 1970 || y > 9999) return null;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= lastDay; d++) dates.push(formatYmd(y, m, d));
  return { month, start: dates[0], end: dates[dates.length - 1], dates };
};

export const currentMonthIn = (now: Date, timeZone: string): string =>
  toZonedDateString(now, timeZone).slice(0, 7);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const normalizeTime = (value: string | null | undefined, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return fallback;
  return `${pad2(h)}:${pad2(m)}`;
};

export const timeToMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const parseWeeklyOffs = (csv: string | null | undefined): number[] => {
  if (typeof csv !== 'string') return [...DEFAULT_ATTENDANCE_SETTINGS.weekly_offs];
  const values = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return Array.from(new Set(values)).sort((a, b) => a - b);
};

export const serializeWeeklyOffs = (offs: number[]): string =>
  Array.from(new Set(offs))
    .sort((a, b) => a - b)
    .join(',');

const intOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? fallback : Math.round(n);
};

export const normalizeSettings = (
  row: AttendanceSettingsRow | null | undefined,
): AttendanceSettingsView => {
  const d = DEFAULT_ATTENDANCE_SETTINGS;
  if (!row) {
    return {
      ...d,
      weekly_offs: [...d.weekly_offs],
      shift_minutes: timeToMinutes(d.shift_end) - timeToMinutes(d.shift_start),
      is_default: true,
    };
  }
  const shift_start = normalizeTime(row.shift_start, d.shift_start);
  let shift_end = normalizeTime(row.shift_end, d.shift_end);
  if (timeToMinutes(shift_end) <= timeToMinutes(shift_start)) shift_end = d.shift_end;
  const shiftMinutes = Math.max(1, timeToMinutes(shift_end) - timeToMinutes(shift_start));
  return {
    timezone: isValidTimezone(row.timezone) ? (row.timezone as string) : d.timezone,
    shift_start,
    shift_end,
    grace_minutes: intOr(row.grace_minutes, d.grace_minutes),
    half_day_minutes: intOr(row.half_day_minutes, d.half_day_minutes),
    full_day_minutes: intOr(row.full_day_minutes, d.full_day_minutes),
    weekly_offs: parseWeeklyOffs(row.weekly_offs),
    shift_minutes: shiftMinutes,
    is_default: false,
  };
};

// ---------------------------------------------------------------------------
// Status engine
// ---------------------------------------------------------------------------

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

interface PreparedContext {
  settings: AttendanceSettingsView;
  now: Date;
  today: string;
  joinDate: string | null;
  holidaysByDate: Map<string, string>;
  sessionsByDate: Map<string, SessionInput[]>;
  leaves: LeaveInput[];
}

const prepare = (input: StatusContextInput): PreparedContext => {
  const tz = input.settings.timezone;
  const holidaysByDate = new Map<string, string>();
  for (const h of input.holidays) holidaysByDate.set(String(h.holiday_date).slice(0, 10), h.name);

  const sessionsByDate = new Map<string, SessionInput[]>();
  for (const s of input.sessions) {
    const key =
      typeof s.work_date === 'string'
        ? s.work_date.slice(0, 10)
        : toZonedDateString(s.work_date, tz);
    const list = sessionsByDate.get(key) || [];
    list.push(s);
    sessionsByDate.set(key, list);
  }
  for (const list of sessionsByDate.values()) {
    list.sort((a, b) => toDate(a.punch_in).getTime() - toDate(b.punch_in).getTime());
  }

  let joinDate: string | null = null;
  if (input.joinDate instanceof Date && !isNaN(input.joinDate.getTime())) {
    joinDate = toZonedDateString(input.joinDate, tz);
  } else if (typeof input.joinDate === 'string' && input.joinDate) {
    joinDate = isValidDateString(input.joinDate.slice(0, 10))
      ? input.joinDate.slice(0, 10)
      : toZonedDateString(new Date(input.joinDate), tz);
  }

  return {
    settings: input.settings,
    now: input.now,
    today: toZonedDateString(input.now, tz),
    joinDate,
    holidaysByDate,
    sessionsByDate,
    leaves: input.leaves.filter((l) => (l.status ?? 'approved') === 'approved'),
  };
};

const findLeave = (leaves: LeaveInput[], date: string): DayLeaveInfo | null => {
  let found: DayLeaveInfo | null = null;
  for (const l of leaves) {
    const from = String(l.from_date).slice(0, 10);
    const to = String(l.to_date).slice(0, 10);
    if (from <= date && date <= to) {
      const type = l.leave_type === 'HALF_DAY' ? 'HALF_DAY' : 'FULL_DAY';
      const info: DayLeaveInfo = {
        id: l.id,
        leave_type: type,
        half_day_period: type === 'HALF_DAY' ? l.half_day_period ?? null : null,
      };
      // A full-day leave wins over a half-day one on the same date.
      if (type === 'FULL_DAY') return info;
      if (!found) found = info;
    }
  }
  return found;
};

interface SessionSummary {
  punch_in: Date;
  punch_out: Date | null;
  worked: number;
  in_progress: boolean;
  missed_punch_out: boolean;
}

const summarizeSessions = (
  ctx: PreparedContext,
  date: string,
  sessions: SessionInput[],
): SessionSummary => {
  const { settings, now, today } = ctx;
  let worked = 0;
  let open = false;
  let missed = false;
  let lastOut: Date | null = null;
  for (const s of sessions) {
    const pin = toDate(s.punch_in);
    if (s.notes && String(s.notes).includes(AUTO_PUNCH_OUT_MARKER)) missed = true;
    if (s.punch_out) {
      const pout = toDate(s.punch_out);
      const minutes =
        s.total_minutes !== null && s.total_minutes !== undefined
          ? Number(s.total_minutes)
          : Math.max(0, Math.round((pout.getTime() - pin.getTime()) / 60000));
      worked += minutes;
      if (!lastOut || pout > lastOut) lastOut = pout;
    } else {
      open = true;
      if (date === today) {
        worked += Math.max(0, Math.round((now.getTime() - pin.getTime()) / 60000));
      } else {
        // Left open on a past day and not yet auto-closed: count until that
        // day's end, then treat like a missed punch-out.
        const endOfDay = zonedDateTimeToUtc(date, '23:59:59', settings.timezone);
        worked += Math.max(0, Math.round((endOfDay.getTime() - pin.getTime()) / 60000));
        missed = true;
      }
    }
  }
  const in_progress = open && date === today;
  if (missed && !in_progress) worked = Math.min(worked, settings.shift_minutes);
  return {
    punch_in: toDate(sessions[0].punch_in),
    punch_out: open ? null : lastOut,
    worked,
    in_progress,
    missed_punch_out: missed && !in_progress,
  };
};

const lateMinutesFor = (ctx: PreparedContext, date: string, punchIn: Date): number => {
  const { settings } = ctx;
  // Use local wall-clock minutes (not elapsed real minutes since midnight) so
  // DST transition days don't shift the result by the DST offset.
  const p = getZonedParts(punchIn, settings.timezone);
  const [y, m, d] = date.split('-').map(Number);
  const dayDiff = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(y, m - 1, d)) / 86400000);
  const punchMinutes = dayDiff * 1440 + p.hour * 60 + p.minute;
  const shiftStart = timeToMinutes(settings.shift_start);
  return punchMinutes > shiftStart + settings.grace_minutes ? punchMinutes - shiftStart : 0;
};

const computeDayFromContext = (ctx: PreparedContext, date: string): DayStatus => {
  const { settings, today } = ctx;
  const holidayName = ctx.holidaysByDate.get(date) ?? null;
  const leave = findLeave(ctx.leaves, date);
  const weekday = weekdayOf(date);
  const day: DayStatus = {
    date,
    weekday,
    status: 'NA',
    punch_in: null,
    punch_out: null,
    worked_minutes: 0,
    late_minutes: 0,
    overtime_minutes: 0,
    in_progress: false,
    missed_punch_out: false,
    worked_on_off: false,
    holiday_name: holidayName,
    leave,
  };

  if (ctx.joinDate && date < ctx.joinDate) return day;

  const isHoliday = holidayName !== null;
  const isWeeklyOff = settings.weekly_offs.includes(weekday);
  const sessions = ctx.sessionsByDate.get(date) || [];
  const summary = sessions.length ? summarizeSessions(ctx, date, sessions) : null;

  const fillSession = (s: SessionSummary) => {
    day.punch_in = s.punch_in.toISOString();
    day.punch_out = s.punch_out ? s.punch_out.toISOString() : null;
    day.worked_minutes = s.worked;
    day.in_progress = s.in_progress;
    day.missed_punch_out = s.missed_punch_out;
  };

  if (isHoliday || isWeeklyOff) {
    day.status = isHoliday ? 'HOLIDAY' : 'WEEKLY_OFF';
    if (summary) {
      fillSession(summary);
      day.worked_on_off = true;
      day.overtime_minutes = summary.missed_punch_out ? 0 : summary.worked;
    }
    return day;
  }

  if (leave && leave.leave_type === 'FULL_DAY') {
    day.status = 'ON_LEAVE';
    if (summary) fillSession(summary);
    return day;
  }

  if (date > today) {
    day.status = 'UPCOMING';
    return day;
  }

  if (leave && leave.leave_type === 'HALF_DAY') {
    day.status = 'HALF_DAY_LEAVE';
    if (summary) {
      fillSession(summary);
      day.overtime_minutes = summary.missed_punch_out
        ? 0
        : Math.max(0, summary.worked - settings.shift_minutes);
    }
    return day;
  }

  if (!summary) {
    day.status = date === today ? 'NOT_MARKED' : 'ABSENT';
    return day;
  }

  fillSession(summary);
  day.late_minutes = lateMinutesFor(ctx, date, summary.punch_in);
  const late = day.late_minutes > 0;
  day.overtime_minutes = summary.missed_punch_out
    ? 0
    : Math.max(0, summary.worked - settings.shift_minutes);

  if (summary.in_progress) {
    day.status = late ? 'LATE' : 'PRESENT';
  } else if (summary.worked >= settings.full_day_minutes) {
    day.status = late ? 'LATE' : 'PRESENT';
  } else if (summary.worked >= settings.half_day_minutes) {
    day.status = 'HALF_DAY';
  } else {
    day.status = 'ABSENT';
  }
  return day;
};

export const computeAttendanceDay = (input: StatusContextInput, date: string): DayStatus =>
  computeDayFromContext(prepare(input), date);

const OFF_STATUSES: DayStatusCode[] = ['HOLIDAY', 'WEEKLY_OFF', 'NA'];

export const computeStats = (days: DayStatus[], today: string): AttendanceStats => {
  let working = 0;
  let elapsed = 0;
  let present = 0;
  let late = 0;
  let halfDay = 0;
  let absent = 0;
  let onLeave = 0;
  let halfLeaveWorked = 0;
  let holidays = 0;
  let weeklyOffs = 0;
  let totalWorked = 0;
  let overtime = 0;
  let daysWorked = 0;

  for (const d of days) {
    totalWorked += d.worked_minutes;
    overtime += d.overtime_minutes;
    if (d.worked_minutes > 0) daysWorked++;
    if (d.status === 'HOLIDAY') holidays++;
    if (d.status === 'WEEKLY_OFF') weeklyOffs++;
    if (OFF_STATUSES.includes(d.status)) continue;

    working++;
    if (d.date > today || d.status === 'NOT_MARKED' || d.status === 'UPCOMING') continue;

    elapsed++;
    switch (d.status) {
      case 'PRESENT':
        present++;
        break;
      case 'LATE':
        late++;
        break;
      case 'HALF_DAY':
        halfDay++;
        break;
      case 'ABSENT':
        absent++;
        break;
      case 'ON_LEAVE':
        onLeave += 1;
        break;
      case 'HALF_DAY_LEAVE':
        onLeave += 0.5;
        if (d.punch_in) halfLeaveWorked++;
        break;
      default:
        break;
    }
  }

  const credited = present + late + 0.5 * halfDay + 0.5 * halfLeaveWorked;
  const denominator = Math.max(1, elapsed - onLeave);
  const percent = Math.min(100, Math.max(0, (credited / denominator) * 100));

  return {
    working_days: working,
    elapsed_working_days: elapsed,
    present,
    late,
    half_day: halfDay,
    absent,
    on_leave: onLeave,
    holidays,
    weekly_offs: weeklyOffs,
    total_worked_minutes: totalWorked,
    overtime_minutes: overtime,
    avg_worked_minutes: daysWorked ? Math.round(totalWorked / daysWorked) : 0,
    attendance_percent: Math.round(percent * 10) / 10,
  };
};

export interface MonthResult {
  days: DayStatus[];
  stats: AttendanceStats;
  today: DayStatus | null;
}

export const buildAttendanceMonth = (input: StatusContextInput, month: string): MonthResult => {
  const range = parseMonth(month);
  if (!range) throw new Error(`Invalid month: ${month}`);
  const ctx = prepare(input);
  const days = range.dates.map((date) => computeDayFromContext(ctx, date));
  return {
    days,
    stats: computeStats(days, ctx.today),
    today: days.find((d) => d.date === ctx.today) ?? null,
  };
};
