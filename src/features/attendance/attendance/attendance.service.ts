import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../../../common/logger/logger.service';
import { PunchDto } from './dto/punch.dto';
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import {
  AttendanceSettingsView,
  AUTO_PUNCH_OUT_MARKER,
  buildAttendanceMonth,
  computeAttendanceDay,
  currentMonthIn,
  DayStatusCode,
  isValidDateString,
  isValidTimezone,
  normalizeSettings,
  parseMonth,
  serializeWeeklyOffs,
  timeToMinutes,
  toZonedDateString,
  zonedDateTimeToUtc,
} from './attendance-status.util';

// Punch in/out/today/history/calendar are self-service: they resolve to the
// caller's own rows (req.user.user_id, set by AuthGuard from the JWT).
// Team endpoints and settings/holiday writes are company-wide and only
// reachable via the `attendance.manage` permission, gated in the controller.
// Every query is scoped to req.user.company_id.
export interface AttendanceRequester {
  userId: number;
  companyId: number;
}

const displayName = (u: any): string =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;

const sortByName = <T extends { name: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

const holidayView = (h: any) => ({
  id: Number(h.id),
  holiday_date: String(h.holiday_date).slice(0, 10),
  name: h.name,
});

@Injectable()
export class AttendanceService {
  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {}

  private get Attendance() {
    return this.dbProvider.db.attendance;
  }

  private get Users() {
    return this.dbProvider.db.users;
  }

  private get LeaveRequests() {
    return this.dbProvider.db.leave_requests;
  }

  private get Settings() {
    return this.dbProvider.db.attendance_settings;
  }

  private get Holidays() {
    return this.dbProvider.db.attendance_holidays;
  }

  // Never throws: if the settings table is missing or unreachable, the
  // defaults are used so punch-in/out keep working (e.g. before the
  // add_attendance_policies.sql migration has been applied).
  private async loadSettings(companyId: number): Promise<AttendanceSettingsView> {
    try {
      const row = await this.Settings.findOne({ where: { company_id: companyId } });
      return normalizeSettings(row ? row.get({ plain: true }) : null);
    } catch (err) {
      this.appLogger
        .forContext('AttendanceService', 'loadSettings', { companyId })
        .error('Failed to load attendance settings, falling back to defaults', err);
      return normalizeSettings(null);
    }
  }

  private async loadHolidays(companyId: number, start: string, end: string) {
    try {
      const rows = await this.Holidays.findAll({
        where: { company_id: companyId, holiday_date: { [Op.between]: [start, end] } },
        order: [['holiday_date', 'ASC']],
      });
      return rows.map(holidayView);
    } catch (err) {
      this.appLogger
        .forContext('AttendanceService', 'loadHolidays', { companyId })
        .error('Failed to load attendance holidays, treating as none', err);
      return [];
    }
  }

  private loadApprovedLeaves(companyId: number, start: string, end: string, userId?: number) {
    return this.LeaveRequests.findAll({
      where: {
        company_id: companyId,
        status: 'approved',
        from_date: { [Op.lte]: end },
        to_date: { [Op.gte]: start },
        ...(userId !== undefined && { user_id: userId }),
      },
      attributes: ['id', 'user_id', 'from_date', 'to_date', 'leave_type', 'half_day_period', 'status'],
    });
  }

  // ---------------------------------------------------------------------------
  // Self-service punch endpoints
  // ---------------------------------------------------------------------------

  async punchIn(data: PunchDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'punchIn', {
      userId: requester.userId,
    });

    const settings = await this.loadSettings(requester.companyId);
    const now = new Date();
    const today = toZonedDateString(now, settings.timezone);

    const openSession = await this.Attendance.findOne({
      where: { user_id: requester.userId, punch_out: null },
    });

    if (openSession) {
      if (openSession.work_date === today) {
        log.warn('Punch-in rejected, already punched in');
        return { success: false, message: 'You are already punched in' };
      }

      // Left open from a previous day (forgot to punch out): auto-close it
      // at end-of-day (company timezone) for that date so it stops blocking
      // today's punch-in.
      try {
        const punchInAt = new Date(openSession.punch_in);
        let endOfStaleDay = zonedDateTimeToUtc(
          String(openSession.work_date).slice(0, 10),
          '23:59:59',
          settings.timezone,
        );
        if (endOfStaleDay.getTime() < punchInAt.getTime()) endOfStaleDay = punchInAt;
        const staleMinutes = Math.max(
          0,
          Math.round((endOfStaleDay.getTime() - punchInAt.getTime()) / 60000),
        );
        await openSession.update({
          punch_out: endOfStaleDay,
          total_minutes: staleMinutes,
          notes: [openSession.notes, `${AUTO_PUNCH_OUT_MARKER} â€” missed check-out`]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 255),
        });
        log.warn('Auto-closed a stale open session from a previous day', {
          staleWorkDate: openSession.work_date,
        });
      } catch (err) {
        log.error('DB error auto-closing stale attendance session', err);
        throw new Error('DATABASE_ERROR');
      }
    }

    // Once-per-day rule: today's attendance is already complete if a record
    // for today exists at this point (an open one is handled above).
    const existingToday = await this.Attendance.findOne({
      where: { user_id: requester.userId, work_date: today },
    });
    if (existingToday) {
      log.warn('Punch-in rejected, attendance already completed today');
      return {
        success: false,
        message: 'You have already completed your attendance for today',
      };
    }

    try {
      const record = await this.Attendance.create({
        user_id: requester.userId,
        company_id: requester.companyId,
        punch_in: now,
        work_date: today,
        notes: data.notes ?? null,
      });
      log.info('Punched in successfully');
      return { success: true, message: 'Punched in successfully', data: record };
    } catch (err) {
      log.error('DB error while punching in', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async punchOut(data: PunchDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'punchOut', {
      userId: requester.userId,
    });

    const settings = await this.loadSettings(requester.companyId);

    // Scoped to today only: a stale prior-day open session is only ever
    // closed automatically via the next punch-in, never by a punch-out call.
    const openSession = await this.Attendance.findOne({
      where: {
        user_id: requester.userId,
        punch_out: null,
        work_date: toZonedDateString(new Date(), settings.timezone),
      },
    });

    if (!openSession) {
      log.warn('Punch-out rejected, no open session for today');
      return { success: false, message: 'You are not currently punched in' };
    }

    const now = new Date();
    const totalMinutes = Math.max(
      0,
      Math.round((now.getTime() - new Date(openSession.punch_in).getTime()) / 60000),
    );

    try {
      await openSession.update({
        punch_out: now,
        total_minutes: totalMinutes,
        ...(data.notes !== undefined && { notes: data.notes }),
      });
      log.info('Punched out successfully');
      return { success: true, message: 'Punched out successfully', data: openSession };
    } catch (err) {
      log.error('DB error while punching out', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async getToday(requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getToday', {
      userId: requester.userId,
    });

    const settings = await this.loadSettings(requester.companyId);
    try {
      const record = await this.Attendance.findOne({
        where: {
          user_id: requester.userId,
          work_date: toZonedDateString(new Date(), settings.timezone),
        },
        order: [['punch_in', 'DESC']],
      });
      return { success: true, message: "Today's attendance fetched", data: record };
    } catch (err) {
      log.error("DB error while fetching today's attendance", err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async getHistory(page: number, limit: number, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getHistory', {
      userId: requester.userId,
    });

    const offset = (page - 1) * limit;

    try {
      const { count, rows } = await this.Attendance.findAndCountAll({
        where: { user_id: requester.userId },
        order: [['punch_in', 'DESC']],
        limit,
        offset,
      });
      return {
        success: true,
        message: 'Attendance history fetched',
        data: {
          rows,
          pagination: { total: count, page, limit, pages: Math.ceil(count / limit) },
        },
      };
    } catch (err) {
      log.error('DB error while fetching attendance history', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings(requester: AttendanceRequester) {
    const settings = await this.loadSettings(requester.companyId);
    return { success: true, message: 'Attendance settings fetched', data: settings };
  }

  async updateSettings(data: UpdateAttendanceSettingsDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'updateSettings', {
      companyId: requester.companyId,
    });

    let existing: any;
    try {
      existing = await this.Settings.findOne({ where: { company_id: requester.companyId } });
    } catch (err) {
      log.error('DB error while loading attendance settings', err);
      throw new Error('DATABASE_ERROR');
    }
    const current = normalizeSettings(existing ? existing.get({ plain: true }) : null);

    const timezone = data.timezone != null ? String(data.timezone).trim() : current.timezone;
    if (!isValidTimezone(timezone)) {
      return { success: false, message: `Invalid timezone: ${data.timezone}` };
    }
    const merged = {
      timezone,
      shift_start: data.shift_start ?? current.shift_start,
      shift_end: data.shift_end ?? current.shift_end,
      grace_minutes: data.grace_minutes ?? current.grace_minutes,
      half_day_minutes: data.half_day_minutes ?? current.half_day_minutes,
      full_day_minutes: data.full_day_minutes ?? current.full_day_minutes,
      weekly_offs: data.weekly_offs ?? current.weekly_offs,
    };

    if (timeToMinutes(merged.shift_end) <= timeToMinutes(merged.shift_start)) {
      return { success: false, message: 'Shift end must be after shift start' };
    }
    if (merged.half_day_minutes >= merged.full_day_minutes) {
      return {
        success: false,
        message: 'Half-day minutes must be less than full-day minutes',
      };
    }

    const values = {
      timezone: merged.timezone,
      shift_start: `${merged.shift_start}:00`,
      shift_end: `${merged.shift_end}:00`,
      grace_minutes: merged.grace_minutes,
      half_day_minutes: merged.half_day_minutes,
      full_day_minutes: merged.full_day_minutes,
      weekly_offs: serializeWeeklyOffs(merged.weekly_offs),
      updated_by: requester.userId,
    };

    try {
      let saved: any;
      if (existing) {
        saved = await existing.update({ ...values, updated_at: new Date() });
      } else {
        saved = await this.Settings.create({ company_id: requester.companyId, ...values });
      }
      log.info('Attendance settings saved');
      return {
        success: true,
        message: 'Attendance settings saved',
        data: normalizeSettings(saved.get({ plain: true })),
      };
    } catch (err) {
      log.error('DB error while saving attendance settings', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  // ---------------------------------------------------------------------------
  // Holidays
  // ---------------------------------------------------------------------------

  async getHolidays(yearParam: string | undefined, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getHolidays', {
      companyId: requester.companyId,
    });

    let year: number;
    if (yearParam === undefined || yearParam === '') {
      const settings = await this.loadSettings(requester.companyId);
      year = Number(toZonedDateString(new Date(), settings.timezone).slice(0, 4));
    } else if (/^\d{4}$/.test(yearParam)) {
      year = Number(yearParam);
    } else {
      return { success: false, message: 'year must be in YYYY format' };
    }

    try {
      const rows = await this.Holidays.findAll({
        where: {
          company_id: requester.companyId,
          holiday_date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] },
        },
        order: [['holiday_date', 'ASC']],
      });
      return { success: true, message: 'Holidays fetched', data: rows.map(holidayView) };
    } catch (err) {
      log.error('DB error while fetching holidays', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async createHoliday(data: CreateHolidayDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'createHoliday', {
      companyId: requester.companyId,
    });

    if (!isValidDateString(data.holiday_date)) {
      return { success: false, message: 'holiday_date is not a valid date' };
    }
    const name = data.name.trim();
    if (!name) {
      return { success: false, message: 'Holiday name is required' };
    }

    const duplicateMessage = 'A holiday already exists on that date';
    try {
      const existing = await this.Holidays.findOne({
        where: { company_id: requester.companyId, holiday_date: data.holiday_date },
      });
      if (existing) return { success: false, message: duplicateMessage };

      const record = await this.Holidays.create({
        company_id: requester.companyId,
        holiday_date: data.holiday_date,
        name,
        created_by: requester.userId,
      });
      log.info('Holiday created');
      return { success: true, message: 'Holiday added', data: holidayView(record) };
    } catch (err: any) {
      if (err?.name === 'SequelizeUniqueConstraintError') {
        return { success: false, message: duplicateMessage };
      }
      log.error('DB error while creating holiday', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async deleteHoliday(id: number, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'deleteHoliday', {
      companyId: requester.companyId,
      holidayId: id,
    });

    try {
      const deleted = await this.Holidays.destroy({
        where: { id, company_id: requester.companyId },
      });
      if (!deleted) {
        return { success: false, message: `Holiday with id ${id} not found`, notFound: true };
      }
      log.info('Holiday deleted');
      return { success: true, message: 'Holiday deleted', data: { id } };
    } catch (err) {
      log.error('DB error while deleting holiday', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  // ---------------------------------------------------------------------------
  // Calendar (self) and team views
  // ---------------------------------------------------------------------------

  async getCalendar(monthParam: string | undefined, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getCalendar', {
      userId: requester.userId,
      month: monthParam,
    });

    const settings = await this.loadSettings(requester.companyId);
    const now = new Date();
    const month = monthParam || currentMonthIn(now, settings.timezone);
    const range = parseMonth(month);
    if (!range) return { success: false, message: 'month must be in YYYY-MM format' };

    try {
      const [holidays, leaves, sessions, user] = await Promise.all([
        this.loadHolidays(requester.companyId, range.start, range.end),
        this.loadApprovedLeaves(requester.companyId, range.start, range.end, requester.userId),
        this.Attendance.findAll({
          where: {
            user_id: requester.userId,
            company_id: requester.companyId,
            work_date: { [Op.between]: [range.start, range.end] },
          },
          order: [['punch_in', 'ASC']],
        }),
        this.Users.findOne({
          where: { id: requester.userId, company_id: requester.companyId },
          attributes: ['id', 'created_at'],
        }),
      ]);

      const result = buildAttendanceMonth(
        { settings, holidays, leaves, sessions, now, joinDate: user?.created_at ?? null },
        month,
      );
      return {
        success: true,
        message: 'Attendance calendar fetched',
        data: { month, settings, days: result.days, stats: result.stats, today: result.today },
      };
    } catch (err) {
      log.error('DB error while fetching attendance calendar', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async getTeamToday(requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getTeamToday', {
      companyId: requester.companyId,
    });

    const settings = await this.loadSettings(requester.companyId);
    const now = new Date();
    const today = toZonedDateString(now, settings.timezone);

    try {
      const [employees, sessions, leaves, holidays] = await Promise.all([
        this.Users.findAll({
          where: { company_id: requester.companyId, is_active: 1 },
          attributes: ['id', 'first_name', 'last_name', 'email', 'created_at'],
        }),
        this.Attendance.findAll({
          where: { company_id: requester.companyId, work_date: today },
          order: [['punch_in', 'ASC']],
        }),
        this.loadApprovedLeaves(requester.companyId, today, today),
        this.loadHolidays(requester.companyId, today, today),
      ]);

      const sessionsByUser = this.groupByUser(sessions);
      const leavesByUser = this.groupByUser(leaves);

      const counts: Record<string, number> = {
        total: 0,
        present: 0,
        late: 0,
        half_day: 0,
        not_marked: 0,
        absent: 0,
        on_leave: 0,
        half_day_leave: 0,
        off: 0,
      };
      const countKey: Partial<Record<DayStatusCode, string>> = {
        PRESENT: 'present',
        LATE: 'late',
        HALF_DAY: 'half_day',
        NOT_MARKED: 'not_marked',
        ABSENT: 'absent',
        ON_LEAVE: 'on_leave',
        HALF_DAY_LEAVE: 'half_day_leave',
        HOLIDAY: 'off',
        WEEKLY_OFF: 'off',
      };

      const rows = employees.map((emp: any) => {
        const day = computeAttendanceDay(
          {
            settings,
            holidays,
            sessions: sessionsByUser.get(Number(emp.id)) || [],
            leaves: leavesByUser.get(Number(emp.id)) || [],
            now,
            joinDate: emp.created_at ?? null,
          },
          today,
        );
        counts.total++;
        const key = countKey[day.status];
        if (key) counts[key]++;
        return {
          user_id: emp.id,
          name: displayName(emp),
          email: emp.email,
          status: day.status,
          punch_in: day.punch_in,
          punch_out: day.punch_out,
          worked_minutes: day.worked_minutes,
          late_minutes: day.late_minutes,
          in_progress: day.in_progress,
          missed_punch_out: day.missed_punch_out,
          leave: day.leave,
        };
      });

      return {
        success: true,
        message: "Team's attendance for today fetched",
        data: { date: today, settings, counts, employees: sortByName(rows) },
      };
    } catch (err) {
      log.error("DB error while fetching team's attendance for today", err);
      throw new Error('DATABASE_ERROR');
    }
  }

  // Admin-only: every employee's attendance for the caller's company for a
  // given calendar month, grouped into a per-employee summary. One query per
  // table for the whole company rather than one per employee.
  async getTeamSummary(monthParam: string | undefined, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getTeamSummary', {
      companyId: requester.companyId,
      month: monthParam,
    });

    const settings = await this.loadSettings(requester.companyId);
    const now = new Date();
    const month = monthParam || currentMonthIn(now, settings.timezone);
    const range = parseMonth(month);
    if (!range) return { success: false, message: 'month must be in YYYY-MM format' };

    try {
      const [employees, sessions, leaves, holidays] = await Promise.all([
        this.Users.findAll({
          where: { company_id: requester.companyId, is_active: 1 },
          attributes: ['id', 'first_name', 'last_name', 'email', 'created_at'],
        }),
        this.Attendance.findAll({
          where: {
            company_id: requester.companyId,
            work_date: { [Op.between]: [range.start, range.end] },
          },
          order: [['punch_in', 'ASC']],
        }),
        this.loadApprovedLeaves(requester.companyId, range.start, range.end),
        this.loadHolidays(requester.companyId, range.start, range.end),
      ]);

      const sessionsByUser = this.groupByUser(sessions);
      const leavesByUser = this.groupByUser(leaves);

      const summary = employees.map((emp: any) => {
        const empSessions = sessionsByUser.get(Number(emp.id)) || [];
        const daysPresent = new Set(empSessions.map((s) => s.work_date)).size;
        const totalMinutes = empSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
        const result = buildAttendanceMonth(
          {
            settings,
            holidays,
            sessions: empSessions,
            leaves: leavesByUser.get(Number(emp.id)) || [],
            now,
            joinDate: emp.created_at ?? null,
          },
          month,
        );
        return {
          user_id: emp.id,
          name: displayName(emp),
          email: emp.email,
          days_present: daysPresent,
          total_minutes: totalMinutes,
          sessions: empSessions,
          days: result.days,
          stats: result.stats,
        };
      });

      return {
        success: true,
        message: 'Team attendance summary fetched',
        data: sortByName(summary),
      };
    } catch (err) {
      log.error('DB error while fetching team attendance summary', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  private groupByUser(rows: any[]): Map<number, any[]> {
    const map = new Map<number, any[]>();
    rows.forEach((r: any) => {
      const key = Number(r.user_id);
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    });
    return map;
  }
}
