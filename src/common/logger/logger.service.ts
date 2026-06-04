import { Injectable, Logger } from '@nestjs/common';
import { LogContext } from './logger.context';
import { LogMeta } from './logger.interface';

@Injectable()
export class AppLogger {
  // ✅ No constructor argument — NestJS DI won't choke
  private readonly logger = new Logger(AppLogger.name);

  forContext(service: string, operation: string, meta: LogMeta = {}) {
    const ctx = new LogContext(service, operation, meta);
    return this._bind(ctx);
  }

  log(ctx: LogContext, message: string, extra: LogMeta = {}) {
    this.logger.log(`${ctx.prefix(extra)} | ${message}`);
  }

  debug(ctx: LogContext, message: string, extra: LogMeta = {}) {
    this.logger.debug(`${ctx.prefix(extra)} | ${message}`);
  }

  warn(ctx: LogContext, message: string, extra: LogMeta = {}) {
    this.logger.warn(`${ctx.prefix(extra)} | ${message}`);
  }

  error(
    ctx: LogContext,
    message: string,
    error?: unknown,
    extra: LogMeta = {},
  ) {
    const stack = error instanceof Error ? error.stack : String(error ?? '');
    this.logger.error(`${ctx.prefix(extra)} | ${message}`, stack);
  }

  verbose(ctx: LogContext, message: string, extra: LogMeta = {}) {
    this.logger.verbose(`${ctx.prefix(extra)} | ${message}`);
  }

  private _bind(ctx: LogContext) {
    const self = this;
    return {
      requestId: ctx.requestId,
      info: (msg: string, extra?: LogMeta) => self.log(ctx, msg, extra),
      debug: (msg: string, extra?: LogMeta) => self.debug(ctx, msg, extra),
      warn: (msg: string, extra?: LogMeta) => self.warn(ctx, msg, extra),
      verbose: (msg: string, extra?: LogMeta) => self.verbose(ctx, msg, extra),
      error: (msg: string, err?: unknown, extra?: LogMeta) =>
        self.error(ctx, msg, err, extra),
      enrich: (data: LogMeta) => self._bind(ctx.enrich(data)),
    };
  }
}
