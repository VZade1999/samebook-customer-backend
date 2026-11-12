import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as jwt from 'jsonwebtoken';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';

/**
 * Where Drive keeps the bytes. Blobs are immutable: a new version is a new
 * blob and nothing is ever overwritten, so a version's storage_key stays
 * valid forever.
 *
 * Three backends, picked from env at runtime:
 *  - db    (default): bytes live in the database (drive_blob_chunks) as 2 MB
 *          chunks. Works on Vercel (no disk, 4.5 MB request/response limit)
 *          and shares files between every server using the same database:
 *          the browser uploads and downloads chunk by chunk through the API.
 *  - s3    (DRIVE_STORAGE=s3 or DRIVE_S3_BUCKET set): any S3-compatible store
 *          (AWS S3, Cloudflare R2, ...). The browser uploads straight to the
 *          bucket with a pre-signed PUT and downloads through short-lived
 *          pre-signed GET links, so files never pass through the API.
 *  - local (DRIVE_STORAGE=local): files under DRIVE_STORAGE_DIR on this
 *          machine only.
 */
export type StorageMode = 'db' | 'local' | 's3' | 'unconfigured';

/** Chunk size for db storage: well under Vercel's 4.5 MB body limit. */
export const CHUNK_BYTES = 2 * 1024 * 1024;

export interface StoredBlob {
  key: string;
  size: number;
  sha256: string | null;
}

export interface UploadTarget {
  /** Absolute URL (s3) or an API path such as /drive/uploads/<token> (local). */
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** true = the URL is on the API; send cookies and prefix the API base. */
  via_api: boolean;
  /** db storage: PUT the file in slices of this size to `${url}?part=<n>`. */
  chunk_size?: number;
}

const DEFAULT_ROOT = path.resolve(process.cwd(), 'storage', 'drive');
const KEY_RE = /^c\d+\/\d{4}\/\d{2}\/[0-9a-f-]{36}(\.[a-z0-9]{1,15})?$/;
const UPLOAD_TTL_S = 30 * 60;
const LINK_TTL_S = 15 * 60;

const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();

@Injectable()
export class DriveStorage {
  private s3Client: S3Client | null = null;
  private s3Signature = '';
  private sequelize: any = null;
  private lastSweep = 0;

  /** Called once by the feature module with the shared Sequelize instance. */
  useDatabase(sequelize: any) {
    this.sequelize = sequelize;
  }

  // ── configuration (read lazily so .env.local / Vercel env apply) ────────

  get mode(): StorageMode {
    const wanted = (process.env.DRIVE_STORAGE || '').toLowerCase();
    if (wanted === 's3' || (!wanted && env('DRIVE_S3_BUCKET'))) {
      return env('DRIVE_S3_BUCKET') ? 's3' : 'unconfigured';
    }
    if (wanted === 'local') return 'local';
    return 'db';
  }

  // ── db chunks ───────────────────────────────────────────────────────────

  private get db() {
    if (!this.sequelize) throw new Error('Drive db storage used before the database was attached');
    return this.sequelize;
  }

  private async insertChunk(key: string, seq: number, data: Buffer) {
    await this.db.query(
      `INSERT INTO drive_blob_chunks (storage_key, seq, size, data) VALUES (:key, :seq, :size, :data)
       ON DUPLICATE KEY UPDATE size = VALUES(size), data = VALUES(data), created_at = CURRENT_TIMESTAMP`,
      { replacements: { key, seq, size: data.length, data } },
    );
  }

  async chunkInfo(key: string): Promise<{ count: number; size: number; maxSeq: number }> {
    const [rows] = await this.db.query(
      'SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS total, COALESCE(MAX(seq), -1) AS max_seq FROM drive_blob_chunks WHERE storage_key = :key',
      { replacements: { key } },
    );
    const r = rows[0] || {};
    return { count: Number(r.n || 0), size: Number(r.total || 0), maxSeq: Number(r.max_seq ?? -1) };
  }

  async readChunk(key: string, seq: number): Promise<Buffer | null> {
    const [rows] = await this.db.query('SELECT data FROM drive_blob_chunks WHERE storage_key = :key AND seq = :seq', {
      replacements: { key, seq },
    });
    const data = rows[0]?.data;
    return data ? (Buffer.isBuffer(data) ? data : Buffer.from(data)) : null;
  }

  /** Drops chunks of uploads that were started but never saved (> 1 day old). */
  async sweepOrphans() {
    if (this.mode !== 'db' || Date.now() - this.lastSweep < 10 * 60 * 1000) return;
    this.lastSweep = Date.now();
    await this.db
      .query(
        `DELETE c FROM drive_blob_chunks c
         LEFT JOIN drive_file_versions v ON v.storage_key = c.storage_key
         WHERE v.id IS NULL AND c.created_at < NOW() - INTERVAL 1 DAY`,
      )
      .catch(() => undefined);
  }

