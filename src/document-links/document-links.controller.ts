import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { AppLogger } from '../common/logger/logger.service';
import { AuthGuard } from '../middlewares/auth.guard';
import { failedRes, successRes } from '../Util/response.util';
import { DocumentLinksService, LinksRequester, LinksResult } from './document-links.service';

// Linked documents (quotation → challans → invoice → payments) and the
// find-any-number search. Which document types a person may see is checked
// per request in the service, from their permissions.
@UseGuards(AuthGuard)
@Controller('document-links')
export class DocumentLinksController {
  constructor(
    private readonly links: DocumentLinksService,
    private readonly appLogger: AppLogger,
  ) {}

  private requester(req: Request): LinksRequester {
    const user = (req as any).user;
    return {
      companyId: Number(user?.company_id),
      permissions: Array.isArray(user?.permissions) ? user.permissions : [],
    };
  }

  private async handle(req: Request, res: Response, operation: string, fn: () => Promise<LinksResult>) {
    const log = this.appLogger.forContext('DocumentLinksController', operation, {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });
    try {
      const result = await fn();
      if (!result.success) return failedRes(res, result.message, result.statusCode ?? 400);
      return successRes(res, result.message, result.data);
    } catch (error) {
      log.error(`Unhandled error in ${operation}`, error);
      return failedRes(res, 'Something went wrong', 500);
    }
  }

  // GET /document-links/trail?type=quotation|challan|invoice&id=12
  @Get('/trail')
  async trail(@Req() req: Request, @Res() res: Response, @Query('type') type: string, @Query('id') id: string) {
    return this.handle(req, res, 'trail', () => this.links.trail(type, id, this.requester(req)));
  }

  // GET /document-links/search?q=4500123
  @Get('/search')
  async search(@Req() req: Request, @Res() res: Response, @Query('q') q: string) {
    return this.handle(req, res, 'search', () => this.links.search(q, this.requester(req)));
  }
}
