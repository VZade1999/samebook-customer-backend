import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { diskStorage } from 'multer';
import { AuthGuard } from '../../middlewares/auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModuleGuard } from '../../company-modules/module.guard';
import { RequireModule } from '../../company-modules/require-module.decorator';
import { AppLogger } from '../../common/logger/logger.service';
import { errorRes } from 'src/Util/response.util';
import { CreateFolderDto, RestoreVersionDto, UpdateFileDto, UpdateFolderDto } from './dto/drive.dto';
import { DriveRequester, DriveService, MAX_UPLOAD_MB, UploadedDriveFile } from './drive.service';
import { driveStorage } from './drive.storage';

const validate = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/**
 * Uploads stream straight to a temp file on disk (never buffered in memory),
 * then DriveService hashes and moves them into permanent storage. The
 * destination is resolved per request so DRIVE_STORAGE_DIR from .env.local
 * applies even though decorators are evaluated at import time.
 */
const uploadInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      driveStorage
        .ensureDirs()
        .then(() => cb(null, driveStorage.tmpDir))
        .catch((e) => cb(e, driveStorage.tmpDir));
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
});

/** RFC 6266 / 5987 Content-Disposition that survives non-ASCII names. */
const disposition = (type: 'inline' | 'attachment', filename: string) => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

// Add-on gate first (403 MODULE_NOT_ENABLED), then permissions. There is no
// DELETE route on purpose: Drive keeps every file and every version.
@UseGuards(AuthGuard, ModuleGuard, PermissionsGuard)
@RequireModule('drive')
@RequirePermissions('drive.view')
@Controller('drive')
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly appLogger: AppLogger,
  ) {}

  private requester(req: Request): DriveRequester {
    const u = (req as any).user || {};
    return { userId: u.user_id, companyId: u.company_id, permissions: u.permissions || [] };
  }

  private async run(res: Response, name: string, fn: () => Promise<any>) {
    try {
      const r = await fn();
      if (!r.success) {
        return res.status(r.status || 400).send({ success: false, message: r.message, ...(r.extra || {}) });
      }
      return res.status(200).send({ success: true, message: r.message, data: r.data ?? null });
    } catch (error) {
      this.appLogger.forContext('DriveController', name, {}).error(`${name} failed`, error);
      return errorRes(res, error);
    }
  }

  @Get('/meta')
  meta(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'meta', () => this.drive.meta(this.requester(req)));
  }

  @Get('/folders')
  folders(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'folders', () => this.drive.folderTree(this.requester(req)));
  }

  @Get('/browse')
  browse(@Req() req: Request, @Res() res: Response, @Query('folder_id') folderId?: string) {
    return this.run(res, 'browse', () => this.drive.browse(this.requester(req), folderId));
  }

  @Get('/search')
  search(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'search', () => this.drive.search(this.requester(req), q));
  }

  @Get('/recent')
  recent(@Req() req: Request, @Res() res: Response, @Query('scope') scope?: string) {
    return this.run(res, 'recent', () => this.drive.recent(this.requester(req), scope));
  }

  @Get('/tags')
  tags(@Req() req: Request, @Res() res: Response) {
    return this.run(res, 'tags', () => this.drive.tags(this.requester(req)));
  }

  @Get('/activity')
  activity(@Req() req: Request, @Res() res: Response, @Query() q: any) {
    return this.run(res, 'activity', () => this.drive.activity(this.requester(req), q));
  }

  @Post('/folders')
  @RequirePermissions('drive.create')
  @UsePipes(validate)
  createFolder(@Req() req: Request, @Res() res: Response, @Body() body: CreateFolderDto) {
    return this.run(res, 'createFolder', () => this.drive.createFolder(this.requester(req), body));
  }

  @Patch('/folders/:id')
  @RequirePermissions('drive.update')
  @UsePipes(validate)
  updateFolder(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateFolderDto,
  ) {
    return this.run(res, 'updateFolder', () => this.drive.updateFolder(this.requester(req), id, body));
  }

  @Post('/files')
  @RequirePermissions('drive.create')
  @UseInterceptors(uploadInterceptor)
  upload(@Req() req: Request, @Res() res: Response, @UploadedFile() file: UploadedDriveFile, @Body() body: any) {
    return this.run(res, 'upload', () => this.drive.uploadFile(this.requester(req), file, body || {}));
  }

  @Get('/files/:id')
  getFile(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    return this.run(res, 'getFile', () => this.drive.getFile(this.requester(req), id));
  }

  @Patch('/files/:id')
  @RequirePermissions('drive.update')
  @UsePipes(validate)
  updateFile(@Req() req: Request, @Res() res: Response, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateFileDto) {
    return this.run(res, 'updateFile', () => this.drive.updateFile(this.requester(req), id, body));
  }

  @Post('/files/:id/versions')
  @RequirePermissions('drive.update')
  @UseInterceptors(uploadInterceptor)
  uploadVersion(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedDriveFile,
    @Body() body: any,
  ) {
    return this.run(res, 'uploadVersion', () => this.drive.uploadVersion(this.requester(req), id, file, body || {}));
  }

  @Post('/files/:id/versions/:versionId/restore')
  @RequirePermissions('drive.update')
  @UsePipes(validate)
  restore(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Param('versionId', ParseIntPipe) versionId: number,
    @Body() body: RestoreVersionDto,
  ) {
    return this.run(res, 'restore', () => this.drive.restoreVersion(this.requester(req), id, versionId, body));
  }

  /**
   * Streams a version. ?inline=1 renders it in the browser only for safe types
   * (images, PDF, plain text, audio/video); everything else is an attachment.
   */
  @Get('/files/:id/download')
  async download(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Query('version') version?: string,
    @Query('inline') inline?: string,
  ) {
    try {
      const r: any = await this.drive.download(this.requester(req), id, version);
      if (!r.success) return res.status(r.status).send({ success: false, message: r.message });
      const d = r.data;
      const asInline = inline === '1' && d.inlineSafe;
      res.setHeader('Content-Type', asInline ? d.mime : d.inlineSafe ? d.mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', disposition(asInline ? 'inline' : 'attachment', d.filename));
      res.setHeader('Content-Length', String(d.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (d.checksum) res.setHeader('ETag', `"${d.checksum}"`);
      d.stream.on('error', (e: any) => {
        this.appLogger.forContext('DriveController', 'download', { id }).error('stream failed', e);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(e);
      });
      d.stream.pipe(res);
    } catch (error) {
      this.appLogger.forContext('DriveController', 'download', {}).error('download failed', error);
      return errorRes(res, error);
    }
  }
}
