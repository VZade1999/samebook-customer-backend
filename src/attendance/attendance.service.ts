import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { PunchDto } from './dto/punch.dto';

// Punch in/out/today/history are self-service — they resolve to the
// caller's own rows (req.user.user_id, set by AuthGuard from the JWT).
// getTeamSummary is the one exception: it is company-wide and only reachable
// via the `attendance.manage` permission (ADMIN/SUPER_ADMIN), gated in the
// controller.
export interface AttendanceRequester {
  userId: number;
  companyId: number;
}

const toWorkDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

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

  async punchIn(data: PunchDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'punchIn', {
      userId: requester.userId,
    });

    const now = new Date();
    const today = toWorkDate(now);

    const openSession = await this.Attendance.findOne({
      where: { user_id: requester.userId, punch_out: null },
    });

    if (openSession) {
      if (openSession.work_date === today) {
        log.warn('Punch-in rejected — already punched in');
        return { success: false, message: 'You are already punched in' };
      }

      // Left open from a previous day (forgot to punch out) — auto-close it
      // at end-of-day for that date so it stops blocking today's punch-in.
      try {
        const endOfStaleDay = new Date(`${openSession.work_date}T23:59:59`);
        const staleMinutes = Math.max(
          0,
          Math.round(
            (endOfStaleDay.getTime() - new Date(openSession.punch_in).getTime()) / 60000,
          ),
        );
        await openSession.update({
          punch_out: endOfStaleDay,
          total_minutes: staleMinutes,
          notes: [openSession.notes, 'Auto punched-out — missed check-out']
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
    // for today exists at this point (it can't be an open one — that case
    // is handled above — so it must already be punched out).
    const existingToday = await this.Attendance.findOne({
      where: { user_id: requester.userId, work_date: today },
    });
    if (existingToday) {
      log.warn('Punch-in rejected — attendance already completed today');
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

    // Scoped to today only — a stale prior-day open session is only ever
    // closed automatically via the next punch-in (see punchIn above), never
    // by a punch-out call, so this never has to reason about which day's
    // session it's closing.
    const openSession = await this.Attendance.findOne({
      where: {
        user_id: requester.userId,
        punch_out: null,
        work_date: toWorkDate(new Date()),
      },
    });

    if (!openSession) {
      log.warn('Punch-out rejected — no open session for today');
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

    try {
      const record = await this.Attendance.findOne({
        where: { user_id: requester.userId, work_date: toWorkDate(new Date()) },
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

  // Admin-only: every employee's attendance for the caller's company for a
  // given calendar month, grouped into a per-employee summary. One query for
  // the whole company rather than one per employee.
  async getTeamSummary(month: string, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'getTeamSummary', {
      companyId: requester.companyId,
      month,
    });

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { success: false, message: 'month must be in YYYY-MM format' };
    }

    const [year, mon] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const endDate = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`;

    try {
      const employees = await this.Users.findAll({
        where: { company_id: requester.companyId, is_active: 1 },
        attributes: ['id', 'first_name', 'last_name', 'email'],
      });

      const sessions = await this.Attendance.findAll({
        where: {
          company_id: requester.companyId,
          work_date: { [Op.between]: [startDate, endDate] },
        },
        order: [['punch_in', 'ASC']],
      });

      const sessionsByUser = new Map<number, any[]>();
      sessions.forEach((s: any) => {
        const list = sessionsByUser.get(s.user_id) || [];
        list.push(s);
        sessionsByUser.set(s.user_id, list);
      });

      const summary = employees.map((emp: any) => {
        const empSessions = sessionsByUser.get(emp.id) || [];
        const daysPresent = new Set(empSessions.map((s) => s.work_date)).size;
        const totalMinutes = empSessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
        return {
          user_id: emp.id,
          name: [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.email,
          email: emp.email,
          days_present: daysPresent,
          total_minutes: totalMinutes,
          sessions: empSessions,
        };
      });

      return { success: true, message: 'Team attendance summary fetched', data: summary };
    } catch (err) {
      log.error('DB error while fetching team attendance summary', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
