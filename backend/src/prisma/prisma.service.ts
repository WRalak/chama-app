import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
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
