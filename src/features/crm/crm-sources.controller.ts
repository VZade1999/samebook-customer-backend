import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import { CrmSourcesService } from './crm-sources.service';
import { requesterOf, runResult } from './crm.controller';
import { CreateSourceDto, UpdateSourceDto } from './dto/crm.dto';

const validate = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/** Lead sources (IndiaMART, website / webhook): managers set them up. */
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule('crm')
@RequirePermissions('crm.manage')
@Controller('crm/sources')
export class CrmSourcesController {
  constructor(
    private readonly sources: CrmSourcesService,
    private readonly appLogger: AppLogger,
  ) {}

  private run(res: Response, name: string, fn: () => Promise<any>) {
    return runResult(res, this.appLogger, 'CrmSourcesController', name, fn);
  }

  /** Any CRM user: opening the CRM fetches IndiaMART if it's due. */
  @Post('/auto-sync')
  @RequirePermissions('crm.view')
  autoSync(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'autoSync', () => this.sources.autoSync(requesterOf(req)));
  }

  @Get()
  list(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'list', () => this.sources.list(requesterOf(req)));
  }

  @Post()
  @UsePipes(validate)
  create(@Req() req: Request, @Res() res: Response, @Body() body: CreateSourceDto) {
    return this.run(res, 'create', () => this.sources.create(requesterOf(req), body));
  }

  @Patch('/:id')
  @UsePipes(validate)
  update(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateSourceDto) {
    return this.run(res, 'update', () => this.sources.update(requesterOf(req), id, body));
  }

  @Post('/:id/regenerate')
  regenerate(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'regenerate', () => this.sources.regenerate(requesterOf(req), id));
  }

  @Post('/:id/sync')
  sync(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'sync', () => this.sources.syncNow(requesterOf(req), id));
  }

  @Delete('/:id')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'remove', () => this.sources.remove(requesterOf(req), id));
  }
}
