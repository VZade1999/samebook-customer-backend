import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { CacheService, companyScope } from './cache.service';

export const INVALIDATES_CACHE = 'invalidates_cache';

/**
 * Marks a controller (or a single route) whose successful non-GET requests
 * change data cached under these topics. Topics are per company ("tasks" ->
 * c<companyId>:tasks) unless they start with "g:" (global).
 * `@InvalidatesCache()` with no topics on a route opts that route out.
 */
export const InvalidatesCache = (...topics: string[]) => SetMetadata(INVALIDATES_CACHE, topics);

/**
 * Global interceptor: bumps the topics BEFORE the response goes out, so a
 * client that re-fetches right after saving never gets the old cached copy.
 * Works with handlers that write the response themselves via @Res().
 */
@Injectable()
export class CacheBumpInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    if (ctx.getType() !== 'http') return next.handle();
    const topics = this.reflector.getAllAndOverride<string[] | undefined>(INVALIDATES_CACHE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    if (!topics?.length || req.method === 'GET' || req.method === 'HEAD' || !this.cache.enabled) {
      return next.handle();
    }
    const companyId = req.user?.company_id;
    const scopes = topics
      .map((t) => (t.startsWith('g:') ? t : companyId ? companyScope(companyId, t) : null))
      .filter((s): s is string => !!s);
    if (!scopes.length) return next.handle();

    const originalSend = res.send.bind(res);
    let handled = false;
    res.send = (body: any) => {
      if (handled || res.statusCode >= 400) return originalSend(body);
      handled = true;
      this.cache.bump(...scopes).finally(() => originalSend(body));
      return res;
    };
    return next.handle();
  }
}
