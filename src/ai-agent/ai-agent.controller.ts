import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { AiAgentService } from './ai-agent.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { ChatDto } from './dto/chat.dto';
import { AuthGuard } from 'src/middlewares/auth.guard';

@Controller('ai-agent')
@UseGuards(AuthGuard)
export class AiAgentController {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/chat')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async chat(@Req() req: Request, @Res() res: Response, @Body() body: ChatDto) {
    const log = this.appLogger.forContext('AiAgentController', 'chat', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    try {
      const currentUser = req['user'];
      if (!currentUser) {
        log.warn('Unauthorized request');
        throw new Error('User authentication required');
      }

      const response = await this.aiAgentService.chat(body, currentUser);

      if (!response.success) {
        log.warn(`AI Agent chat rejected — ${response.message}`);
        return failedRes(res, response.message);
      }

      log.info('AI Agent chat response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error: unknown) {
      log.error('Unhandled error in AI Agent chat', error);
      return errorRes(res, error);
    }
  }
  
}
