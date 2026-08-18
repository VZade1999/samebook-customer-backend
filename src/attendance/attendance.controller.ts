import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Post,
  Query,
  ParseIntPipe,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { AttendanceService, AttendanceRequester } from './attendance.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { PunchDto } from './dto/punch.dto';
import { AuthGuard } from './../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';

// Self-service only: every route here resolves to the caller's own
// attendance rows (req.user.user_id) — there is no team/admin view here.
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/punch-in')
  @RequirePermissions('attendance.view')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async punchIn(@Req() req: Request, @Res() res: Response, @Body() body: PunchDto) {
    const log = this.appLogger.forContext('AttendanceController', 'punchIn', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.attendanceService.punchIn(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Punch-in rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Punch-in response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in punchIn', error);
      return errorRes(res, error);
    }
  }

  @Post('/punch-out')
  @RequirePermissions('attendance.view')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async punchOut(@Req() req: Request, @Res() res: Response, @Body() body: PunchDto) {
    const log = this.appLogger.forContext('AttendanceController', 'punchOut', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.attendanceService.punchOut(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Punch-out rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Punch-out response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in punchOut', error);
      return errorRes(res, error);
    }
  }

  @Get('/today')
  @RequirePermissions('attendance.view')
  async getToday(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('AttendanceController', 'getToday', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.attendanceService.getToday(this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getToday', error);
      return errorRes(res, error);
    }
  }

  @Get('/history')
  @RequirePermissions('attendance.view')
  async getHistory(
    @Req() req: Request,
    @Res() res: Response,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const log = this.appLogger.forContext('AttendanceController', 'getHistory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.attendanceService.getHistory(page, limit, this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getHistory', error);
      return errorRes(res, error);
    }
  }

  @Get('/team')
  @RequirePermissions('attendance.manage')
  async getTeam(
    @Req() req: Request,
    @Res() res: Response,
    @Query('month') month: string,
  ) {
    const log = this.appLogger.forContext('AttendanceController', 'getTeam', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      month,
    });

    log.info('Request received');
    try {
      const response = await this.attendanceService.getTeamSummary(month, this.getRequester(req));
      if (!response.success) {
        log.warn(`Team summary rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getTeam', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): AttendanceRequester {
    const user = (req as any).user;
    return { userId: user?.user_id, companyId: user?.company_id };
  }
}
