import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    await this.assertMigrated();
  }

  /**
   * Refuses to start against a database that is missing migrations shipped with this code, with
   * the command to fix it, instead of failing later with "table does not exist". It never applies
   * migrations itself.
   */
  private async assertMigrated() {
    const dir = [join(process.cwd(), 'prisma', 'migrations'), join(__dirname, '..', '..', 'prisma', 'migrations'), join(__dirname, '..', '..', '..', 'prisma', 'migrations')].find((d) => existsSync(d));
    if (!dir) return; // migrations not shipped next to this build; the deployment applies them
    const expected = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    let applied: string[] = [];
    try {
      applied = (await this.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).map((r) => r.migration_name);
    } catch {
      applied = [];
    }
    const missing = expected.filter((m) => !applied.includes(m));
    if (missing.length) {
      throw new Error(
        `The database is missing ${missing.length} migration(s): ${missing.join(', ')}.\n` +
          'Apply them, then start the API again:\n  cd backend\n  npx prisma migrate deploy\n' +
          '(Back up a production database first.)',
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs a financial operation in a SERIALIZABLE transaction, retrying on
   * serialization conflicts so concurrent writers cannot double-apply money.
   */
  async financial<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 20000,
        });
      } catch (err) {
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2034' || err.code === 'P2028');
        if (!retryable || i >= attempts) throw err;
        await new Promise((r) => setTimeout(r, 25 * i));
      }
    }
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
