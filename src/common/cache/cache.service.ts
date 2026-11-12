import { Injectable } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { createHash } from 'crypto';
import { AppLogger } from '../logger/logger.service';

/**
 * Shared Redis cache (Upstash, over HTTPS — fits Vercel functions).
 *
 * Design rules:
 *  - Optional: without KV_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_*), or with
 *    CACHE_DISABLED=true, every call just runs the loader against the DB.
 *  - Never makes things worse: each Redis call has a short timeout, and after
 *    repeated failures Redis is skipped for 30 s (circuit breaker).
 *  - Invalidation by versioned scopes: a scope is "c<companyId>:<topic>"
 *    (or "g:<topic>" for global data). bump(scope) increments its version; a
 *    cached entry remembers the versions it was built under and is ignored once
 *    any of them moved on. A read is ONE round trip (MGET of value + versions).
 *  - Values must be JSON (dates come back as ISO strings): cache only results
 *    that go straight into an HTTP response.
 *
 * Local development and production share one database, and therefore share
 * this cache too, so a change made on either side invalidates both.
 */

const PREFIX = 'sb:';
const OP_TIMEOUT_MS = Number(process.env.CACHE_TIMEOUT_MS) || 600;
const BREAKER_MS = 30_000;
const MAX_VALUE_BYTES = 512 * 1024;
const VERSION_TTL_S = 30 * 24 * 3600;
const L1_MAX = 500;

export interface CacheOptions {
  /** Version scopes the value depends on, e.g. ['c1:tasks']. */
  scopes: string[];
  /** Key inside the first scope, e.g. 'u5:summary:2026-11-12'. */
  key: string;
  /** Redis expiry (seconds): the safety net if a bump is ever missed. */
  ttl: number;
  /**
   * Optional per-process memory cache (ms) in front of Redis for very hot,
   * cheap values. Other servers' bumps are seen only after it expires, so
   * keep it to a few seconds.
   */
  l1Ms?: number;
  /** Store the loaded value only if this returns true (e.g. skip errors). */
  cacheIf?: (value: any) => boolean;
}

interface Entry<T> {
  v: string;
  d: T;
}

export const companyScope = (companyId: number | string, topic: string) => `c${Number(companyId)}:${topic}`;

/** Short stable hash, for cache keys built from permissions or query params. */
export const keyHash = (value: unknown) =>
  createHash('sha1')
    .update(typeof value === 'string' ? value : JSON.stringify(value ?? null))
    .digest('base64url')
    .slice(0, 12);

/**
 * Cached response for a GET route of a request-scoped service: the key covers
 * the user, their permissions (what they may see) and the query, so nothing
 * is ever shared between people who would get different answers. Failed
 * results (403/404...) are not stored.
 */
export const routeCacheOptions = (
  req: { user?: any },
  topic: string,
  route: string,
  params: unknown,
  ttl = 120,
): CacheOptions => {
  const u = req.user || {};
  const perms = [...(u.permissions || [])].sort();
  return {
    scopes: [companyScope(u.company_id, topic), companyScope(u.company_id, 'access')],
    key: `u${Number(u.user_id)}:${keyHash(perms)}:${route}:${keyHash(params)}`,
    ttl,
    cacheIf: (r: any) => !!r?.success,
  };
};

@Injectable()
export class CacheService {
  private client: Redis | null | undefined;
  private failures = 0;
  private breakerUntil = 0;
  private readonly l1 = new Map<string, { exp: number; v: string; d: any }>();
  readonly stats = { hits: 0, misses: 0, errors: 0, skipped: 0, bumps: 0 };

  constructor(private readonly appLogger: AppLogger) {}

  /** Lazily built so .env.local / Vercel env are loaded first. */
  private get redis(): Redis | null {
    if (this.client !== undefined) return this.client;
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    const disabled = String(process.env.CACHE_DISABLED || '').toLowerCase() === 'true';
    this.client = url && token && !disabled ? new Redis({ url, token, retry: { retries: 0 } }) : null;
    return this.client;
  }

  get enabled(): boolean {
    return !!this.redis;
  }

  private get available(): boolean {
    if (!this.redis) return false;
    if (Date.now() < this.breakerUntil) {
      this.stats.skipped++;
      return false;
    }
    return true;
  }

