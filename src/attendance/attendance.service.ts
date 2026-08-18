import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { PunchDto } from './dto/punch.dto';

// Self-service only: every method here resolves to the caller's own
// attendance rows (req.user.user_id, set by AuthGuard from the JWT) — there
// is no team/admin attendance view in this pass.
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

  async punchIn(data: PunchDto, requester: AttendanceRequester) {
    const log = this.appLogger.forContext('AttendanceService', 'punchIn', {
      userId: requester.userId,
    });

    const openSession = await this.Attendance.findOne({
      where: { user_id: requester.userId, punch_out: null },
    });

    if (openSession) {
      log.warn('Punch-in rejected — already punched in');
      return { success: false, message: 'You are already punched in' };
    }

    const now = new Date();
    try {
      const record = await this.Attendance.create({
        user_id: requester.userId,
        company_id: requester.companyId,
        punch_in: now,
        work_date: toWorkDate(now),
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

    const openSession = await this.Attendance.findOne({
      where: { user_id: requester.userId, punch_out: null },
    });

    if (!openSession) {
      log.warn('Punch-out rejected — no open session');
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
}
