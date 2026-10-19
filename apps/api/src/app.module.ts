import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { AuditModule } from './common/audit.service';
import { GroupAccessGuard, JwtAuthGuard, PlatformGuard } from './common/guards';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { PrismaModule } from './prisma/prisma.service';
import { LedgerModule } from './modules/ledger/ledger.service';
import { FinanceModule } from './modules/finance/finance.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GroupsModule } from './modules/groups/groups.module';
import { MembersModule } from './modules/members/members.module';
import { HealthController } from './health.controller';

const featureModules = [AuthModule, UsersModule, GroupsModule, MembersModule];

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    LedgerModule,
    FinanceModule,
    NotificationsModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: env().JWT_ACCESS_SECRET, signOptions: { expiresIn: env().ACCESS_TOKEN_TTL_SECONDS } }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.DISABLE_THROTTLE === 'true' }),
    ScheduleModule.forRoot(),
    ...featureModules,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlatformGuard },
    { provide: APP_GUARD, useClass: GroupAccessGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