  /**
   * One Redis call with a timeout. `critical` calls (reads a request waits
   * for, bumps) count towards the breaker; background writes don't, so a slow
   * fire-and-forget SET can't switch caching off while reads are fine.
   */
  private async op<T>(fn: (r: Redis) => Promise<T>, critical = true): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        fn(this.redis!),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Redis timeout after ${OP_TIMEOUT_MS} ms`)), OP_TIMEOUT_MS);
        }),
      ]);
      if (critical) this.failures = 0;
      return result;
    } catch (err) {
      this.stats.errors++;
      if (critical && ++this.failures >= 3) {
        this.breakerUntil = Date.now() + BREAKER_MS;
        this.failures = 0;
        this.appLogger
          .forContext('CacheService', 'op', {})
          .warn(`Redis unavailable — using the database directly for ${BREAKER_MS / 1000}s`, { error: String(err) });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private dataKey(o: CacheOptions) {
    return `${PREFIX}${o.scopes[0]}:${o.key}`;
  }
  private versionKey(scope: string) {
    return `${PREFIX}ver:${scope}`;
  }

  /** Cached value of loader() for these scopes/key; the loader runs on a miss. */
  async wrap<T>(o: CacheOptions, loader: () => Promise<T>): Promise<T> {
    const dataKey = this.dataKey(o);
    const now = Date.now();
    if (o.l1Ms) {
      const hit = this.l1.get(dataKey);
      if (hit && hit.exp > now) {
        this.stats.hits++;
        return hit.d as T;
      }
    }
    if (!this.available) return loader();

    let version: string | null = null;
    try {
      const [entry, ...versions] = await this.op((r) =>
        r.mget<[Entry<T> | null, ...(number | null)[]]>(dataKey, ...o.scopes.map((s) => this.versionKey(s))),
      );
      version = versions.map((v) => Number(v || 0)).join('.');
      if (entry && entry.v === version) {
        this.stats.hits++;
        if (o.l1Ms) this.remember(dataKey, version, entry.d, o.l1Ms);
        return entry.d;
      }
    } catch {
      return loader(); // Redis trouble: behave as if there were no cache.
    }

    this.stats.misses++;
    const data = await loader();
    if (data !== undefined && (!o.cacheIf || o.cacheIf(data))) {
      const payload: Entry<T> = { v: version!, d: data };
      const size = JSON.stringify(payload).length;
      if (size <= MAX_VALUE_BYTES) {
        // Written with the versions read BEFORE loading: if a bump happened in
        // between, this entry is already stale and will simply be ignored.
        void this.op((r) => r.set(dataKey, payload, { ex: o.ttl }), false).catch(() => undefined);
        if (o.l1Ms) this.remember(dataKey, version!, data, o.l1Ms);
      }
    }
    return data;
  }

  private remember(key: string, v: string, d: any, ms: number) {
    if (this.l1.size >= L1_MAX) this.l1.delete(this.l1.keys().next().value as string);
    this.l1.set(key, { exp: Date.now() + ms, v, d });
  }

  /**
   * Invalidates everything cached under these scopes (all servers). Call it
   * AFTER the database change is committed. Never throws.
   */
  async bump(...scopes: string[]): Promise<void> {
    const list = [...new Set(scopes.filter(Boolean))];
    if (!list.length) return;
    // This process's memory copies go immediately.
    for (const key of this.l1.keys()) {
      if (list.some((s) => key.startsWith(`${PREFIX}${s}:`))) this.l1.delete(key);
    }
    if (!this.redis) return;
    this.stats.bumps++;
    try {
      await this.op((r) => {
        const p = r.pipeline();
        for (const s of list) {
          p.incr(this.versionKey(s));
          p.expire(this.versionKey(s), VERSION_TTL_S);
        }
        return p.exec();
      });
    } catch (err) {
      // Entries expire by TTL anyway; worth a log line.
      this.appLogger.forContext('CacheService', 'bump', { scopes: list }).warn('Cache bump failed', { error: String(err) });
    }
  }

  status() {
    return {
      enabled: this.enabled,
      breaker_open: Date.now() < this.breakerUntil,
      l1_entries: this.l1.size,
      ...this.stats,
    };
  }
}
