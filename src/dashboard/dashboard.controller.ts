import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AppLogger } from '../common/logger/logger.service';
import { errorRes, failedRes, successRes } from '../Util/response.util';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('dashboard.view')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly appLogger: AppLogger,
  ) {}

  /**
   * GET /dashboard/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&today=YYYY-MM-DD&tz=330
   * `tz` is the viewer's offset in minutes east of UTC (for "today" and hours).
   */
  @Get('/overview')
  async overview(@Req() req: Request, @Res() res: Response, @Query() q: Record<string, string>) {
    const u = (req as any).user || {};
    try {
      const r = await this.dashboard.overview(
        { userId: u.user_id, companyId: u.company_id, permissions: u.permissions || [] },
        q,
      );
      if (!r.success) return failedRes(res, r.message, (r as any).status || 400);
      res.setHeader('Cache-Control', 'private, no-store');
      return successRes(res, r.message, r.data);
    } catch (error) {
      this.appLogger.forContext('DashboardController', 'overview', {}).error('overview failed', error);
      return errorRes(res, error);
    }
  }
}
