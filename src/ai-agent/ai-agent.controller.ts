import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { AiAgentService } from './ai-agent.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { ChatDto } from './dto/chat.dto';
import { UploadDocumentDto } from './dto/uploadDocument.dto';
import { AuthGuard } from 'src/middlewares/auth.guard';

@Controller('ai-agent')
@UseGuards(AuthGuard)
export class AiAgentController {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly appLogger: AppLogger,
  ) {}

  @Post('/chat')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  // The global default (100 req/min/IP, app.module.ts) is far too generous
  // for an endpoint that triggers a paid LLM call plus a tool-loop of real
  // DB writes on every request — bounded tighter here specifically.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(@Req() req: Request, @Res() res: Response, @Body() body: ChatDto) {
    const log = this.appLogger.forContext('AiAgentController', 'chat', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    const currentUser = req['user'];
    if (!currentUser) {
      log.warn('Unauthorized request');
      throw new UnauthorizedException('User authentication required');
    }

    try {
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

  @Post('/chat-with-document')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  // Stricter than /chat — OCR/PDF-parsing plus the same tool-loop cost, on
  // top of a much larger request body.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async chatWithDocument(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: UploadDocumentDto,
  ) {
    const log = this.appLogger.forContext('AiAgentController', 'chatWithDocument', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    const currentUser = req['user'];
    if (!currentUser) {
      log.warn('Unauthorized request');
      throw new UnauthorizedException('User authentication required');
    }

    try {
      const response = await this.aiAgentService.chatWithDocument(body, currentUser);

      if (!response.success) {
        log.warn(`AI Agent document chat rejected — ${response.message}`);
        return failedRes(res, response.message);
      }

      log.info('AI Agent document chat response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error: unknown) {
      log.error('Unhandled error in AI Agent document chat', error);
      return errorRes(res, error);
    }
  }

  @Get('/history')
  async getHistory(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('AiAgentController', 'getHistory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    const currentUser = req['user'];
    if (!currentUser) {
      throw new UnauthorizedException('User authentication required');
    }

    try {
      const history = await this.aiAgentService.getRecentHistory(currentUser);
      return successRes(res, 'Chat history fetched successfully', history);
    } catch (error: unknown) {
      log.error('Unhandled error fetching AI Agent history', error);
      return errorRes(res, error);
    }
  }

  @Delete('/history')
  async clearHistory(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('AiAgentController', 'clearHistory', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    const currentUser = req['user'];
    if (!currentUser) {
      throw new UnauthorizedException('User authentication required');
    }

    try {
      const response = await this.aiAgentService.clearHistory(currentUser);
      return successRes(res, response.message, response.data);
    } catch (error: unknown) {
      log.error('Unhandled error clearing AI Agent history', error);
      return errorRes(res, error);
    }
  }
}
