import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ConflictException } from '@nestjs/common';
import {
  accountDeletionSchema,
  MeResponse,
  notificationPreferencesSchema,
  updateProfileSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AllowUnverified, CurrentUser, ReqMeta } from '../../common/decorators';
import { AuthContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuthUser } from '../auth/auth.service';
import { readPreferences } from '../notifications/notifications.service';
import { SupportService } from '../platform/support.service';

@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly support: SupportService,
  ) {}

  private async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      ...toAuthUser(user),
      preferences: readPreferences(user.preferences),
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    };
  }

  @AllowUnverified()
  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.me(user.id);
  }

  @AllowUnverified()
  @Patch()
  async update(@CurrentUser() user: AuthContext, @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, email: true, locale: true } });
    if (body.email) {
      const taken = await this.prisma.user.findFirst({ where: { email: body.email.toLowerCase(), id: { not: user.id } } });
      if (taken) throw new ConflictException('This email is already in use.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fullName: body.fullName, email: body.email === undefined ? undefined : (body.email?.toLowerCase() ?? null), nationalIdLast4: body.nationalIdLast4, locale: body.locale },
    });
    await this.audit.log({ actorUserId: user.id, action: 'user.profile_updated', entityType: 'User', entityId: user.id, before, after: body, meta });
    return this.me(user.id);
  }

  /**
   * Everything ChamaHub holds about the signed-in person, as JSON (Data Protection Act right of
   * access and portability). Only their own records: never other members' details or balances.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  async export(@CurrentUser() user: AuthContext, @Res({ passthrough: true }) res: Response, @ReqMeta() meta: RequestMeta) {
    const id = user.id;
    const [profile, memberships, payments, loans, notifications, sessions, conversations, actions] = await Promise.all([
      this.me(id),
      this.prisma.membership.findMany({ where: { userId: id }, select: { id: true, role: true, specialRoles: true, status: true, shares: true, joinedAt: true, exitedAt: true, group: { select: { name: true, type: true, countryCode: true, currency: true } } } }),
      this.prisma.payment.findMany({ where: { membership: { userId: id } }, select: { id: true, amountCents: true, currency: true, method: true, purpose: true, status: true, reference: true, paidAt: true, createdAt: true, group: { select: { name: true } } }, orderBy: { paidAt: 'desc' } }),
      this.prisma.loan.findMany({ where: { membership: { userId: id } }, select: { id: true, principalCents: true, totalInterestCents: true, status: true, purpose: true, appliedAt: true, disbursedAt: true, installments: { select: { number: true, dueDate: true, principalCents: true, interestCents: true, principalPaidCents: true, interestPaidCents: true, status: true } }, group: { select: { name: true, currency: true } } } }),
      this.prisma.notification.findMany({ where: { userId: id }, select: { type: true, title: true, body: true, createdAt: true, readAt: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
      this.prisma.session.findMany({ where: { userId: id }, select: { deviceName: true, ipAddress: true, createdAt: true, lastUsedAt: true, revokedAt: true } }),
      this.prisma.aiConversation.findMany({ where: { userId: id }, select: { title: true, createdAt: true, messages: { select: { role: true, content: true, createdAt: true } } } }),
      this.prisma.auditEvent.findMany({ where: { actorUserId: id }, select: { action: true, entityType: true, createdAt: true, ipAddress: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    ]);
    await this.audit.log({ actorUserId: id, action: 'user.data_exported', entityType: 'User', entityId: id, meta });
    res.setHeader('Content-Disposition', `attachment; filename="chamahub-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'private, no-store');
    const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));
    return plain({
      exportedAt: new Date().toISOString(),
      note: 'Amounts are in minor units (cents) of the currency shown. Group records about other members are not included.',
      profile,
      memberships,
      payments,
      loans,
      notifications,
      sessions,
      aiConversations: conversations,
      actionsYouTook: actions,
    });
  }

  @Put('preferences')
  async preferences(@CurrentUser() user: AuthContext, @Body(new ZodPipe(notificationPreferencesSchema)) body: z.infer<typeof notificationPreferencesSchema>) {
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: body } });
    return this.me(user.id);
  }

  /**
   * Account deletion is a request, not an immediate erase: group financial
   * records must be preserved, so officers settle obligations and personal
   * data is anonymised after review.
   */
  @HttpCode(200)
  @Post('deletion-request')
  async requestDeletion(@CurrentUser() user: AuthContext, @Body(new ZodPipe(accountDeletionSchema)) body: z.infer<typeof accountDeletionSchema>, @ReqMeta() meta: RequestMeta) {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date(), deletionReason: body.reason ?? null } });
    await this.support.open(user.id, { subject: 'Account deletion request', category: 'ACCOUNT_ACCESS', description: `I asked for my account to be deleted. Reason: ${body.reason ?? 'none given'}` }, meta);
    await this.audit.log({ actorUserId: user.id, action: 'user.deletion_requested', entityType: 'User', entityId: user.id, reason: body.reason, meta });
    return this.me(user.id);
  }

  @Delete('deletion-request')
  async cancelDeletion(@CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null, deletionReason: null } });
    await this.audit.log({ actorUserId: user.id, action: 'user.deletion_cancelled', entityType: 'User', entityId: user.id, meta });
    return this.me(user.id);
  }

  /** Kept for older app versions; new clients use /me/support-cases. */
  @Post('support')
  async supportRequest(@CurrentUser() user: AuthContext, @Body(new ZodPipe(z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(4000), groupId: z.string().optional() }))) body: { subject: string; body: string; groupId?: string }, @ReqMeta() meta: RequestMeta) {
    const c = await this.support.open(user.id, { subject: body.subject, category: 'OTHER', description: body.body, groupId: body.groupId }, meta);
    return { id: c.id, number: c.number, status: c.status };
  }
}
