import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  Post,
  Put,
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
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { AuthGuard } from '../../../middlewares/auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { ModuleGuard } from '../../../company-modules/module.guard';
import { RequireModule } from '../../../company-modules/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';

// Self-service routes (punch, today, history, calendar) resolve to the
// caller's own rows (req.user.user_id). Team routes and settings/holiday
// writes require attendance.manage. Everything is scoped to the caller's
// company (req.user.company_id).
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule('attendance')
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
        log.warn(`Punch-in rejected â€” ${response.message}`);
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
        log.warn(`Punch-out rejected â€” ${response.message}`);
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

  @Get('/settings')
  @RequirePermissions('attendance.view')
  async getSettings(@Req() req: Request, @Res() res: Response) {
    const log = this.logFor(req, 'getSettings');
    log.info('Request received');
    try {
      const response = await this.attendanceService.getSettings(this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getSettings', error);
      return errorRes(res, error);
    }
  }

  @Put('/settings')
  @RequirePermissions('attendance.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateSettings(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: UpdateAttendanceSettingsDto,
  ) {
    const log = this.logFor(req, 'updateSettings');
    log.info('Request received');
    try {
      const response = await this.attendanceService.updateSettings(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Settings update rejected: ${response.message}`);
        return failedRes(res, response.message, 400);
      }
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateSettings', error);
      return errorRes(res, error);
    }
  }

  @Get('/holidays')
  @RequirePermissions('attendance.view')
  async getHolidays(@Req() req: Request, @Res() res: Response, @Query('year') year?: string) {
    const log = this.logFor(req, 'getHolidays');
    log.info('Request received');
    try {
      const response = await this.attendanceService.getHolidays(year, this.getRequester(req));
      if (!response.success) return failedRes(res, response.message, 400);
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getHolidays', error);
      return errorRes(res, error);
    }
  }

  @Post('/holidays')
  @RequirePermissions('attendance.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createHoliday(@Req() req: Request, @Res() res: Response, @Body() body: CreateHolidayDto) {
    const log = this.logFor(req, 'createHoliday');
    log.info('Request received');
    try {
      const response = await this.attendanceService.createHoliday(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Holiday create rejected: ${response.message}`);
        return failedRes(res, response.message, 400);
      }
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in createHoliday', error);
      return errorRes(res, error);
    }
  }

  @Delete('/holidays/:id')
  @RequirePermissions('attendance.manage')
  async deleteHoliday(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const log = this.logFor(req, 'deleteHoliday');
    log.info('Request received');
    try {
      const response = await this.attendanceService.deleteHoliday(id, this.getRequester(req));
      if (!response.success) return failedRes(res, response.message, 404);
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in deleteHoliday', error);
      return errorRes(res, error);
    }
  }

  @Get('/calendar')
  @RequirePermissions('attendance.view')
  async getCalendar(@Req() req: Request, @Res() res: Response, @Query('month') month?: string) {
    const log = this.logFor(req, 'getCalendar');
    log.info('Request received');
    try {
      const response = await this.attendanceService.getCalendar(month, this.getRequester(req));
      if (!response.success) return failedRes(res, response.message, 400);
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getCalendar', error);
      return errorRes(res, error);
    }
  }

  @Get('/team/today')
  @RequirePermissions('attendance.manage')
  async getTeamToday(@Req() req: Request, @Res() res: Response) {
    const log = this.logFor(req, 'getTeamToday');
    log.info('Request received');
    try {
      const response = await this.attendanceService.getTeamToday(this.getRequester(req));
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getTeamToday', error);
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
        log.warn(`Team summary rejected â€” ${response.message}`);
        return failedRes(res, response.message);
      }
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getTeam', error);
      return errorRes(res, error);
    }
  }

  private logFor(req: Request, method: string) {
    return this.appLogger.forContext('AttendanceController', method, {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });
  }

  private getRequester(req: Request): AttendanceRequester {
    const user = (req as any).user;
    return { userId: user?.user_id, companyId: user?.company_id };
  }
}
