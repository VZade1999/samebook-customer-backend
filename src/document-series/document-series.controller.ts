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
import { AuthGuard } from '../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AppLogger } from '../common/logger/logger.service';
import { errorRes, failedRes, successRes } from '../Util/response.util';
import { DocumentSeriesService, SeriesRequester } from './document-series.service';
import { CreateSeriesDto, PreviewSeriesDto, UpdateSeriesDto } from './document-series.dto';

const validate = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

const requesterOf = (req: Request): SeriesRequester => {
  const u = (req as any).user || {};
  return { userId: Number(u.user_id), companyId: Number(u.company_id) };
};

/**
 * Numbering series of the caller's company. Anyone signed in may list them
 * (the invoice / quotation / challan forms offer a series picker); changing
 * them needs the same permission as editing the company.
 */
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('document-series')
export class DocumentSeriesController {
  constructor(
    private readonly series: DocumentSeriesService,
    private readonly appLogger: AppLogger,
  ) {}

  private async run(res: Response, name: string, fn: () => Promise<any>) {
    try {
      const r = await fn();
      if (!r.success) {
        return r.data !== undefined
          ? res.status(r.status || 400).send({ success: false, message: r.message, data: r.data })
          : failedRes(res, r.message, r.status);
      }
      return successRes(res, r.message, r.data);
    } catch (error) {
      this.appLogger.forContext('DocumentSeriesController', name, {}).error(`${name} failed`, error);
      return errorRes(res, (error as any)?.message === 'DATABASE_ERROR' ? 'DATABASE_ERROR' : undefined);
    }
  }

  @Get()
  list(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'list', () => this.series.list(requesterOf(req)));
  }

  @Post('/preview')
  @RequirePermissions('companies.edit')
  @UsePipes(validate)
  preview(@Req() req: Request, @Res() res: Response, @Body() body: PreviewSeriesDto) {
    const { exclude_id, ...input } = body;
    return this.run(res, 'preview', () => this.series.preview(requesterOf(req), input, exclude_id));
  }

  @Post()
  @RequirePermissions('companies.edit')
  @UsePipes(validate)
  create(@Req() req: Request, @Res() res: Response, @Body() body: CreateSeriesDto) {
    return this.run(res, 'create', () => this.series.create(requesterOf(req), body));
  }

  @Patch('/:id')
  @RequirePermissions('companies.edit')
  @UsePipes(validate)
  update(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateSeriesDto) {
    return this.run(res, 'update', () => this.series.update(requesterOf(req), id, body));
  }

  @Delete('/:id')
  @RequirePermissions('companies.edit')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'remove', () => this.series.remove(requesterOf(req), id));
  }
}
