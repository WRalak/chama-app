import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetEnvCache } from '../src/config/env';
import { DatabaseThrottlerStorage } from '../src/common/rate-limit-store';
import { api, createTestApp, resetDatabase, uniquePhone } from './helpers';

/**
 * Rate limits with the shared (database) store: two API instances count together, counters
 * reset after their window, and a real endpoint answers 429 once its limit is used up.
 */
describe('Shared rate limits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved = { DISABLE_THROTTLE: process.env.DISABLE_THROTTLE, RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE };

  beforeAll(async () => {
    process.env.DISABLE_THROTTLE = 'false';
    process.env.RATE_LIMIT_STORE = 'database';
    resetEnvCache();
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    await prisma.$executeRaw`DELETE FROM "rate_limit_buckets"`;
  });
  afterAll(async () => {
    Object.assign(process.env, saved);
    resetEnvCache();
    await app.close();
  });

  it('counts across instances and resets after the window', async () => {
    const one = new DatabaseThrottlerStorage(prisma);
    const two = new DatabaseThrottlerStorage(prisma);
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(await one.increment('ip-1:route', 500, 4, 500, 'default'), await two.increment('ip-1:route', 500, 4, 500, 'default'));
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hits[3].isBlocked).toBe(false);
    expect(hits[4].isBlocked).toBe(true);
    // The caller's address is not stored in readable form.
    const keys = await prisma.$queryRaw<{ key: string }[]>`SELECT "key" FROM "rate_limit_buckets"`;
    expect(keys.some((k) => k.key.includes('ip-1'))).toBe(false);
    await new Promise((r) => setTimeout(r, 600));
    expect((await one.increment('ip-1:route', 500, 4, 500, 'default')).totalHits).toBe(1);
  });

  it('holds under a burst of simultaneous requests', async () => {
    const s = new DatabaseThrottlerStorage(prisma);
    const all = await Promise.all(Array.from({ length: 25 }, () => s.increment('burst', 60_000, 10, 60_000, 'default')));
    expect(all.map((r) => r.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(all.filter((r) => !r.isBlocked)).toHaveLength(10);
  });

  it('answers 429 on a sensitive endpoint once its limit is used', async () => {
    await prisma.$executeRaw`DELETE FROM "rate_limit_buckets"`;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await api(app).post('/v1/auth/otp/request').send({ phone: uniquePhone(), purpose: 'RESET_PASSWORD' })).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // The app itself used the shared store.
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "rate_limit_buckets"`;
    expect(Number(n)).toBeGreaterThan(0);
  });
});
