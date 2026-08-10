import { Body, Controller, Post, Req, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CallbackService } from './callback.service';
import { CallbackRequestDto } from './dto/callback-request.dto';
import { AppLogger } from '../common/logger/logger.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';

@Controller('callback')
export class CallbackController {
  constructor(
    private readonly callbackService: CallbackService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/request')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @UsePipes(ValidationPipe)
  async request(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: CallbackRequestDto,
  ) {
    const log = this.appLogger.forContext('CallbackController', 'request', {
      name: body.name,
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.callbackService.submit(body);
      if (!response.success) {
        log.warn(`Callback request rejected — ${response.message}`);
        return failedRes(res, response.message, 400);
      }
      log.info('Callback request saved successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in callback request', error);
      return errorRes(res, error);
    }
  }
}
