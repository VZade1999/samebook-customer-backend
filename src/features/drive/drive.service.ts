import { Inject, Injectable } from '@nestjs/common';
import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { AppLogger } from '../../common/logger/logger.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateFolderDto, RestoreVersionDto, UpdateFileDto, UpdateFolderDto } from './dto/drive.dto';
import { DriveStorage } from './drive.storage';
import {
  FOLDER_COLORS,
  MAX_FOLDER_DEPTH,
  depthOf,
  isBlockedExtension,
  isInlineSafe,
  keepExtension,
  kindOf,
  moveFolderError,
  normalizeMime,
  parseTags,
  sanitizeName,
  splitExt,
  subtreeHeight,
  tagsFromDb,
  tagsToDb,
  uniqueName,
} from './drive.rules';

export interface DriveRequester {
  userId: number;
  companyId: number;
  permissions: string[];
}

/** The subset of a multer file Drive uses (disk storage). */
export interface UploadedDriveFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

type Result<T = any> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; status: number; extra?: Record<string, any> };

const ok = <T>(message: string, data: T): Result<T> => ({ success: true, message, data });
const fail = (message: string, status = 400, extra?: Record<string, any>): Result => ({
  success: false,
  message,
  status,
  extra,
});

/** Hard ceiling enforced by multer; see drive.controller.ts. */
export const MAX_UPLOAD_MB = 50;
const DEFAULT_QUOTA_MB = 5 * 1024;
const USER_ATTRS = ['id', 'first_name', 'last_name', 'email'];
const ACTIVITY_LIMIT = 60;

const userName = (u: any) =>
  u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email : null;
