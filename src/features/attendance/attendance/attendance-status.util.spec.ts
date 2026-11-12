import {
  buildAttendanceMonth,
  computeAttendanceDay,
  computeStats,
  DayStatus,
  HolidayInput,
  LeaveInput,
  normalizeSettings,
  parseMonth,
  parseWeeklyOffs,
  SessionInput,
  StatusContextInput,
  toZonedDateString,
  zonedDateTimeToUtc,
} from './attendance-status.util';

// Default settings: Asia/Kolkata, 09:30-18:30 (540 min), grace 15,
// half 240, full 480, Sunday off.
const settings = normalizeSettings(null);
const TZ = 'Asia/Kolkata';

// IST wall-clock -> Date
const ist = (date: string, time: string) => zonedDateTimeToUtc(date, time, TZ);

// 2026-11-11 is a Wednesday. "now" = 2026-11-11 14:00 IST.
const NOW = ist('2026-11-11', '14:00');

const session = (
  date: string,
  inTime: string,
  outTime: string | null,
  extra: Partial<SessionInput> = {},
): SessionInput => {
  const punchIn = ist(date, inTime);
  const punchOut = outTime ? ist(date, outTime) : null;
  return {
    work_date: date,
    punch_in: punchIn,
    punch_out: punchOut,
    total_minutes: punchOut ? Math.round((punchOut.getTime() - punchIn.getTime()) / 60000) : null,
    notes: null,
    ...extra,
  };
};

const day = (
  date: string,
  opts: {
    sessions?: SessionInput[];
    holidays?: HolidayInput[];
    leaves?: LeaveInput[];
    now?: Date;
    joinDate?: Date | string | null;
  } = {},
): DayStatus => {
  const input: StatusContextInput = {
    settings,
    holidays: opts.holidays ?? [],
    sessions: opts.sessions ?? [],
    leaves: opts.leaves ?? [],
    now: opts.now ?? NOW,
    joinDate: opts.joinDate ?? null,
  };
  return computeAttendanceDay(input, date);
};

