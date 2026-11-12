import { CacheService, companyScope } from './cache.service';

/** In-memory stand-in for the Upstash client (just what CacheService uses). */
class FakeRedis {
  store = new Map<string, any>();
  calls = 0;
  failing = false;
  delayMs = 0;
  private async tick() {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failing) throw new Error('redis down');
  }
  async mget(...keys: string[]) {
    await this.tick();
    return keys.map((k) => (this.store.has(k) ? JSON.parse(JSON.stringify(this.store.get(k))) : null));
  }
  async set(key: string, value: any) {
    await this.tick();
    this.store.set(key, value);
    return 'OK';
  }
  pipeline() {
    const ops: (() => void)[] = [];
    const p = {
      incr: (k: string) => {
        ops.push(() => this.store.set(k, Number(this.store.get(k) || 0) + 1));
        return p;
      },
      expire: () => p,
      exec: async () => {
        await this.tick();
        ops.forEach((o) => o());
        return [];
      },
    };
    return p;
  }
}

const logger: any = { forContext: () => ({ warn: () => undefined, info: () => undefined, error: () => undefined }) };
const make = () => {
  const svc = new CacheService(logger);
  const fake = new FakeRedis();
  (svc as any).client = fake;
  return { svc, fake };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const opts = (extra: any = {}) => ({ scopes: [companyScope(1, 'tasks')], key: 'u5:summary', ttl: 60, ...extra });

describe('CacheService', () => {
  it('serves the second read from Redis', async () => {
    const { svc } = make();
    const loader = jest.fn().mockResolvedValue({ open: 3 });
    expect(await svc.wrap(opts(), loader)).toEqual({ open: 3 });
    await flush();
    expect(await svc.wrap(opts(), loader)).toEqual({ open: 3 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(svc.stats.hits).toBe(1);
  });

  it('bump invalidates every entry of the scope, only for that company', async () => {
    const { svc } = make();
    let n = 1;
    const loader = jest.fn(async () => n);
    const other = { scopes: [companyScope(2, 'tasks')], key: 'u9:summary', ttl: 60 };
    await svc.wrap(opts(), loader);
    await svc.wrap(other, loader);
    await flush();
    n = 2;
    await svc.bump(companyScope(1, 'tasks'));
    expect(await svc.wrap(opts(), loader)).toBe(2); // company 1 reloads
    expect(await svc.wrap(other, loader)).toBe(1); // company 2 untouched
  });

  it('an entry depends on all its scopes (e.g. global access)', async () => {
    const { svc } = make();
    let v = 'a';
    const o = { scopes: [companyScope(1, 'access'), 'g:access'], key: 'u1:roles', ttl: 60 };
    await svc.wrap(o, async () => v);
    await flush();
    v = 'b';
    await svc.bump('g:access');
    expect(await svc.wrap(o, async () => v)).toBe('b');
  });

  it('a value loaded while a bump happened is never served afterwards', async () => {
    const { svc } = make();
    const stale = await svc.wrap(opts(), async () => {
      await svc.bump(companyScope(1, 'tasks')); // write committed mid-load
      return 'old';
    });
    expect(stale).toBe('old'); // this request gets what it read...
    await flush();
    expect(await svc.wrap(opts(), async () => 'new')).toBe('new'); // ...but nobody after it
  });

  it('falls back to the database when Redis fails, then stops trying (breaker)', async () => {
    const { svc, fake } = make();
    fake.failing = true;
    const loader = jest.fn().mockResolvedValue('db');
    for (let i = 0; i < 3; i++) expect(await svc.wrap(opts(), loader)).toBe('db');
    const callsAfterTrip = fake.calls;
    expect(await svc.wrap(opts(), loader)).toBe('db');
    expect(fake.calls).toBe(callsAfterTrip); // breaker open: Redis not called
    expect(svc.status().breaker_open).toBe(true);
    await expect(svc.bump('c1:tasks')).resolves.toBeUndefined(); // never throws
  });

  it('a slow Redis times out instead of slowing the request', async () => {
    const { svc, fake } = make();
    fake.delayMs = 2000;
    const t = Date.now();
    expect(await svc.wrap(opts(), async () => 'db')).toBe('db');
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it('does not store values above 512 KB', async () => {
    const { svc, fake } = make();
    await svc.wrap(opts(), async () => 'x'.repeat(600 * 1024));
    await flush();
    expect([...fake.store.keys()].some((k) => k.includes('u5:summary'))).toBe(false);
  });

  it('memory layer (l1) answers without Redis and is cleared by a local bump', async () => {
    const { svc, fake } = make();
    let v = 1;
    const o = opts({ l1Ms: 5000 });
    await svc.wrap(o, async () => v);
    await flush();
    const calls = fake.calls;
    expect(await svc.wrap(o, async () => v)).toBe(1);
    expect(fake.calls).toBe(calls);
    v = 2;
    await svc.bump(companyScope(1, 'tasks'));
    expect(await svc.wrap(o, async () => v)).toBe(2);
  });

  it('is a no-op without Redis configured', async () => {
    const svc = new CacheService(logger);
    (svc as any).client = null;
    const loader = jest.fn().mockResolvedValue(7);
    expect(await svc.wrap(opts(), loader)).toBe(7);
    expect(await svc.wrap(opts(), loader)).toBe(7);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(svc.enabled).toBe(false);
  });
});
