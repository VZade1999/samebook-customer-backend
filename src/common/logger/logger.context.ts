import { v4 as uuidv4 } from 'uuid';
import { LogMeta } from './logger.interface';

/**
 * LogContext is a small helper you create once per request / operation.
 * It holds all shared metadata so every log call is consistent.
 *
 * Usage:
 *   const ctx = new LogContext('AuthService', 'login', { email, ip, requestId });
 *   ctx.info('User found');
 *   ctx.warn('Password mismatch');
 */
export class LogContext {
  readonly requestId: string;
  private readonly service: string;
  private readonly operation: string;
  private readonly meta: LogMeta;

  constructor(service: string, operation: string, meta: LogMeta = {}) {
    this.service = service;
    this.operation = operation;
    this.requestId = meta.requestId ?? uuidv4();
    this.meta = { ...meta, requestId: this.requestId };
  }

  /** Returns a formatted prefix: [AuthService.login] requestId=xxx email=yyy */
  prefix(extra: LogMeta = {}): string {
    const merged = { ...this.meta, ...extra };
    const pairs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    return `[${this.service}.${this.operation}] ${pairs}`;
  }

  /** Enrich the context with more fields later (e.g., after userId is known) */
  enrich(data: LogMeta): LogContext {
    return new LogContext(this.service, this.operation, {
      ...this.meta,
      ...data,
    });
  }
}
