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
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { CommentDto, CreateTaskDto, FollowUpDto, UpdateTaskDto } from './dto/task.dto';
import { TasksRequester, TasksService } from './tasks.service';

const validate = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

// Add-on gate first (403 MODULE_NOT_ENABLED), then permissions. Fine-grained
// rules (own/assigned vs manager, epics = managers) live in the service.
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule('tasks')
@RequirePermissions('tasks.view')
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly appLogger: AppLogger,
  ) {}

  private requester(req: Request): TasksRequester {
    const u = (req as any).user || {};
    return { userId: u.user_id, companyId: u.company_id, permissions: u.permissions || [] };
  }

  private async run(res: Response, name: string, fn: () => Promise<any>) {
    try {
      const r = await fn();
      if (!r.success) return failedRes(res, r.message, r.status);
      return successRes(res, r.message, r.data);
    } catch (error) {
      this.appLogger.forContext('TasksController', name, {}).error(`${name} failed`, error);
      return errorRes(res, error);
    }
  }

  // Static routes first — they must not be captured by '/:id'.
  @Get('/meta')
  meta(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'meta', () => this.tasks.meta(this.requester(req)));
  }

  @Get('/summary')
  summary(@Req() req: Request, @Res() res: Response, @Query('today') today?: string) {
    return this.run(res, 'summary', () => this.tasks.summary(this.requester(req), today));
  }

  @Get('/epics')
  epics(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'epics', () => this.tasks.epics(this.requester(req), q));
  }

  @Get('/calendar')
  calendar(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'calendar', () => this.tasks.calendar(this.requester(req), q));
  }

  @Get('/overview')
  @RequirePermissions('tasks.manage')
  overview(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'overview', () => this.tasks.overview(this.requester(req), q));
  }

  @Get('/link-search')
  linkSearch(@Req() req: Request, @Res() res: Response, @Query('type') type: string, @Query('q') q: string) {
    return this.run(res, 'linkSearch', () => this.tasks.linkSearch(this.requester(req), type, q));
  }

  @Get()
  list(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'list', () => this.tasks.list(this.requester(req), q));
  }

  @Post()
  @RequirePermissions('tasks.create')
  @UsePipes(validate)
  create(@Req() req: Request, @Res() res: Response, @Body() body: CreateTaskDto) {
    return this.run(res, 'create', () => this.tasks.create(this.requester(req), body));
  }

  @Get('/:id')
  getOne(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('today') today?: string) {
    return this.run(res, 'getOne', () => this.tasks.getOne(this.requester(req), id, today));
  }

  @Get('/:id/tree')
  tree(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Query('today') today?: string) {
    return this.run(res, 'tree', () => this.tasks.tree(this.requester(req), id, today));
  }

  @Patch('/:id')
  @UsePipes(validate)
  update(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateTaskDto) {
    return this.run(res, 'update', () => this.tasks.update(this.requester(req), id, body));
  }

  @Delete('/:id')
  remove(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'remove', () => this.tasks.remove(this.requester(req), id));
  }

  @Post('/:id/comments')
  @UsePipes(validate)
  comment(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: CommentDto) {
    return this.run(res, 'comment', () => this.tasks.comment(this.requester(req), id, body));
  }

  @Post('/:id/follow-up')
  @UsePipes(validate)
  followUp(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: FollowUpDto) {
    return this.run(res, 'followUp', () => this.tasks.followUp(this.requester(req), id, body));
  }
}
