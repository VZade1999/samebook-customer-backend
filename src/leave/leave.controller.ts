import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { LeaveService, LeaveRequester } from './leave.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CreateLeaveDto } from './dto/createLeave.dto';
import { ReviewLeaveDto } from './dto/reviewLeave.dto';
import { AuthGuard } from './../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly leaveService: LeaveService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/request')
  @RequirePermissions('attendance.view')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async requestLeave(@Req() req: Request, @Res() res: Response, @Body() body: CreateLeaveDto) {
    const log = this.appLogger.forContext('LeaveController', 'requestLeave', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.leaveService.requestLeave(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Leave request rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Leave requested successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in requestLeave', error);
      return errorRes(res, error);
    }
  }

  @Get('/my')
  @RequirePermissions('attendance.view')
  async getMyLeaves(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('LeaveController', 'getMyLeaves', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.leaveService.getMyLeaves(this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getMyLeaves', error);
      return errorRes(res, error);
    }
  }

  @Get('/team')
  @RequirePermissions('attendance.manage')
  async getTeamLeaves(
    @Req() req: Request,
    @Res() res: Response,
    @Query('status') status?: string,
  ) {
    const log = this.appLogger.forContext('LeaveController', 'getTeamLeaves', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.leaveService.getTeamLeaves(status, this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getTeamLeaves', error);
      return errorRes(res, error);
    }
  }

  @Post('/:id/approve')
  @RequirePermissions('attendance.manage')
  async approveLeave(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.appLogger.forContext('LeaveController', 'approveLeave', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      leaveId: id,
    });

    log.info('Request received');
    try {
      const response = await this.leaveService.approveLeave(id, this.getRequester(req));
      if (!response.success) {
        log.warn(`Leave approve rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Leave approved successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in approveLeave', error);
      return errorRes(res, error);
    }
  }

  @Post('/:id/reject')
  @RequirePermissions('attendance.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async rejectLeave(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReviewLeaveDto,
  ) {
    const log = this.appLogger.forContext('LeaveController', 'rejectLeave', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      leaveId: id,
    });

    log.info('Request received');
    try {
      const response = await this.leaveService.rejectLeave(id, body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Leave reject rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Leave rejected successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in rejectLeave', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): LeaveRequester {
    const user = (req as any).user;
    return { userId: user?.user_id, companyId: user?.company_id };
  }
}