  /** db mode: one slice of a direct upload. */
  async receivePart(key: string, seq: number, body: Readable, maxBytes: number): Promise<{ size: number }> {
    const maxParts = Math.ceil(maxBytes / CHUNK_BYTES);
    if (!Number.isInteger(seq) || seq < 0 || seq >= maxParts) {
      throw Object.assign(new Error('Invalid upload part'), { status: 400 });
    }
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of body) {
      size += (chunk as Buffer).length;
      if (size > CHUNK_BYTES) throw Object.assign(new Error('Upload part is too large'), { status: 413 });
      parts.push(chunk as Buffer);
    }
    if (!size) throw Object.assign(new Error('Upload part is empty'), { status: 400 });
    await this.insertChunk(key, seq, Buffer.concat(parts, size));
    return { size };
  }

  get root(): string {
    return path.resolve(process.env.DRIVE_STORAGE_DIR || DEFAULT_ROOT);
  }

  /** Temp files for API (multipart / local PUT) uploads. */
  get tmpDir(): string {
    return this.mode === 'local' ? path.join(this.root, '_incoming') : path.join(os.tmpdir(), 'drive-incoming');
  }

  private get bucket(): string {
    return env('DRIVE_S3_BUCKET')!;
  }

  private get s3(): S3Client {
    const region = env('DRIVE_S3_REGION', 'AWS_REGION') || 'auto';
    const endpoint = env('DRIVE_S3_ENDPOINT');
    const accessKeyId = env('DRIVE_S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID');
    const secretAccessKey = env('DRIVE_S3_SECRET_ACCESS_KEY', 'AWS_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY');
    const signature = [region, endpoint, accessKeyId].join('|');
    if (!this.s3Client || this.s3Signature !== signature) {
      this.s3Client = new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: env('DRIVE_S3_PATH_STYLE') === 'true' } : {}),
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        // Don't add CRC checksums to pre-signed PUTs: browsers can't send them.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      this.s3Signature = signature;
    }
    return this.s3Client;
  }

  private assertUsable() {
    if (this.mode === 'unconfigured') {
      throw Object.assign(new Error('Drive file storage is not configured on this server'), { status: 503 });
    }
  }

  async ensureDirs() {
    await fs.mkdir(this.tmpDir, { recursive: true });
  }

  // ── keys ──────────────────────────────────────────────────────────────

  newKey(companyId: number, ext: string): string {
    const d = new Date();
    return [
      `c${Number(companyId)}`,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      `${randomUUID()}${ext ? `.${ext}` : ''}`,
    ].join('/');
  }

  /** A key this company is allowed to commit (generated by newKey for it). */
  isCompanyKey(key: unknown, companyId: number): key is string {
    return typeof key === 'string' && KEY_RE.test(key) && key.startsWith(`c${Number(companyId)}/`);
  }

  extOfKey(key: string): string {
    const m = /\.([a-z0-9]{1,15})$/.exec(key);
    return m ? m[1] : '';
  }

  private resolveKey(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  private hashFile(file: string): Promise<{ sha256: string; size: number }> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      let size = 0;
      createReadStream(file)
        .on('data', (chunk: Buffer) => {
          size += chunk.length;
          hash.update(chunk);
        })
        .on('error', reject)
        .on('end', () => resolve({ sha256: hash.digest('hex'), size }));
    });
  }

  // ── server-side upload (multipart through the API) ─────────────────────

  /** Moves an uploaded temp file into permanent, company-scoped storage. */
  async put(companyId: number, tmpPath: string, ext: string, mime = 'application/octet-stream'): Promise<StoredBlob> {
    this.assertUsable();
    const { sha256, size } = await this.hashFile(tmpPath);
    const key = this.newKey(companyId, ext);
    if (this.mode === 's3') {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(tmpPath),
          ContentLength: size,
          ContentType: mime,
        }),
      );
      await fs.unlink(tmpPath).catch(() => undefined);
      return { key, size, sha256 };
    }
    if (this.mode === 'db') {
      const fh = await fs.open(tmpPath, 'r');
      try {
        for (let seq = 0, offset = 0; offset < size; seq++, offset += CHUNK_BYTES) {
          const buf = Buffer.alloc(Math.min(CHUNK_BYTES, size - offset));
          await fh.read(buf, 0, buf.length, offset);
          await this.insertChunk(key, seq, buf);
        }
      } finally {
        await fh.close();
      }
      await fs.unlink(tmpPath).catch(() => undefined);
      return { key, size, sha256 };
    }
    const dest = this.resolveKey(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fs.rename(tmpPath, dest);
    } catch {
      await fs.copyFile(tmpPath, dest);
      await fs.unlink(tmpPath).catch(() => undefined);
    }
    return { key, size, sha256 };
  }

  // ── direct upload (browser -> storage) ────────────────────────────────

  private uploadSecret() {
    const s = process.env.JWT_ACCESS_SECRET;
    if (!s) throw new Error('JWT_ACCESS_SECRET is not set');
    return `${s}:drive-upload`;
  }

  /** Where the browser should PUT the bytes for `key`. */
  async uploadTarget(companyId: number, key: string, mime: string, maxBytes: number): Promise<UploadTarget> {
    this.assertUsable();
    if (this.mode === 's3') {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mime }),
        { expiresIn: UPLOAD_TTL_S },
      );
      return { url, method: 'PUT', headers: { 'Content-Type': mime }, via_api: false };
    }
    const token = jwt.sign({ k: key, c: Number(companyId), m: maxBytes }, this.uploadSecret(), {
      expiresIn: UPLOAD_TTL_S,
    });
    return {
      url: `/drive/uploads/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      via_api: true,
      ...(this.mode === 'db' ? { chunk_size: CHUNK_BYTES } : {}),
    };
  }

  verifyUploadToken(token: string): { key: string; companyId: number; maxBytes: number } | null {
    try {
      const p: any = jwt.verify(token, this.uploadSecret());
      return { key: p.k, companyId: Number(p.c), maxBytes: Number(p.m) };
    } catch {
      return null;
    }
  }

  /** Local mode: stream a raw request body to disk, hashing as it goes. */
  async writeStream(key: string, body: Readable, maxBytes: number): Promise<StoredBlob> {
    const dest = this.resolveKey(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    const hash = createHash('sha256');
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp, { flags: 'wx' });
      const fail = (e: any) => {
        body.unpipe(out);
        out.destroy();
        reject(e);
      };
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) return fail(Object.assign(new Error('File is larger than the upload limit'), { status: 413 }));
        hash.update(chunk);
      });
      body.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => resolve());
      body.pipe(out);
    }).catch(async (e) => {
      await fs.unlink(tmp).catch(() => undefined);
      throw e;
    });
    await fs.rename(tmp, dest);
    return { key, size, sha256: hash.digest('hex') };
  }

  /** Size (and hash where cheap) of a stored object; null if it doesn't exist. */
  async stat(key: string): Promise<{ size: number; sha256: string | null } | null> {
    this.assertUsable();
    if (this.mode === 's3') {
      try {
        const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        return { size: Number(head.ContentLength || 0), sha256: null };
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
        throw e;
      }
    }
    if (this.mode === 'db') {
      const info = await this.chunkInfo(key);
      // Every part 0..n-1 must be there (an interrupted upload has gaps).
      if (!info.count || info.count !== info.maxSeq + 1) return null;
      const hash = createHash('sha256');
      for (let seq = 0; seq < info.count; seq++) {
        const part = await this.readChunk(key, seq);
        if (!part) return null;
        hash.update(part);
      }
      return { size: info.size, sha256: hash.digest('hex') };
    }
    try {
      const full = this.resolveKey(key);
      await fs.access(full);
      return this.hashFile(full);
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.mode === 'unconfigured') return false;
    if (this.mode === 's3') return (await this.stat(key)) !== null;
    if (this.mode === 'db') return (await this.chunkInfo(key)).count > 0;
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  /** Only for objects that were uploaded but rejected at commit (never for versions). */
  async discardObject(key: string) {
    try {
      if (this.mode === 's3') await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      else if (this.mode === 'local') await fs.unlink(this.resolveKey(key));
      else if (this.mode === 'db') {
        await this.db.query('DELETE FROM drive_blob_chunks WHERE storage_key = :key', { replacements: { key } });
      }
    } catch {
      // best effort
    }
  }

  // ── reading ───────────────────────────────────────────────────────────

  /** s3: a short-lived pre-signed GET link that sets type + disposition. */
  async signedLink(key: string, opts: { filename: string; mime: string; inline: boolean }): Promise<string> {
    const encoded = encodeURIComponent(opts.filename);
    const ascii = opts.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.mime,
        ResponseContentDisposition: `${opts.inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
        ResponseCacheControl: 'private, max-age=300',
      }),
      { expiresIn: LINK_TTL_S },
    );
  }

  /** local / db: stream the whole file (db: chunk after chunk). */
  open(key: string): Readable {
    if (this.mode !== 'db') return createReadStream(this.resolveKey(key));
    const self = this;
    return Readable.from(
      (async function* () {
        const { count } = await self.chunkInfo(key);
        for (let seq = 0; seq < count; seq++) {
          const part = await self.readChunk(key, seq);
          if (!part) throw new Error(`Missing chunk ${seq} of ${key}`);
          yield part;
        }
      })(),
    );
  }

  async discardTemp(tmpPath?: string) {
    if (tmpPath && path.resolve(tmpPath).startsWith(this.tmpDir + path.sep)) {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  }
}

/** One shared instance: multer's disk storage (decorator time) and DI use the same. */
export const driveStorage = new DriveStorage();
