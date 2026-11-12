import { Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../middlewares/auth.guard';
import { AppLogger } from '../common/logger/logger.service';
import { errorRes, successRes } from 'src/Util/response.util';
import { NotificationsService } from './notifications.service';

// Every logged-in user reads only their own notifications (user_id + company_id
// from the token), so no extra permission is needed.
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query('unread_only') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const u = (req as any).user;
    try {
      const data = await this.notifications.list(u.user_id, u.company_id, {
        unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
        limit: Number(limit) || 20,
      });
      return successRes(res, 'Notifications fetched', data);
    } catch (error) {
      this.appLogger.forContext('NotificationsController', 'list', {}).error('list failed', error);
      return errorRes(res, error);
    }
  }

  @Get('/unread-count')
  async unreadCount(@Req() req: Request, @Res() res: Response) {
    const u = (req as any).user;
    try {
      const unread = await this.notifications.unreadCount(u.user_id, u.company_id);
      return successRes(res, 'Unread count fetched', { unread });
    } catch (error) {
      return errorRes(res, error);
    }
  }

  @Post('/read-all')
  async readAll(@Req() req: Request, @Res() res: Response) {
    const u = (req as any).user;
    try {
      const updated = await this.notifications.markAllRead(u.user_id, u.company_id);
      return successRes(res, 'All notifications marked as read', { updated });
    } catch (error) {
      return errorRes(res, error);
    }
  }

  @Post('/:id/read')
  async read(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const u = (req as any).user;
    try {
      const updated = await this.notifications.markRead(u.user_id, u.company_id, id);
      return successRes(res, 'Notification marked as read', { updated });
    } catch (error) {
      return errorRes(res, error);
    }
  }
}