const userRef = (u: any) => (u ? { id: Number(u.id), name: userName(u) } : null);
const iso = (d: any) => {
  if (!(d instanceof Date) && typeof d !== 'string' && typeof d !== 'number') return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/**
 * Multer (busboy) may hand over UTF-8 filenames decoded as latin1
 * ("à¤°à¤¿à¤ªà¥‹à¤°à¥à¤Ÿ.pdf"). Re-decode only when the string is pure latin1
 * with high bytes and decodes to valid UTF-8, so correct names stay intact.
 */
export const fixUploadName = (name: string): string => {
  if (!name || !/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
};

@Injectable()
export class DriveService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly notifications: NotificationsService,
    private readonly storage: DriveStorage,
  ) {}

  private get db() {
    return this.dbProvider.db;
  }
  private get seq() {
    return this.dbProvider.sequelize;
  }
  private get Folders() {
    return this.db.drive_folders;
  }
  private get Files() {
    return this.db.drive_files;
  }
  private get Versions() {
    return this.db.drive_file_versions;
  }
  private get Activity() {
    return this.db.drive_activity;
  }

  private can(r: DriveRequester) {
    const p = r.permissions;
    return {
      view: p.includes('drive.view'),
      create: p.includes('drive.create'),
      update: p.includes('drive.update'),
    };
  }

  private quotaBytes() {
    const mb = Number(process.env.DRIVE_QUOTA_MB);
    return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_QUOTA_MB) * 1024 * 1024;
  }

  /** Bytes on disk: restored versions share their blob, so count each key once. */
  private async usedBytes(companyId: number): Promise<number> {
    const rows: any[] = await this.seq.query(
      `SELECT COALESCE(SUM(sz), 0) AS used FROM (
         SELECT MAX(size_bytes) AS sz FROM drive_file_versions WHERE company_id = :companyId GROUP BY storage_key
       ) blobs`,
      { replacements: { companyId }, type: QueryTypes.SELECT },
    );
    return Number(rows[0]?.used || 0);
  }

  private async log(
    r: DriveRequester,
    entry: {
      action: string;
      file_id?: number | null;
      folder_id?: number | null;
      field?: string | null;
      old_value?: any;
      new_value?: any;
      version_no?: number | null;
    },
    transaction?: Transaction,
  ) {
    const s = (v: any) => (v === null || v === undefined ? null : String(v).slice(0, 500));
    await this.Activity.create(
      {
        company_id: r.companyId,
        user_id: r.userId,
        action: entry.action,
        file_id: entry.file_id ?? null,
        folder_id: entry.folder_id ?? null,
        field: entry.field ?? null,
        old_value: s(entry.old_value),
        new_value: s(entry.new_value),
        version_no: entry.version_no ?? null,
      },
      { transaction },
    );
  }

  // ─── Folder helpers ───────────────────────────────────────────────────────

  private async allFolders(companyId: number): Promise<any[]> {
    return this.Folders.findAll({
      where: { company_id: companyId },
      attributes: ['id', 'parent_id', 'name', 'color', 'description', 'created_at', 'updated_at'],
      order: [['name', 'ASC']],
      raw: true,
    });
  }

  private parentMap(folders: any[]): Map<number, number | null> {
    return new Map(folders.map((f) => [Number(f.id), f.parent_id ? Number(f.parent_id) : null]));
  }

  private pathOf(folderId: number | null, byId: Map<number, any>) {
    const chain: { id: number; name: string }[] = [];
    let cursor = folderId ? byId.get(Number(folderId)) : null;
    let guard = 0;
    while (cursor && guard++ < MAX_FOLDER_DEPTH * 4) {
      chain.unshift({ id: Number(cursor.id), name: cursor.name });
      cursor = cursor.parent_id ? byId.get(Number(cursor.parent_id)) : null;
    }
    return chain;
  }

  private async findFolder(r: DriveRequester, id: number) {
    return this.Folders.findOne({ where: { id, company_id: r.companyId } });
  }

  private async siblingFolderNames(companyId: number, parentId: number | null, exceptId?: number) {
    const rows: any[] = await this.Folders.findAll({
      where: {
        company_id: companyId,
        parent_id: parentId ?? { [Op.is]: null },
        ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
      },
      attributes: ['name'],
      raw: true,
    });
    return rows.map((f) => f.name as string);
  }

  private async siblingFiles(companyId: number, folderId: number | null, exceptId?: number) {
    return this.Files.findAll({
      where: {
        company_id: companyId,
        folder_id: folderId ?? { [Op.is]: null },
        ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}),
      },
      attributes: ['id', 'name', 'current_version'],
      raw: true,
    }) as Promise<any[]>;
  }

  private shapeFolder(f: any, counts?: { files: number; folders: number }) {
    return {
      id: Number(f.id),
      parent_id: f.parent_id ? Number(f.parent_id) : null,
      name: f.name,
      description: f.description || null,
      color: f.color || 'indigo',
      created_at: iso(f.created_at),
      updated_at: iso(f.updated_at),
      file_count: counts?.files ?? 0,
      folder_count: counts?.folders ?? 0,
      creator: userRef(f.creator),
      editor: userRef(f.editor),
    };
  }

  private shapeFile(f: any, folderPath?: { id: number; name: string }[]) {
    return {
      id: Number(f.id),
      folder_id: f.folder_id ? Number(f.folder_id) : null,
      name: f.name,
      description: f.description || null,
      tags: tagsFromDb(f.tags),
      extension: f.extension || '',
      mime_type: f.mime_type || 'application/octet-stream',
      kind: kindOf(f.extension),
      previewable: isInlineSafe(f.mime_type),
      size_bytes: Number(f.size_bytes || 0),
      current_version: Number(f.current_version || 1),
      created_at: iso(f.created_at),
      updated_at: iso(f.updated_at),
      creator: userRef(f.creator),
      editor: userRef(f.editor) || userRef(f.creator),
      ...(folderPath ? { path: folderPath } : {}),
    };
  }

  private fileIncludes() {
    const { users } = this.db;
    return [
      { model: users, as: 'creator', attributes: USER_ATTRS },
      { model: users, as: 'editor', attributes: USER_ATTRS },
    ];
  }

  private async countsFor(companyId: number, folderIds: number[]) {
    const out = new Map<number, { files: number; folders: number }>();
    folderIds.forEach((id) => out.set(id, { files: 0, folders: 0 }));
    if (!folderIds.length) return out;
    const files: any[] = await this.seq.query(
      `SELECT folder_id, COUNT(*) AS n FROM drive_files WHERE company_id = :companyId AND folder_id IN (:ids) GROUP BY folder_id`,
      { replacements: { companyId, ids: folderIds }, type: QueryTypes.SELECT },
    );
    const folders: any[] = await this.seq.query(
      `SELECT parent_id, COUNT(*) AS n FROM drive_folders WHERE company_id = :companyId AND parent_id IN (:ids) GROUP BY parent_id`,
      { replacements: { companyId, ids: folderIds }, type: QueryTypes.SELECT },
    );
    files.forEach((row) => (out.get(Number(row.folder_id))!.files = Number(row.n)));
    folders.forEach((row) => (out.get(Number(row.parent_id))!.folders = Number(row.n)));
    return out;
  }

  // ─── Read endpoints ───────────────────────────────────────────────────────

  async meta(r: DriveRequester) {
    const [used, counts] = await Promise.all([
      this.usedBytes(r.companyId),
      this.seq.query(
        `SELECT
           (SELECT COUNT(*) FROM drive_files WHERE company_id = :c) AS files,
           (SELECT COUNT(*) FROM drive_folders WHERE company_id = :c) AS folders,
           (SELECT COUNT(*) FROM drive_file_versions WHERE company_id = :c) AS versions,
           (SELECT COUNT(*) FROM drive_files WHERE company_id = :c AND updated_at >= NOW() - INTERVAL 7 DAY) AS changed_week`,
        { replacements: { c: r.companyId }, type: QueryTypes.SELECT },
      ),
    ]);
    const c: any = (counts as any[])[0] || {};
    const byKind: any[] = await this.seq.query(
      `SELECT extension, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM drive_files WHERE company_id = :c GROUP BY extension`,
      { replacements: { c: r.companyId }, type: QueryTypes.SELECT },
    );
    const kinds: Record<string, { count: number; bytes: number }> = {};
    byKind.forEach((row) => {
      const k = kindOf(row.extension);
      kinds[k] ||= { count: 0, bytes: 0 };
      kinds[k].count += Number(row.n);
      kinds[k].bytes += Number(row.bytes);
    });
    return ok('Drive', {
      can: this.can(r),
      max_upload_mb: MAX_UPLOAD_MB,
      colors: FOLDER_COLORS,
      quota: { used_bytes: used, limit_bytes: this.quotaBytes() },
      stats: {
        files: Number(c.files || 0),
        folders: Number(c.folders || 0),
        versions: Number(c.versions || 0),
        changed_week: Number(c.changed_week || 0),
      },
      kinds,
    });
  }

  /** Every folder (flat) for the sidebar tree and the move picker. */
  async folderTree(r: DriveRequester) {
    const folders = await this.allFolders(r.companyId);
    const counts = await this.countsFor(
      r.companyId,
      folders.map((f) => Number(f.id)),
    );
    const rootFiles = await this.Files.count({ where: { company_id: r.companyId, folder_id: { [Op.is]: null } } });
    return ok('Folders', {
      root_file_count: rootFiles,
      folders: folders.map((f) => this.shapeFolder(f, counts.get(Number(f.id)))),
    });
  }

  async browse(r: DriveRequester, folderIdRaw?: string) {
    const folderId = folderIdRaw && /^\d+$/.test(folderIdRaw) ? Number(folderIdRaw) : null;
    const { users } = this.db;
    let folder: any = null;
    const all = await this.allFolders(r.companyId);
    const byId = new Map(all.map((f) => [Number(f.id), f]));
    if (folderId) {
      folder = await this.Folders.findOne({
        where: { id: folderId, company_id: r.companyId },
        include: [
          { model: users, as: 'creator', attributes: USER_ATTRS },
          { model: users, as: 'editor', attributes: USER_ATTRS },
        ],
      });
      if (!folder) return fail('Folder not found', 404);
    }
    const subfolders = all.filter((f) => (f.parent_id ? Number(f.parent_id) : null) === folderId);
    const counts = await this.countsFor(
      r.companyId,
      [...subfolders.map((f) => Number(f.id)), ...(folderId ? [folderId] : [])],
    );
    const files: any[] = await this.Files.findAll({
      where: { company_id: r.companyId, folder_id: folderId ?? { [Op.is]: null } },
      include: this.fileIncludes(),
      order: [['name', 'ASC']],
    });
    return ok('Folder', {
      folder: folder ? this.shapeFolder(folder, counts.get(folderId!)) : null,
      path: this.pathOf(folderId, byId),
      folders: subfolders.map((f) => this.shapeFolder(f, counts.get(Number(f.id)))),
      files: files.map((f) => this.shapeFile(f)),
    });
  }

  async search(r: DriveRequester, q: { q?: string; tag?: string; kind?: string; limit?: string }) {
    const where: any = { company_id: r.companyId };
    const and: any[] = [];
    const term = (q.q || '').trim().slice(0, 100);
    if (term) {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      and.push({
        [Op.or]: [
          { name: { [Op.like]: like } },
          { description: { [Op.like]: like } },
          { tags: { [Op.like]: like } },
        ],
      });
    }
    const tag = parseTags(q.tag || '')[0];
    if (tag) and.push({ tags: { [Op.like]: `%,${tag.replace(/[\\%_]/g, (c) => `\\${c}`)},%` } });
    if (and.length) where[Op.and] = and;
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
    // kind is derived from the extension, so it's filtered in memory after a bounded fetch.
    let rows: any[] = await this.Files.findAll({
      where,
      include: this.fileIncludes(),
      order: [['updated_at', 'DESC']],
      limit: q.kind && q.kind !== 'all' ? 2000 : limit,
    });
    if (q.kind && q.kind !== 'all') rows = rows.filter((f) => kindOf(f.extension) === q.kind).slice(0, limit);
    const all = await this.allFolders(r.companyId);
    const byId = new Map(all.map((f) => [Number(f.id), f]));
    return ok('Search', {
      files: rows.map((f) => this.shapeFile(f, this.pathOf(f.folder_id, byId))),
    });
  }

  async recent(r: DriveRequester, scope?: string) {
    const where: any = { company_id: r.companyId };
    if (scope === 'mine') {
      // "Files I've worked on": created, or ever touched (upload, version, edit, move).
      const touched = this.seq.literal(
        `(SELECT DISTINCT file_id FROM drive_activity WHERE company_id = ${Number(r.companyId)} AND user_id = ${Number(r.userId)} AND file_id IS NOT NULL)`,
      );
      where[Op.or] = [{ created_by: r.userId }, { id: { [Op.in]: touched } }];
    }
    const rows: any[] = await this.Files.findAll({
      where,
      include: this.fileIncludes(),
      order: [['updated_at', 'DESC']],
      limit: 40,
    });
    const all = await this.allFolders(r.companyId);
    const byId = new Map(all.map((f) => [Number(f.id), f]));
    return ok('Recent', { files: rows.map((f) => this.shapeFile(f, this.pathOf(f.folder_id, byId))) });
  }

  async tags(r: DriveRequester) {
    const rows: any[] = await this.Files.findAll({
      where: { company_id: r.companyId, tags: { [Op.ne]: null } },
      attributes: ['tags'],
      raw: true,
    });
    const counts = new Map<string, number>();
    rows.forEach((row) => tagsFromDb(row.tags).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return ok('Tags', {
      tags: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count })),
    });
  }

  private async shapeActivity(r: DriveRequester, rows: any[]) {
    const all = await this.allFolders(r.companyId);
    const byId = new Map(all.map((f) => [Number(f.id), f]));
    return rows.map((a) => ({
      id: Number(a.id),
      action: a.action,
      field: a.field,
      old_value: a.old_value,
      new_value: a.new_value,
      version_no: a.version_no,
      created_at: iso(a.created_at),
      user: userRef(a.user),
      file: a.file
        ? { id: Number(a.file.id), name: a.file.name, extension: a.file.extension, kind: kindOf(a.file.extension) }
        : null,
      folder: a.folder ? { id: Number(a.folder.id), name: a.folder.name, color: a.folder.color || 'indigo' } : null,
      path: this.pathOf(a.file ? a.file.folder_id : a.folder?.parent_id ?? null, byId),
    }));
  }

  async activity(r: DriveRequester, q: { before_id?: string; limit?: string }) {
    const { users } = this.db;
    const where: any = { company_id: r.companyId };
    if (q.before_id && /^\d+$/.test(q.before_id)) where.id = { [Op.lt]: Number(q.before_id) };
    const limit = Math.min(Math.max(Number(q.limit) || ACTIVITY_LIMIT, 1), 200);
    const rows: any[] = await this.Activity.findAll({
      where,
      include: [
        { model: users, as: 'user', attributes: USER_ATTRS },
        { model: this.Files, as: 'file', attributes: ['id', 'name', 'extension', 'folder_id'] },
        { model: this.Folders, as: 'folder', attributes: ['id', 'name', 'color', 'parent_id'] },
      ],
      order: [['id', 'DESC']],
      limit,
    });
    return ok('Activity', { items: await this.shapeActivity(r, rows), has_more: rows.length === limit });
  }

  async getFile(r: DriveRequester, id: number) {
    const { users } = this.db;
    const f = await this.Files.findOne({ where: { id, company_id: r.companyId }, include: this.fileIncludes() });
    if (!f) return fail('File not found', 404);
    const [versions, activity, all] = await Promise.all([
      this.Versions.findAll({
        where: { file_id: id, company_id: r.companyId },
        include: [{ model: users, as: 'uploader', attributes: USER_ATTRS }],
        order: [['version_no', 'DESC']],
      }),
      this.Activity.findAll({
        where: { file_id: id, company_id: r.companyId },
        include: [{ model: users, as: 'user', attributes: USER_ATTRS }],
        order: [['id', 'DESC']],
        limit: 200,
      }),
      this.allFolders(r.companyId),
    ]);
    const byId = new Map(all.map((x) => [Number(x.id), x]));
    return ok('File', {
      file: this.shapeFile(f, this.pathOf(f.folder_id, byId)),
      versions: (versions as any[]).map((v) => ({
        id: Number(v.id),
        version_no: Number(v.version_no),
        original_name: v.original_name,
        extension: v.extension || '',
        mime_type: v.mime_type,
        kind: kindOf(v.extension),
        previewable: isInlineSafe(v.mime_type),
        size_bytes: Number(v.size_bytes || 0),
        checksum: v.checksum_sha256,
        note: v.note,
        restored_from: v.restored_from,
        is_current: Number(v.version_no) === Number(f.current_version),
        uploaded_by: userRef(v.uploader),
        created_at: iso(v.created_at),
      })),
      activity: (activity as any[]).map((a) => ({
        id: Number(a.id),
        action: a.action,
        field: a.field,
        old_value: a.old_value,
        new_value: a.new_value,
        version_no: a.version_no,
        user: userRef(a.user),
        created_at: iso(a.created_at),
      })),
      can: { update: this.can(r).update },
    });
  }

  // ─── Folders: create / update (no delete, by design) ──────────────────────

  async createFolder(r: DriveRequester, dto: CreateFolderDto) {
    const name = sanitizeName(dto.name, 120);
    if (!name) return fail('Folder name is required');
    const parentId = dto.parent_id ? Number(dto.parent_id) : null;
    const all = await this.allFolders(r.companyId);
    const parentOf = this.parentMap(all);
    if (parentId && !parentOf.has(parentId)) return fail('Parent folder not found', 404);
    if (depthOf(parentId, parentOf) + 1 > MAX_FOLDER_DEPTH) {
      return fail(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
    }
    const siblings = await this.siblingFolderNames(r.companyId, parentId);
    if (siblings.some((s) => s.toLowerCase() === name.toLowerCase())) {
      return fail(`A folder named "${name}" already exists here`, 409, { code: 'NAME_EXISTS' });
    }
    const folder = await this.seq.transaction(async (transaction: Transaction) => {
      const created = await this.Folders.create(
        {
          company_id: r.companyId,
          parent_id: parentId,
          name,
          description: dto.description?.trim() || null,
          color: dto.color || 'indigo',
          created_by: r.userId,
          updated_by: r.userId,
          created_at: new Date(),
          updated_at: new Date(),
        },
        { transaction },
      );
      await this.log(r, { action: 'FOLDER_CREATED', folder_id: Number(created.id), new_value: name }, transaction);
      return created;
    });
    return ok('Folder created', this.shapeFolder(folder));
  }

  async updateFolder(r: DriveRequester, id: number, dto: UpdateFolderDto) {
    const folder = await this.findFolder(r, id);
    if (!folder) return fail('Folder not found', 404);
    const changes: Record<string, any> = {};
    const logs: { action: string; field: string; old_value: any; new_value: any }[] = [];

    const targetParent =
      dto.parent_id === undefined ? (folder.parent_id ? Number(folder.parent_id) : null) : dto.parent_id ? Number(dto.parent_id) : null;
    const currentParent = folder.parent_id ? Number(folder.parent_id) : null;
    const all = await this.allFolders(r.companyId);
    const byId = new Map(all.map((f) => [Number(f.id), f]));
    const parentOf = this.parentMap(all);

    if (targetParent !== currentParent) {
      if (targetParent && !parentOf.has(targetParent)) return fail('Target folder not found', 404);
      const err = moveFolderError(id, targetParent, parentOf);
      if (err) return fail(err);
      if (depthOf(targetParent, parentOf) + subtreeHeight(id, parentOf) > MAX_FOLDER_DEPTH) {
        return fail(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
      }
      changes.parent_id = targetParent;
      const where = (pid: number | null) => (pid ? byId.get(pid)?.name : 'My Drive');
      logs.push({ action: 'FOLDER_MOVED', field: 'folder', old_value: where(currentParent), new_value: where(targetParent) });
    }

    let name = folder.name as string;
    if (dto.name !== undefined) {
      const next = sanitizeName(dto.name, 120);
      if (!next) return fail('Folder name is required');
      if (next !== folder.name) {
        changes.name = next;
        logs.push({ action: 'FOLDER_RENAMED', field: 'name', old_value: folder.name, new_value: next });
        name = next;
      }
    }
    if (changes.name !== undefined || changes.parent_id !== undefined) {
      const siblings = await this.siblingFolderNames(r.companyId, targetParent, id);
      if (siblings.some((s) => s.toLowerCase() === name.toLowerCase())) {
        return fail(`A folder named "${name}" already exists there`, 409, { code: 'NAME_EXISTS' });
      }
    }
    if (dto.description !== undefined) {
      const next = dto.description?.trim() || null;
      if (next !== (folder.description || null)) {
        changes.description = next;
        logs.push({ action: 'FOLDER_UPDATED', field: 'description', old_value: folder.description, new_value: next });
      }
    }
    if (dto.color !== undefined) {
      const next = dto.color || 'indigo';
      if (next !== (folder.color || 'indigo')) {
        changes.color = next;
        logs.push({ action: 'FOLDER_UPDATED', field: 'color', old_value: folder.color || 'indigo', new_value: next });
      }
    }
    if (!logs.length) return ok('No changes', this.shapeFolder(folder));

    await this.seq.transaction(async (transaction: Transaction) => {
      await folder.update({ ...changes, updated_by: r.userId, updated_at: new Date() }, { transaction });
      for (const l of logs) await this.log(r, { ...l, folder_id: id }, transaction);
    });
    return ok('Folder updated', this.shapeFolder(folder));
  }

  // ─── Files ────────────────────────────────────────────────────────────────

  private async checkUpload(r: DriveRequester, file: UploadedDriveFile | undefined) {
    if (!file?.path) return fail('Choose a file to upload');
    const original = sanitizeName(fixUploadName(file.originalname), 200) || 'file';
    const { ext } = splitExt(original);
    if (ext && isBlockedExtension(ext)) {
      return fail(`.${ext} files can't be stored in Drive (executables and web pages are blocked)`, 415);
    }
    if (file.size <= 0) return fail('The file is empty');
    const used = await this.usedBytes(r.companyId);
    if (used + file.size > this.quotaBytes()) {
      return fail('Your company Drive is full. Free plan storage limit reached.', 413, { code: 'QUOTA_EXCEEDED' });
    }
    return { original, ext, mime: normalizeMime(file.mimetype) };
  }

  async uploadFile(
    r: DriveRequester,
    file: UploadedDriveFile | undefined,
    body: { folder_id?: string; name?: string; description?: string; tags?: any; on_conflict?: string },
  ): Promise<Result> {
    try {
      const checked = await this.checkUpload(r, file);
      if ('success' in checked) return checked;
      const { original, ext, mime } = checked;

      const folderId = body.folder_id && /^\d+$/.test(String(body.folder_id)) ? Number(body.folder_id) : null;
      if (folderId && !(await this.findFolder(r, folderId))) return fail('Folder not found', 404);

      let name = keepExtension(sanitizeName(body.name || '', 200) || original, ext);
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 5000) || null : null;
      const tags = parseTags(body.tags);

      const siblings = await this.siblingFiles(r.companyId, folderId);
      const clash = siblings.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (clash) {
        if (body.on_conflict !== 'rename') {
          return fail(`"${name}" already exists in this folder`, 409, {
            code: 'NAME_EXISTS',
            existing: { id: Number(clash.id), name: clash.name, current_version: Number(clash.current_version) },
          });
        }
        name = uniqueName(name, siblings.map((s) => s.name));
      }

      const blob = await this.storage.put(r.companyId, file!.path, ext);
      const created = await this.seq.transaction(async (transaction: Transaction) => {
        const f = await this.Files.create(
          {
            company_id: r.companyId,
            folder_id: folderId,
            name,
            description,
            tags: tagsToDb(tags),
            extension: ext || null,
            mime_type: mime,
            size_bytes: blob.size,
            current_version: 1,
            created_by: r.userId,
            updated_by: r.userId,
          },
          { transaction },
        );
        await this.Versions.create(
          {
            file_id: f.id,
            company_id: r.companyId,
            version_no: 1,
            storage_key: blob.key,
            original_name: original,
            extension: ext || null,
            mime_type: mime,
            size_bytes: blob.size,
            checksum_sha256: blob.sha256,
            note: 'Original upload',
            uploaded_by: r.userId,
          },
          { transaction },
        );
        await this.log(r, { action: 'FILE_UPLOADED', file_id: Number(f.id), new_value: name, version_no: 1 }, transaction);
        return f;
      });
      const res = await this.getFile(r, Number(created.id));
      return res.success ? ok('File uploaded', res.data) : res;
    } finally {
      // put() moved the temp file away on success; this only cleans rejected uploads.
      await this.storage.discardTemp(file?.path);
    }
  }

  async uploadVersion(
    r: DriveRequester,
    id: number,
    file: UploadedDriveFile | undefined,
    body: { note?: string },
  ): Promise<Result> {
    try {
      const existing = await this.Files.findOne({ where: { id, company_id: r.companyId } });
      if (!existing) return fail('File not found', 404);
      const checked = await this.checkUpload(r, file);
      if ('success' in checked) return checked;
      const { original, ext, mime } = checked;
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null;

      const blob = await this.storage.put(r.companyId, file!.path, ext);
      const versionNo = await this.addVersion(r, id, {
        storage_key: blob.key,
        original_name: original,
        extension: ext || null,
        mime_type: mime,
        size_bytes: blob.size,
        checksum_sha256: blob.sha256,
        note,
        restored_from: null,
      });
      if (typeof versionNo !== 'number') return versionNo;
      await this.notifyOwner(r, existing, `uploaded version ${versionNo} of`);
      const res = await this.getFile(r, id);
      return res.success ? ok(`Version ${versionNo} uploaded`, res.data) : res;
    } finally {
      await this.storage.discardTemp(file?.path);
    }
  }

  async restoreVersion(r: DriveRequester, id: number, versionId: number, dto: RestoreVersionDto) {
    const file = await this.Files.findOne({ where: { id, company_id: r.companyId } });
    if (!file) return fail('File not found', 404);
    const v = await this.Versions.findOne({ where: { id: versionId, file_id: id, company_id: r.companyId } });
    if (!v) return fail('Version not found', 404);
    if (Number(v.version_no) === Number(file.current_version)) return fail('This is already the current version');
    if (!(await this.storage.exists(v.storage_key))) return fail('The stored copy of this version is missing', 410);

    const versionNo = await this.addVersion(r, id, {
      storage_key: v.storage_key,
      original_name: v.original_name,
      extension: v.extension,
      mime_type: v.mime_type,
      size_bytes: v.size_bytes,
      checksum_sha256: v.checksum_sha256,
      note: dto.note?.trim() || `Restored from version ${v.version_no}`,
      restored_from: Number(v.version_no),
    });
    if (typeof versionNo !== 'number') return versionNo;
    await this.notifyOwner(r, file, `restored version ${v.version_no} of`);
    const res = await this.getFile(r, id);
    return res.success ? ok(`Version ${v.version_no} restored as version ${versionNo}`, res.data) : res;
  }

  /**
   * Appends a version under a row lock so two simultaneous uploads get
   * consecutive numbers; the unique (file_id, version_no) key backs it up.
   */
  private async addVersion(
    r: DriveRequester,
    fileId: number,
    v: {
      storage_key: string;
      original_name: string;
      extension: string | null;
      mime_type: string | null;
      size_bytes: number;
      checksum_sha256: string | null;
      note: string | null;
      restored_from: number | null;
    },
  ): Promise<number | Result> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.seq.transaction(async (transaction: Transaction) => {
          const f = await this.Files.findOne({
            where: { id: fileId, company_id: r.companyId },
            lock: transaction.LOCK.UPDATE,
            transaction,
          });
          const maxNo: number = (await this.Versions.max('version_no', { where: { file_id: fileId }, transaction })) || 0;
          const versionNo = Number(maxNo) + 1;
          await this.Versions.create(
            { ...v, file_id: fileId, company_id: r.companyId, version_no: versionNo, uploaded_by: r.userId },
            { transaction },
          );

          const changes: Record<string, any> = {
            current_version: versionNo,
            size_bytes: v.size_bytes,
            mime_type: v.mime_type,
            extension: v.extension,
            updated_by: r.userId,
            updated_at: new Date(),
          };
          // New version in a different format (Quote.docx -> .pdf): keep the
          // display name honest about what's stored.
          const oldExt = (f.extension || '').toLowerCase();
          const newExt = (v.extension || '').toLowerCase();
          if (oldExt !== newExt) {
            const { base, ext } = splitExt(f.name);
            const stem = ext === oldExt ? base : f.name;
            const siblings = await this.siblingFiles(r.companyId, f.folder_id ? Number(f.folder_id) : null, fileId);
            const renamed = uniqueName(`${stem}${newExt ? `.${newExt}` : ''}`, siblings.map((s) => s.name));
            if (renamed !== f.name) {
              changes.name = renamed;
              await this.log(
                r,
                { action: 'FILE_RENAMED', file_id: fileId, field: 'name', old_value: f.name, new_value: renamed, version_no: versionNo },
                transaction,
              );
            }
          }
          await f.update(changes, { transaction });
          await this.log(
            r,
            {
              action: v.restored_from ? 'VERSION_RESTORED' : 'VERSION_UPLOADED',
              file_id: fileId,
              old_value: v.restored_from ?? null,
              new_value: v.note,
              version_no: versionNo,
            },
            transaction,
          );
          return versionNo;
        });
      } catch (e) {
        if (e instanceof UniqueConstraintError && attempt < 2) continue;
        throw e;
      }
    }
    return fail('Could not save the new version, please try again', 409);
  }

  /** Tell the file's creator when someone else changes their file. */
  private async notifyOwner(r: DriveRequester, file: any, verb: string) {
    const ownerId = Number(file.created_by);
    if (!ownerId || ownerId === Number(r.userId)) return;
    const actor = await this.db.users.findOne({ where: { id: r.userId }, attributes: USER_ATTRS });
    await this.notifications.notify({
      companyId: r.companyId,
      userIds: [ownerId],
      module: 'drive',
      type: 'DRIVE_VERSION',
      title: `${userName(actor) || 'Someone'} ${verb} ${file.name}`,
      body: 'Open Drive to see the version history.',
      link: `/app/drive?file=${Number(file.id)}`,
      entityType: 'DRIVE_FILE',
      entityId: Number(file.id),
      actorId: r.userId,
    });
  }

  async updateFile(r: DriveRequester, id: number, dto: UpdateFileDto) {
    const f = await this.Files.findOne({ where: { id, company_id: r.companyId } });
    if (!f) return fail('File not found', 404);
    const changes: Record<string, any> = {};
    const logs: { action: string; field: string; old_value: any; new_value: any }[] = [];

    const currentFolder = f.folder_id ? Number(f.folder_id) : null;
    const targetFolder =
      dto.folder_id === undefined ? currentFolder : dto.folder_id ? Number(dto.folder_id) : null;
    if (targetFolder !== currentFolder) {
      const all = await this.allFolders(r.companyId);
      const byId = new Map(all.map((x) => [Number(x.id), x]));
      if (targetFolder && !byId.has(targetFolder)) return fail('Target folder not found', 404);
      const label = (fid: number | null) =>
        fid ? this.pathOf(fid, byId).map((p) => p.name).join(' / ') : 'My Drive';
      changes.folder_id = targetFolder;
      logs.push({ action: 'FILE_MOVED', field: 'folder', old_value: label(currentFolder), new_value: label(targetFolder) });
    }

    let name = f.name as string;
    if (dto.name !== undefined) {
      const next = keepExtension(sanitizeName(dto.name, 200), f.extension);
      if (!sanitizeName(dto.name, 200)) return fail('File name is required');
      if (next !== f.name) {
        changes.name = next;
        logs.push({ action: 'FILE_RENAMED', field: 'name', old_value: f.name, new_value: next });
        name = next;
      }
    }
    if (changes.name !== undefined || changes.folder_id !== undefined) {
      const siblings = await this.siblingFiles(r.companyId, targetFolder, id);
      if (siblings.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        return fail(`"${name}" already exists in that folder`, 409, { code: 'NAME_EXISTS' });
      }
    }
    if (dto.description !== undefined) {
      const next = dto.description?.trim() || null;
      if (next !== (f.description || null)) {
        changes.description = next;
        logs.push({ action: 'FILE_UPDATED', field: 'description', old_value: f.description, new_value: next });
      }
    }
    if (dto.tags !== undefined) {
      const next = parseTags(dto.tags);
      const old = tagsFromDb(f.tags);
      if (next.join(',') !== old.join(',')) {
        changes.tags = tagsToDb(next);
        logs.push({ action: 'FILE_UPDATED', field: 'tags', old_value: old.join(', ') || null, new_value: next.join(', ') || null });
      }
    }
    if (!logs.length) return this.getFile(r, id);

    await this.seq.transaction(async (transaction: Transaction) => {
      await f.update({ ...changes, updated_by: r.userId, updated_at: new Date() }, { transaction });
      for (const l of logs) await this.log(r, { ...l, file_id: id }, transaction);
    });
    const res = await this.getFile(r, id);
    return res.success ? ok('File updated', res.data) : res;
  }

  /** Resolves the bytes of the current (or a given) version for streaming. */
  async download(r: DriveRequester, id: number, versionRaw?: string) {
    const f = await this.Files.findOne({ where: { id, company_id: r.companyId } });
    if (!f) return fail('File not found', 404);
    const versionNo = versionRaw && /^\d+$/.test(versionRaw) ? Number(versionRaw) : Number(f.current_version);
    const v = await this.Versions.findOne({ where: { file_id: id, company_id: r.companyId, version_no: versionNo } });
    if (!v) return fail('Version not found', 404);
    if (!(await this.storage.exists(v.storage_key))) {
      this.appLogger
        .forContext('DriveService', 'download', { fileId: id, versionNo })
        .error('Drive blob missing on disk', new Error(v.storage_key));
      return fail('The stored copy of this file is missing', 410);
    }
    const isCurrent = versionNo === Number(f.current_version);
    const { base, ext } = splitExt(f.name);
    const vExt = (v.extension || '').toLowerCase();
    // Old versions download as "Quote (v2).pdf" with that version's own extension.
    const filename = isCurrent
      ? f.name
      : `${ext === (f.extension || '').toLowerCase() ? base : f.name} (v${versionNo})${vExt ? `.${vExt}` : ''}`;
    return ok('Download', {
      stream: this.storage.open(v.storage_key),
      size: Number(v.size_bytes || 0),
      mime: v.mime_type || 'application/octet-stream',
      filename,
      inlineSafe: isInlineSafe(v.mime_type),
      checksum: v.checksum_sha256 as string | null,
    });
  }
}
