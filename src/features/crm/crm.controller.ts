import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../../middlewares/auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModuleGuard } from '../../company-modules/module.guard';
import { RequireModule } from '../../company-modules/require-module.decorator';
import { AppLogger } from '../../common/logger/logger.service';
import { errorRes, failedRes, successRes } from '../../Util/response.util';
import { CrmService } from './crm.service';
import { CrmRequester } from './crm.shared';
import {
  AssignDto,
  ConvertLeadDto,
  CreateLeadDto,
  FollowUpDto,
  ImportLeadsDto,
  LogActivityDto,
  StageDto,
  UpdateLeadDto,
} from './dto/crm.dto';

const validate = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

export const requesterOf = (req: Request): CrmRequester => {
  const u = (req as any).user || {};
  return { userId: Number(u.user_id), companyId: Number(u.company_id), permissions: u.permissions || [] };
};

export const runResult = async (res: Response, logger: AppLogger, ctx: string, name: string, fn: () => Promise<any>) => {
  try {
    const r = await fn();
    if (!r.success) {
      return r.data !== undefined
        ? res.status(r.status || 400).send({ success: false, message: r.message, data: r.data })
        : failedRes(res, r.message, r.status);
    }
    return successRes(res, r.message, r.data);
  } catch (error) {
    logger.forContext(ctx, name, {}).error(`${name} failed`, error);
    return errorRes(res, (error as any)?.message === 'DATABASE_ERROR' ? 'DATABASE_ERROR' : undefined);
  }
};

// Add-on gate first (403 MODULE_NOT_ENABLED), then permissions. Who may see
// or change each lead (own / unassigned / manager) is decided in the service.
// Not cached server-side: leads change constantly and must never be stale.
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule('crm')
@RequirePermissions('crm.view')
@Controller('crm')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly appLogger: AppLogger,
  ) {}

  private run(res: Response, name: string, fn: () => Promise<any>) {
    return runResult(res, this.appLogger, 'CrmController', name, fn);
  }

  @Get('/meta')
  meta(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'meta', () => this.crm.meta(requesterOf(req)));
  }

  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response, @Query('tz') tz?: string) {
    return this.run(res, 'summary', () => this.crm.summary(requesterOf(req), tz));
  }

  @Get('/overview')
  overview(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'overview', () => this.crm.overview(requesterOf(req), q));
  }

  @Get('/pipeline')
  pipeline(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'pipeline', () => this.crm.pipeline(requesterOf(req), q));
  }

  // Static lead routes first — they must not be captured by '/leads/:id'.
  @Get('/leads/duplicates')
  duplicates(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'duplicates', () => this.crm.duplicates(requesterOf(req), q));
  }

  @Post('/leads/import')
  @RequirePermissions('crm.create')
  @UsePipes(validate)
  importRows(@Req() req: Request, @Res() res: Response, @Body() body: ImportLeadsDto) {
    return this.run(res, 'import', () => this.crm.importRows(requesterOf(req), body));
  }

  @Get('/leads')
  list(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'list', () => this.crm.list(requesterOf(req), q));
  }

  @Post('/leads')
  @RequirePermissions('crm.create')
  @UsePipes(validate)
  create(@Req() req: Request, @Res() res: Response, @Body() body: CreateLeadDto, @Query('tz') tz?: string) {
    return this.run(res, 'create', () => this.crm.create(requesterOf(req), body, tz));
  }

  @Get('/leads/:id')
  getOne(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('tz') tz?: string) {
    return this.run(res, 'getOne', () => this.crm.getOne(requesterOf(req), id, tz));
  }

  @Patch('/leads/:id')
  @UsePipes(validate)
  update(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateLeadDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'update', () => this.crm.update(requesterOf(req), id, body, tz));
  }

  @Delete('/leads/:id')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'remove', () => this.crm.remove(requesterOf(req), id));
  }

  @Post('/leads/:id/stage')
  @UsePipes(validate)
  stage(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StageDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'stage', () => this.crm.setStage(requesterOf(req), id, body, tz));
  }

  @Post('/leads/:id/assign')
  @UsePipes(validate)
  assign(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AssignDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'assign', () => this.crm.assign(requesterOf(req), id, body, tz));
  }

  @Post('/leads/:id/claim')
  claim(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('tz') tz?: string) {
    return this.run(res, 'claim', () => this.crm.claim(requesterOf(req), id, tz));
  }

  @Post('/leads/:id/follow-up')
  @UsePipes(validate)
  followUp(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: FollowUpDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'followUp', () => this.crm.setFollowUp(requesterOf(req), id, body, tz));
  }

  @Post('/leads/:id/activities')
  @UsePipes(validate)
  activity(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LogActivityDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'activity', () => this.crm.logActivity(requesterOf(req), id, body, tz));
  }

  @Get('/leads/:id/customer-matches')
  matches(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'matches', () => this.crm.customerMatches(requesterOf(req), id));
  }

  @Post('/leads/:id/convert')
  @UsePipes(validate)
  convert(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ConvertLeadDto,
    @Query('tz') tz?: string,
  ) {
    return this.run(res, 'convert', () => this.crm.convert(requesterOf(req), id, body, tz));
  }

  @Post('/leads/:id/sync')
  sync(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('tz') tz?: string) {
    return this.run(res, 'sync', () => this.crm.syncDeals(requesterOf(req), id, tz));
  }

  @Get('/leads/:id/enquiries/:enquiryId/raw')
  raw(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Param('enquiryId', ParseIntPipe) enquiryId: number,
  ) {
    return this.run(res, 'raw', () => this.crm.enquiryRaw(requesterOf(req), id, enquiryId));
  }
}
