import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { CreateLeaveDto } from './dto/createLeave.dto';
import { ReviewLeaveDto } from './dto/reviewLeave.dto';

export interface LeaveRequester {
  userId: number;
  companyId: number;
}

const MIN_WORDS = 4;

@Injectable()
export class LeaveService {
  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {}

  private get LeaveRequests() {
    return this.dbProvider.db.leave_requests;
  }

  private get Users() {
    return this.dbProvider.db.users;
  }

  async requestLeave(data: CreateLeaveDto, requester: LeaveRequester) {
    const log = this.appLogger.forContext('LeaveService', 'requestLeave', {
      userId: requester.userId,
    });

    const wordCount = data.reason.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS) {
      log.warn('Leave request rejected — reason too short');
      return { success: false, message: `Reason must be at least ${MIN_WORDS} words` };
    }

    if (new Date(data.to_date) < new Date(data.from_date)) {
      log.warn('Leave request rejected — invalid date range');
      return { success: false, message: '"To" date cannot be before "From" date' };
    }

    const leaveType = data.leave_type ?? 'FULL_DAY';
    if (leaveType === 'HALF_DAY' && data.from_date !== data.to_date) {
      log.warn('Leave request rejected — half-day leave must be a single date');
      return { success: false, message: 'Half-day leave must have the same "From" and "To" date' };
    }

    try {
      const record = await this.LeaveRequests.create({
        user_id: requester.userId,
        company_id: requester.companyId,
        from_date: data.from_date,
        to_date: data.to_date,
        leave_type: leaveType,
        half_day_period: leaveType === 'HALF_DAY' ? data.half_day_period : null,
        reason: data.reason.trim(),
        status: 'pending',
      });
      log.info('Leave requested successfully');
      return { success: true, message: 'Leave requested successfully', data: record };
    } catch (err) {
      log.error('DB error while requesting leave', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async getMyLeaves(requester: LeaveRequester) {
    const log = this.appLogger.forContext('LeaveService', 'getMyLeaves', {
      userId: requester.userId,
    });

    try {
      const rows = await this.LeaveRequests.findAll({
        where: { user_id: requester.userId },
        order: [['created_at', 'DESC']],
      });
      return { success: true, message: 'Leave requests fetched', data: rows };
    } catch (err) {
      log.error('DB error while fetching leave requests', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async getTeamLeaves(status: string | undefined, requester: LeaveRequester) {
    const log = this.appLogger.forContext('LeaveService', 'getTeamLeaves', {
      companyId: requester.companyId,
    });

    try {
      const rows = await this.LeaveRequests.findAll({
        where: {
          company_id: requester.companyId,
          ...(status && { status }),
        },
        include: [
          { model: this.Users, as: 'user', attributes: ['id', 'first_name', 'last_name', 'email'] },
          { model: this.Users, as: 'reviewer', attributes: ['id', 'first_name', 'last_name'], required: false },
        ],
        order: [['created_at', 'DESC']],
      });
      return { success: true, message: 'Team leave requests fetched', data: rows };
    } catch (err) {
      log.error('DB error while fetching team leave requests', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  private async findCompanyLeave(id: number, requester: LeaveRequester) {
    return this.LeaveRequests.findOne({
      where: { id, company_id: requester.companyId },
    });
  }

  async approveLeave(id: number, requester: LeaveRequester) {
    const log = this.appLogger.forContext('LeaveService', 'approveLeave', {
      companyId: requester.companyId,
      leaveId: id,
    });

    const record = await this.findCompanyLeave(id, requester);
    if (!record) {
      return { success: false, message: `Leave request with id ${id} not found` };
    }
    if (record.status !== 'pending') {
      return { success: false, message: `Leave request is already ${record.status}` };
    }

    try {
      await record.update({
        status: 'approved',
        reviewed_by: requester.userId,
        reviewed_at: new Date(),
      });
      log.info('Leave approved successfully');
      return { success: true, message: 'Leave approved', data: record };
    } catch (err) {
      log.error('DB error while approving leave', err);
      throw new Error('DATABASE_ERROR');
    }
  }

  async rejectLeave(id: number, data: ReviewLeaveDto, requester: LeaveRequester) {
    const log = this.appLogger.forContext('LeaveService', 'rejectLeave', {
      companyId: requester.companyId,
      leaveId: id,
    });

    const record = await this.findCompanyLeave(id, requester);
    if (!record) {
      return { success: false, message: `Leave request with id ${id} not found` };
    }
    if (record.status !== 'pending') {
      return { success: false, message: `Leave request is already ${record.status}` };
    }

    try {
      await record.update({
        status: 'rejected',
        reviewed_by: requester.userId,
        reviewed_at: new Date(),
        ...(data.review_note !== undefined && { review_note: data.review_note }),
      });
      log.info('Leave rejected successfully');
      return { success: true, message: 'Leave rejected', data: record };
    } catch (err) {
      log.error('DB error while rejecting leave', err);
      throw new Error('DATABASE_ERROR');
    }
  }
}
