import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { AppLogger } from '../common/logger/logger.service';
import { AuthGuard } from '../middlewares/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { failedRes, successRes } from '../Util/response.util';
import {
  ChallanRequester,
  ChallanServiceResult,
  DeliveryChallanService,
} from './delivery-challan.service';
import {
  CancelChallanDto,
  ChallanListDto,
  ConvertChallanDto,
  CreateChallanDto,
  UpdateChallanDto,
} from './dto/challan.dto';

const bodyPipe = new ValidationPipe({ transform: true, whitelist: true });

// Tenant and actor identity always come from req.user (set by AuthGuard from
// the JWT), never from the request body or query.
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('delivery-challan')
export class DeliveryChallanController {
  constructor(
    private readonly challanService: DeliveryChallanService,
    private readonly appLogger: AppLogger,
  ) {}

  private requester(req: Request): ChallanRequester {
    const user = (req as any).user;
    return { companyId: Number(user?.company_id), userId: Number(user?.user_id) };
  }

  private async handle(
    req: Request,
    res: Response,
    operation: string,
    fn: () => Promise<ChallanServiceResult>,
  ) {
    const log = this.appLogger.forContext('DeliveryChallanController', operation, {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });
    try {
      const result = await fn();
      if (!result.success) {
        return failedRes(res, result.message, result.statusCode ?? 400);
      }
      return successRes(res, result.message, result.data);
    } catch (error) {
      log.error(`Unhandled error in ${operation}`, error);
      return failedRes(res, 'Something went wrong', 500);
    }
  }

  @Get('/list')
  @RequirePermissions('challans.view')
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query(bodyPipe) query: ChallanListDto,
  ) {
    return this.handle(req, res, 'list', () =>
      this.challanService.listChallans(query, this.requester(req)),
    );
  }

  @Get('/quotation/:quotationId/remaining')
  @RequirePermissions('challans.view')
  async quotationRemaining(
    @Req() req: Request,
    @Res() res: Response,
    @Param('quotationId', ParseIntPipe) quotationId: number,
  ) {
    return this.handle(req, res, 'quotationRemaining', () =>
      this.challanService.getQuotationRemaining(quotationId, this.requester(req)),
    );
  }

  @Post('/create')
  @RequirePermissions('challans.create')
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body(bodyPipe) body: CreateChallanDto,
  ) {
    return this.handle(req, res, 'create', () =>
      this.challanService.createChallan(body, this.requester(req)),
    );
  }

  @Get('/:id')
  @RequirePermissions('challans.view')
  async details(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.handle(req, res, 'details', () =>
      this.challanService.getChallanDetails(id, this.requester(req)),
    );
  }

  @Get('/:id/activity')
  @RequirePermissions('challans.view')
  async activity(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.handle(req, res, 'activity', () =>
      this.challanService.getChallanActivity(id, this.requester(req)),
    );
  }

  @Put('/:id')
  @RequirePermissions('challans.edit')
  async update(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body(bodyPipe) body: UpdateChallanDto,
  ) {
    return this.handle(req, res, 'update', () =>
      this.challanService.updateChallan(id, body, this.requester(req)),
    );
  }

  @Post('/:id/dispatch')
  @RequirePermissions('challans.dispatch')
  async dispatch(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.handle(req, res, 'dispatch', () =>
      this.challanService.dispatchChallan(id, this.requester(req)),
    );
  }

  @Post('/:id/deliver')
  @RequirePermissions('challans.dispatch')
  async deliver(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.handle(req, res, 'deliver', () =>
      this.challanService.deliverChallan(id, this.requester(req)),
    );
  }

  @Post('/:id/cancel')
  @RequirePermissions('challans.dispatch')
  async cancel(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body(bodyPipe) body: CancelChallanDto,
  ) {
    return this.handle(req, res, 'cancel', () =>
      this.challanService.cancelChallan(id, body?.reason, this.requester(req)),
    );
  }

  @Post('/:id/convert-to-invoice')
  @RequirePermissions('challans.convert')
  async convert(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body(bodyPipe) body: ConvertChallanDto,
  ) {
    return this.handle(req, res, 'convert', () =>
      this.challanService.convertToInvoice(
        id,
        body.payment_due_date,
        this.requester(req),
        body.series_id,
      ),
    );
  }

  @Delete('/:id')
  @RequirePermissions('challans.delete')
  async remove(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.handle(req, res, 'delete', () =>
      this.challanService.deleteChallan(id, this.requester(req)),
    );
  }
}
