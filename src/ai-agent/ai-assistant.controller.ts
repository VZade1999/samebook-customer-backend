import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { successRes } from 'src/Util/response.util';
import { AuthGuard } from 'src/middlewares/auth.guard';
import { PermissionsGuard } from 'src/common/guards/permissions.guard';
import { RequirePermissions } from 'src/common/decorators/require-permissions.decorator';
import { ModuleGuard } from 'src/company-modules/module.guard';
import { RequireModule } from 'src/company-modules/require-module.decorator';
import { AI_MODULE, AI_PERMS } from './ai-agent.rules';
import { AiAssistantService, AiError } from './ai-assistant.service';
import { AiSettingsDto, ChatDto, DecideDto, RenameChatDto } from './dto/chat.dto';
import { UploadDocumentDto } from './dto/uploadDocument.dto';
import type { AiUser } from './tools/types';

const strict = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/**
 * The AI Assistant (an add-on on Apps & Add-ons). Everything needs
 * "View AI Assistant"; talking to it needs "Use"; settings and team usage need
 * "Configure". What it may do beyond that follows each person's own permissions.
 */
@Controller('ai-agent')
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule(AI_MODULE)
@RequirePermissions(AI_PERMS.view)
export class AiAssistantController {
  constructor(
    private readonly ai: AiAssistantService,
    private readonly appLogger: AppLogger,
  ) {}

  private user(req: Request): AiUser {
    const u: any = (req as any).user;
    if (!u?.user_id || !u?.company_id) throw new UnauthorizedException('Please sign in again');
    return { company_id: Number(u.company_id), user_id: Number(u.user_id), permissions: u.permissions || [], roles: u.roles || [], email: u.email };
  }

  private async send(res: Response, op: string, fn: () => Promise<unknown>, message = 'OK') {
    try {
      return successRes(res, message, await fn());
    } catch (err) {
      if (err instanceof AiError) return res.status(err.status).json({ success: false, message: err.message, code: err.code ?? null, data: null });
      if (err instanceof UnauthorizedException) throw err;
      this.appLogger.forContext('AiAssistantController', op).error(`${op} failed`, err);
      return res.status(500).json({ success: false, message: 'Something went wrong. Try again.', data: null });
    }
  }

  @Get('/me')
  me(@Req() req: Request, @Res() res: Response, @Query('tz') tz?: string) {
    return this.send(res, 'me', () => this.ai.me(this.user(req), tz));
  }

  @Get('/conversations')
  conversations(@Req() req: Request, @Res() res: Response) {
    return this.send(res, 'conversations', () => this.ai.conversations(this.user(req)));
  }

  @Get('/conversations/:id')
  conversation(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'conversation', () => this.ai.conversation(this.user(req), id));
  }

  @Patch('/conversations/:id')
  rename(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body(strict) body: RenameChatDto) {
    return this.send(res, 'rename', () => this.ai.rename(this.user(req), id, body.title), 'Chat renamed');
  }

  @Delete('/conversations/:id')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.send(res, 'remove', () => this.ai.remove(this.user(req), id), 'Chat deleted');
  }

  // A paid AI call plus a loop of real reads/writes: tighter than the global 100/min.
  @Post('/chat')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.use)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  chat(@Req() req: Request, @Res() res: Response, @Body(strict) body: ChatDto) {
    return this.send(res, 'chat', () => this.ai.chat(this.user(req), { message: body.message, conversation_id: body.conversation_id, tz: body.tz }));
  }

  // Reading a photo / PDF on top of the same loop, and a much bigger request.
  @Post('/chat-with-document')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.use)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  chatWithDocument(@Req() req: Request, @Res() res: Response, @Body(strict) body: UploadDocumentDto) {
    return this.send(res, 'chatWithDocument', () => this.ai.chatWithDocument(this.user(req), body));
  }

  @Post('/actions/:id/confirm')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.use)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  confirm(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body(strict) body: DecideDto) {
    return this.send(res, 'confirm', () => this.ai.decide(this.user(req), id, 'confirm', body?.tz));
  }

  @Post('/actions/:id/cancel')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.use)
  cancel(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body(strict) body: DecideDto) {
    return this.send(res, 'cancel', () => this.ai.decide(this.user(req), id, 'cancel', body?.tz));
  }

  @Get('/settings')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.configure)
  settings(@Req() req: Request, @Res() res: Response, @Query('tz') tz?: string) {
    return this.send(res, 'settings', () => this.ai.settingsView(this.user(req), tz));
  }

  @Put('/settings')
  @RequirePermissions(AI_PERMS.view, AI_PERMS.configure)
  saveSettings(@Req() req: Request, @Res() res: Response, @Body(strict) body: AiSettingsDto) {
    return this.send(res, 'saveSettings', () => this.ai.saveSettings(this.user(req), body), 'Settings saved');
  }
}