describe('attendance-status.util', () => {
  describe('settings', () => {
    it('uses defaults when no row exists', () => {
      expect(settings).toEqual({
        timezone: 'Asia/Kolkata',
        shift_start: '09:30',
        shift_end: '18:30',
        grace_minutes: 15,
        half_day_minutes: 240,
        full_day_minutes: 480,
        weekly_offs: [0],
        shift_minutes: 540,
        is_default: true,
      });
    });

    it('normalizes a DB row (TIME seconds, CSV weekly offs, empty CSV)', () => {
      const s = normalizeSettings({
        timezone: 'UTC',
        shift_start: '10:00:00',
        shift_end: '19:00:00',
        grace_minutes: 10,
        half_day_minutes: 200,
        full_day_minutes: 450,
        weekly_offs: '6,0',
      });
      expect(s.shift_start).toBe('10:00');
      expect(s.shift_end).toBe('19:00');
      expect(s.weekly_offs).toEqual([0, 6]);
      expect(s.shift_minutes).toBe(540);
      expect(s.is_default).toBe(false);
      expect(parseWeeklyOffs('')).toEqual([]);
    });

    it('parses months', () => {
      expect(parseMonth('2026-02')?.dates.length).toBe(28);
      expect(parseMonth('2026-13')).toBeNull();
      expect(parseMonth('2026-1')).toBeNull();
    });
  });

  describe('working day statuses', () => {
    it('on-time full day -> PRESENT', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:30', '18:30')] });
      expect(d.status).toBe('PRESENT');
      expect(d.worked_minutes).toBe(540);
      expect(d.late_minutes).toBe(0);
      expect(d.overtime_minutes).toBe(0);
      expect(d.weekday).toBe(2);
      expect(d.punch_in).toBe(ist('2026-11-10', '09:30').toISOString());
    });

    it('punch-in exactly at grace boundary is not late', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:45', '18:30')] });
      expect(d.status).toBe('PRESENT');
      expect(d.late_minutes).toBe(0);
    });

    it('punch-in one minute past grace -> LATE with minutes from shift start', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:46', '18:30')] });
      expect(d.status).toBe('LATE');
      expect(d.late_minutes).toBe(16);
    });

    it('overtime beyond shift length', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:00', '19:30')] });
      expect(d.status).toBe('PRESENT');
      expect(d.overtime_minutes).toBe(90);
    });

    it('between half and full day -> HALF_DAY', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:30', '14:30')] });
      expect(d.status).toBe('HALF_DAY');
      expect(d.worked_minutes).toBe(300);
    });

    it('below half-day minutes -> ABSENT', () => {
      const d = day('2026-11-10', { sessions: [session('2026-11-10', '09:30', '11:00')] });
      expect(d.status).toBe('ABSENT');
      expect(d.worked_minutes).toBe(90);
    });

    it('open session today -> in_progress, status by punch-in time', () => {
      const onTime = day('2026-11-11', { sessions: [session('2026-11-11', '09:40', null)] });
      expect(onTime.status).toBe('PRESENT');
      expect(onTime.in_progress).toBe(true);
      expect(onTime.punch_out).toBeNull();
      expect(onTime.worked_minutes).toBe(260); // 09:40 -> 14:00

      const late = day('2026-11-11', { sessions: [session('2026-11-11', '10:30', null)] });
      expect(late.status).toBe('LATE');
      expect(late.late_minutes).toBe(60);
      expect(late.in_progress).toBe(true);
    });

    it('missed punch-out caps worked at shift length and zero overtime', () => {
      const s = session('2026-11-09', '09:30', '23:59:59', {
        notes: 'Auto punched-out — missed check-out',
      });
      const d = day('2026-11-09', { sessions: [s] });
      expect(d.missed_punch_out).toBe(true);
      expect(d.worked_minutes).toBe(540);
      expect(d.overtime_minutes).toBe(0);
      expect(d.status).toBe('PRESENT');
    });

    it('multiple sessions on a day are merged', () => {
      const d = day('2026-11-10', {
        sessions: [session('2026-11-10', '14:00', '19:00'), session('2026-11-10', '09:30', '13:00')],
      });
      expect(d.punch_in).toBe(ist('2026-11-10', '09:30').toISOString());
      expect(d.punch_out).toBe(ist('2026-11-10', '19:00').toISOString());
      expect(d.worked_minutes).toBe(510);
      expect(d.status).toBe('PRESENT');
    });

    it('no session today -> NOT_MARKED; no session on past day -> ABSENT', () => {
      expect(day('2026-11-11').status).toBe('NOT_MARKED');
      expect(day('2026-11-10').status).toBe('ABSENT');
    });

    it('future working day -> UPCOMING', () => {
      expect(day('2026-11-12').status).toBe('UPCOMING');
    });

    it('before join date -> NA', () => {
      const d = day('2026-11-02', { joinDate: ist('2026-11-05', '11:00') });
      expect(d.status).toBe('NA');
      expect(day('2026-11-05', { joinDate: '2026-11-05' }).status).toBe('ABSENT');
    });
  });

  describe('off days', () => {
    const holidays = [{ holiday_date: '2026-11-10', name: 'Festival' }];

    it('holiday -> HOLIDAY with name', () => {
      const d = day('2026-11-10', { holidays });
      expect(d.status).toBe('HOLIDAY');
      expect(d.holiday_name).toBe('Festival');
      expect(d.worked_on_off).toBe(false);
    });

    it('weekly off (Sunday) -> WEEKLY_OFF', () => {
      expect(day('2026-11-08').status).toBe('WEEKLY_OFF');
    });

    it('work on weekly off -> worked_on_off, all minutes overtime', () => {
      const d = day('2026-11-08', { sessions: [session('2026-11-08', '10:00', '13:00')] });
      expect(d.status).toBe('WEEKLY_OFF');
      expect(d.worked_on_off).toBe(true);
      expect(d.worked_minutes).toBe(180);
      expect(d.overtime_minutes).toBe(180);
    });

    it('work on holiday -> worked_on_off', () => {
      const d = day('2026-11-10', { holidays, sessions: [session('2026-11-10', '10:00', '12:00')] });
      expect(d.status).toBe('HOLIDAY');
      expect(d.worked_on_off).toBe(true);
      expect(d.overtime_minutes).toBe(120);
    });

    it('future holiday / weekly off still shown', () => {
      expect(day('2026-11-20', { holidays: [{ holiday_date: '2026-11-20', name: 'X' }] }).status).toBe(
        'HOLIDAY',
      );
      expect(day('2026-11-15').status).toBe('WEEKLY_OFF');
    });
  });

  describe('leaves', () => {
    const fullLeave: LeaveInput = {
      id: 7,
      from_date: '2026-11-09',
      to_date: '2026-11-13',
      leave_type: 'FULL_DAY',
      half_day_period: null,
      status: 'approved',
    };

    it('approved full-day leave -> ON_LEAVE (past, today, future)', () => {
      expect(day('2026-11-09', { leaves: [fullLeave] }).status).toBe('ON_LEAVE');
      expect(day('2026-11-11', { leaves: [fullLeave] }).status).toBe('ON_LEAVE');
      const future = day('2026-11-13', { leaves: [fullLeave] });
      expect(future.status).toBe('ON_LEAVE');
      expect(future.leave).toEqual({ id: 7, leave_type: 'FULL_DAY', half_day_period: null });
    });

    it('pending / rejected leaves are ignored', () => {
      expect(day('2026-11-10', { leaves: [{ ...fullLeave, status: 'pending' }] }).status).toBe(
        'ABSENT',
      );
      expect(day('2026-11-10', { leaves: [{ ...fullLeave, status: 'rejected' }] }).status).toBe(
        'ABSENT',
      );
    });

    it('approved half-day leave -> HALF_DAY_LEAVE with session fields filled', () => {
      const halfLeave: LeaveInput = {
        id: 8,
        from_date: '2026-11-10',
        to_date: '2026-11-10',
        leave_type: 'HALF_DAY',
        half_day_period: 'FIRST_HALF',
        status: 'approved',
      };
      const noSession = day('2026-11-10', { leaves: [halfLeave] });
      expect(noSession.status).toBe('HALF_DAY_LEAVE');
      expect(noSession.punch_in).toBeNull();

      const worked = day('2026-11-10', {
        leaves: [halfLeave],
        sessions: [session('2026-11-10', '14:00', '18:30')],
      });
      expect(worked.status).toBe('HALF_DAY_LEAVE');
      expect(worked.worked_minutes).toBe(270);
      expect(worked.leave?.half_day_period).toBe('FIRST_HALF');

      // Future half-day leave stays UPCOMING but is annotated.
      const future = day('2026-11-20', { leaves: [{ ...halfLeave, from_date: '2026-11-20', to_date: '2026-11-20' }] });
      expect(future.status).toBe('UPCOMING');
      expect(future.leave?.leave_type).toBe('HALF_DAY');
    });
  });

  describe('timezone boundaries', () => {
    it('punch at 00:30 IST lands on the IST date, not the UTC date', () => {
      const punchIn = ist('2026-11-10', '00:30');
      // In UTC this instant is still 2026-11-09.
      expect(punchIn.toISOString().slice(0, 10)).toBe('2026-11-09');
      expect(toZonedDateString(punchIn, TZ)).toBe('2026-11-10');
      expect(toZonedDateString(punchIn, 'UTC')).toBe('2026-11-09');
    });

    it('today is evaluated in the company timezone', () => {
      // 2026-11-10 20:00 UTC = 2026-11-11 01:30 IST: today (IST) is the 11th.
      const now = new Date('2026-11-10T20:00:00Z');
      expect(day('2026-11-11', { now }).status).toBe('NOT_MARKED');
      expect(day('2026-11-10', { now }).status).toBe('ABSENT');
    });

    it('zonedDateTimeToUtc handles IST offset', () => {
      expect(ist('2026-11-10', '09:30').toISOString()).toBe('2026-11-10T04:00:00.000Z');
    });
  });

  describe('month + stats', () => {
    it('builds a month and computes stats', () => {
      // November 2026, now = 11th 14:00 IST. Sundays: 1, 8, 15, 22, 29.
      const sessions = [
        session('2026-11-02', '09:30', '18:30'), // PRESENT, 540
        session('2026-11-03', '10:00', '19:00'), // LATE, 540
        session('2026-11-04', '09:30', '14:30'), // HALF_DAY, 300
        // 5th: absent (no session)
        session('2026-11-06', '09:30', '19:30'), // PRESENT, 600, ot 60
        session('2026-11-08', '10:00', '12:00'), // Sunday worked, ot 120
        session('2026-11-11', '09:30', null), // today in progress, 270
      ];
      const holidays = [{ holiday_date: '2026-11-09', name: 'Holiday' }];
      const leaves: LeaveInput[] = [
        { id: 1, from_date: '2026-11-07', to_date: '2026-11-07', leave_type: 'FULL_DAY', status: 'approved' },
        {
          id: 2,
          from_date: '2026-11-10',
          to_date: '2026-11-10',
          leave_type: 'HALF_DAY',
          half_day_period: 'SECOND_HALF',
          status: 'approved',
        },
        { id: 3, from_date: '2026-11-20', to_date: '2026-11-20', leave_type: 'FULL_DAY', status: 'approved' },
      ];

      const result = buildAttendanceMonth(
        { settings, holidays, sessions, leaves, now: NOW, joinDate: '2026-11-02' },
        '2026-11',
      );
      expect(result.days).toHaveLength(30);
      const statusOf = (d: string) => result.days.find((x) => x.date === d)?.status;
      expect(statusOf('2026-11-01')).toBe('NA');
      expect(statusOf('2026-11-05')).toBe('ABSENT');
      expect(statusOf('2026-11-07')).toBe('ON_LEAVE');
      expect(statusOf('2026-11-09')).toBe('HOLIDAY');
      expect(statusOf('2026-11-10')).toBe('HALF_DAY_LEAVE');
      expect(statusOf('2026-11-11')).toBe('PRESENT');
      expect(statusOf('2026-11-12')).toBe('UPCOMING');
      expect(statusOf('2026-11-20')).toBe('ON_LEAVE');
      expect(result.today?.date).toBe('2026-11-11');
      expect(result.today?.in_progress).toBe(true);

      const s = result.stats;
      // 30 days - NA(1st) - holiday(9th) - Sundays 8,15,22,29 = 24
      expect(s.working_days).toBe(24);
      // Elapsed: 2,3,4,5,6,7,10,11 = 8 (today is in progress -> PRESENT, counted)
      expect(s.elapsed_working_days).toBe(8);
      expect(s.present).toBe(3); // 2nd, 6th, 11th
      expect(s.late).toBe(1);
      expect(s.half_day).toBe(1);
      expect(s.absent).toBe(1);
      expect(s.on_leave).toBe(1.5); // 7th full + 10th half (future 20th excluded)
      expect(s.holidays).toBe(1);
      expect(s.weekly_offs).toBe(4); // 8, 15, 22, 29 (1st is NA)
      expect(s.total_worked_minutes).toBe(540 + 540 + 300 + 600 + 120 + 270);
      expect(s.overtime_minutes).toBe(60 + 120);
      expect(s.avg_worked_minutes).toBe(Math.round(2370 / 6));
      // (3 + 1 + 0.5*1 + 0) / (8 - 1.5) * 100 = 69.23 -> 69.2
      expect(s.attendance_percent).toBe(69.2);
    });

    it('attendance_percent is capped and safe on empty months', () => {
      expect(computeStats([], '2026-11-11').attendance_percent).toBe(0);
      const future = buildAttendanceMonth(
        { settings, holidays: [], sessions: [], leaves: [], now: NOW },
        '2026-12',
      );
      expect(future.stats.elapsed_working_days).toBe(0);
      expect(future.stats.attendance_percent).toBe(0);
      expect(future.today).toBeNull();
      expect(future.stats.working_days).toBe(27); // 31 - 4 Sundays
    });
  });

  describe('DST timezones', () => {
    const NY = 'America/New_York';
    const nySettings = normalizeSettings({
      timezone: NY,
      shift_start: '09:30:00',
      shift_end: '18:30:00',
      grace_minutes: 15,
      half_day_minutes: 240,
      full_day_minutes: 480,
      weekly_offs: '',
    });
    const nyDay = (date: string, inTime: string, outTime: string) => {
      const punchIn = zonedDateTimeToUtc(date, inTime, NY);
      const punchOut = zonedDateTimeToUtc(date, outTime, NY);
      return computeAttendanceDay(
        {
          settings: nySettings,
          holidays: [],
          sessions: [
            {
              work_date: date,
              punch_in: punchIn,
              punch_out: punchOut,
              total_minutes: Math.round((punchOut.getTime() - punchIn.getTime()) / 60000),
              notes: null,
            },
          ],
          leaves: [],
          now: NOW,
          joinDate: null,
        },
        date,
      );
    };

    it('DST end day (2026-11-01): on-time punch-in is not late', () => {
      const d = nyDay('2026-11-01', '09:30', '18:30');
      expect(d.status).toBe('PRESENT');
      expect(d.late_minutes).toBe(0);
    });

    it('DST start day (2026-03-08): 10:30 punch-in is 60 minutes late', () => {
      const d = nyDay('2026-03-08', '10:30', '19:30');
      expect(d.status).toBe('LATE');
      expect(d.late_minutes).toBe(60);
    });
  });
});
