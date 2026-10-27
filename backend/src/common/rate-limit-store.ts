import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rate-limit counters in Postgres, so every API instance shares one count per caller and route
 * (the default in-memory store counts per instance). One atomic upsert per request; the key is
 * hashed so client IPs are not stored as such. Fails open with a log line if the database is
 * unreachable: account lockout (also in the database) still protects sign-in.
 */
export class DatabaseThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private lastSweep = 0;

  constructor(private readonly prisma: PrismaService) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const id = createHash('sha256').update(`${throttlerName}:${key}`).digest('base64url');
    try {
      const [row] = await this.prisma.$queryRaw<{ hits: number; expiresAt: Date }[]>`
        INSERT INTO "rate_limit_buckets" ("key", "hits", "expiresAt") VALUES (${id}, 1, now() + ${ttl} * interval '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE WHEN "rate_limit_buckets"."expiresAt" <= now() THEN 1 ELSE "rate_limit_buckets"."hits" + 1 END,
          "expiresAt" = CASE WHEN "rate_limit_buckets"."expiresAt" <= now() THEN now() + ${ttl} * interval '1 millisecond' ELSE "rate_limit_buckets"."expiresAt" END
        RETURNING "hits", "expiresAt"`;
      this.sweep();
      const timeToExpire = Math.max(0, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
      const isBlocked = row.hits > limit;
      return { totalHits: row.hits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? timeToExpire : 0 };
    } catch (err) {
      this.logger.error(`Rate-limit store unavailable, allowing request: ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  /** Deletes expired counters at most once a minute per instance. */
  private sweep() {
    if (Date.now() - this.lastSweep < 60_000) return;
    this.lastSweep = Date.now();
    void this.prisma.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "expiresAt" < now() - interval '1 minute'`.catch(() => undefined);
  }
}
