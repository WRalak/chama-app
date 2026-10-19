import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationSchema, planSchema, PlatformOverview, PlatformPermission, reasonSchema, supportAccessRequestSchema } from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, ReqMeta, RequirePlatform } from '../../common/decorators';
import { n, big } from '../../common/money';
import { paginate, skipTake } from '../../common/pagination';
import { AuthContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { emailConfigured, env, mpesaConfigured, smsConfigured, whatsappConfigured } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toAuditRow } from '../audit/audit.controller';

const SECURITY_ACTIONS = ['auth.login_failed', 'auth.refresh_reuse_detected', 'auth.password_reset', 'support.access', 'platform.', 'member.role_changed'];
const listQuery = paginationSchema.extend({ q: z.string().trim().max(80).optional() });

/**
 * SaaS administration. Platform admins see group metadata (name, size,
 * plan) but never group finances; reading a group's books requires a
 * support grant approved by that group's chairperson.
 */
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @RequirePlatform(PlatformPermission.PLATFORM_VIEW_STATS)
  @Get('overview')
  async overview(): Promise<PlatformOverview> {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const since24 = new Date(Date.now() - 86_400_000);
    let database: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const [totalGroups, activeGroups, totalUsers, newUsers, subs, failedJobs, failedDeliveries, openTickets, security] = await Promise.all([
      this.prisma.group.count(),
      this.prisma.group.count({ where: { status: 'ACTIVE', journalEntries: { some: { createdAt: { gte: since30 } } } } }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since30 } } }),
      this.prisma.subscription.findMany({ include: { plan: { select: { priceCents: true } } } }),
      this.prisma.jobRun.count({ where: { status: 'FAILED', startedAt: { gte: since24 } } }),
      this.prisma.notificationDelivery.count({ where: { status: 'FAILED', createdAt: { gte: since24 } } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.auditEvent.findMany({ where: { OR: SECURITY_ACTIONS.map((a) => ({ action: { startsWith: a } })) }, include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const bySubStatus: Record<string, number> = {};
    for (const s of subs) bySubStatus[s.status] = (bySubStatus[s.status] ?? 0) + 1;
    const e = env();
    return {
      totalGroups,
      activeGroups,
      totalUsers,
      newUsers30d: newUsers,
      subscriptions: bySubStatus,
      monthlyRecurringRevenueCents: subs.filter((s) => s.status === 'ACTIVE').reduce((a, s) => a + n(s.plan.priceCents), 0),
      failedJobs24h: failedJobs + failedDeliveries,
      openSupportRequests: openTickets,
      health: {
        database,
        integrations: [
          { name: 'M-Pesa Daraja', configured: mpesaConfigured(), status: mpesaConfigured() ? `Configured (${e.MPESA_ENV}) — not verified in production` : 'Not configured' },
          { name: "SMS (Africa's Talking)", configured: smsConfigured(), status: smsConfigured() ? 'Configured' : 'Not configured — SMS is not being sent' },
          { name: 'WhatsApp Business', configured: whatsappConfigured(), status: whatsappConfigured() ? 'Configured' : 'Not configured' },
          { name: 'Email relay', configured: emailConfigured(), status: emailConfigured() ? 'Configured' : 'Not configured' },
        ],
      },
      securityEvents: security.map(toAuditRow),
    };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_VIEW_STATS)
  @Get('groups')
  async groups(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.GroupWhereInput = q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {};
    const [rows, total] = await Promise.all([
      this.prisma.group.findMany({ where, include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }, subscription: { include: { plan: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.group.count({ where }),
    ]);
    return paginate(
      rows.map((g) => ({ id: g.id, name: g.name, type: g.type, status: g.status, county: g.county, members: g._count.memberships, createdAt: g.createdAt.toISOString(), plan: g.subscription?.plan.name ?? null, subscriptionStatus: g.subscription?.status ?? null, currentPeriodEnd: g.subscription?.currentPeriodEnd?.toISOString() ?? null })),
      total,
      q.page,
      q.pageSize,
    );
  }

  @RequirePlatform(PlatformPermission.PLATFORM_MANAGE_PLANS)
  @Patch('groups/:groupId/subscription')
  async subscription(@Param('groupId') groupId: string, @Body(new ZodPipe(z.object({ planId: z.string(), status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']), currentPeriodEnd: z.string().datetime().optional() }))) body: { planId: string; status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'; currentPeriodEnd?: string }, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.subscription.findUnique({ where: { groupId } });
    const s = await this.prisma.subscription.upsert({
      where: { groupId },
      create: { groupId, planId: body.planId, status: body.status, currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null },
      update: { planId: body.planId, status: body.status, currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : undefined },
    });
    await this.audit.log({ groupId, actorUserId: user.id, action: 'platform.subscription_changed', entityType: 'Subscription', entityId: s.id, before, after: s, meta });
    return { ok: true };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_VIEW_STATS)
  @Get('plans')
  async plans() {
    const rows = await this.prisma.plan.findMany({ orderBy: { priceCents: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
    return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, priceCents: n(p.priceCents), maxMembers: p.maxMembers, features: p.features as string[], active: p.active, subscribers: p._count.subscriptions }));
  }

  @RequirePlatform(PlatformPermission.PLATFORM_MANAGE_PLANS)
  @Post('plans')
  async createPlan(@Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    const p = await this.prisma.plan.create({ data: { ...body, priceCents: big(body.priceCents) } });
    await this.audit.log({ actorUserId: user.id, action: 'platform.plan_created', entityType: 'Plan', entityId: p.id, after: body, meta });
    return { id: p.id };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_MANAGE_PLANS)
  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body(new ZodPipe(planSchema.partial())) body: Partial<z.infer<typeof planSchema>>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.plan.findUniqueOrThrow({ where: { id } });
    await this.prisma.plan.update({ where: { id }, data: { ...body, priceCents: body.priceCents === undefined ? undefined : big(body.priceCents) } });
    await this.audit.log({ actorUserId: user.id, action: 'platform.plan_updated', entityType: 'Plan', entityId: id, before, after: body, meta });
    return { ok: true };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_MANAGE_ACCOUNTS)
  @Get('users')
  async users(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const where: Prisma.UserWhereInput = q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: { _count: { select: { memberships: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows.map((u) => ({ id: u.id, fullName: u.fullName, phone: u.phone, email: u.email, platformRole: u.platformRole, phoneVerified: !!u.phoneVerifiedAt, groups: u._count.memberships, disabled: !!u.disabledAt, deletionRequestedAt: u.deletionRequestedAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() })), total, q.page, q.pageSize);
  }

  @RequirePlatform(PlatformPermission.PLATFORM_MANAGE_ACCOUNTS)
  @HttpCode(200)
  @Post('users/:id/status')
  async userStatus(@Param('id') id: string, @Body(new ZodPipe(z.object({ disabled: z.boolean(), reason: reasonSchema }))) body: { disabled: boolean; reason: string }, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    if (id === user.id) throw new ForbiddenException('You cannot disable your own account');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { disabledAt: body.disabled ? new Date() : null } }),
      ...(body.disabled ? [this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'account_disabled' } })] : []),
    ]);
    await this.audit.log({ actorUserId: user.id, action: body.disabled ? 'platform.user_disabled' : 'platform.user_enabled', entityType: 'User', entityId: id, reason: body.reason, meta });
    return { ok: true };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_SUPPORT)
  @Get('support-tickets')
  async tickets(@Query('status') status?: string) {
    const rows = await this.prisma.supportTicket.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter(Boolean) as string[] } }, select: { id: true, fullName: true, phone: true } });
    const u = new Map(users.map((x) => [x.id, x]));
    return rows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), user: t.userId ? (u.get(t.userId) ?? null) : null }));
  }

  @RequirePlatform(PlatformPermission.PLATFORM_SUPPORT)
  @Patch('support-tickets/:id')
  async updateTicket(@Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']) }))) body: { status: string }, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    await this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
    await this.audit.log({ actorUserId: user.id, action: 'platform.ticket_updated', entityType: 'SupportTicket', entityId: id, after: body, meta });
    return { ok: true };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_VIEW_SECURITY)
  @Get('audit')
  async securityAudit(@Query(new ZodPipe(paginationSchema)) q: z.infer<typeof paginationSchema>) {
    // Platform-level events only; group-level financial history stays with the group.
    const where: Prisma.AuditEventWhereInput = { OR: [{ groupId: null }, ...SECURITY_ACTIONS.map((a) => ({ action: { startsWith: a } }))] };
    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return paginate(rows.map((r) => ({ ...toAuditRow(r), before: null, after: r.groupId ? null : r.after })), total, q.page, q.pageSize);
  }

  @RequirePlatform(PlatformPermission.PLATFORM_VIEW_STATS)
  @Get('jobs')
  async jobs() {
    const rows = await this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    return rows.map((j) => ({ ...j, startedAt: j.startedAt.toISOString(), finishedAt: j.finishedAt.toISOString() }));
  }

  /* ---- privileged access, purpose-limited and approved by the group ---- */

  @RequirePlatform(PlatformPermission.PLATFORM_SUPPORT)
  @Post('support-access')
  async requestAccess(@Body(new ZodPipe(supportAccessRequestSchema)) body: z.infer<typeof supportAccessRequestSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    const group = await this.prisma.group.findUnique({ where: { id: body.groupId }, select: { id: true, name: true } });
    if (!group) throw new NotFoundException('Group not found');
    const g = await this.prisma.supportAccessGrant.create({ data: { groupId: body.groupId, requestedByUserId: user.id, purpose: body.purpose, hours: body.hours } });
    await this.audit.log({ groupId: body.groupId, actorUserId: user.id, action: 'platform.support_access_requested', entityType: 'SupportAccessGrant', entityId: g.id, reason: body.purpose, approvalStatus: 'PENDING', meta });
    const chairs = await this.notifications.groupUserIds(body.groupId, ['CHAIRPERSON']);
    await this.notifications.notify(chairs, { groupId: body.groupId, type: 'APPROVAL_REQUIRED', title: 'ChamaHub support requests read access', body: `Purpose: ${body.purpose}. Access lasts ${body.hours} hour(s) if you approve.` });
    return { id: g.id, status: g.status };
  }

  @RequirePlatform(PlatformPermission.PLATFORM_SUPPORT)
  @Get('support-access')
  async myGrants(@CurrentUser() user: AuthContext) {
    const rows = await this.prisma.supportAccessGrant.findMany({ where: { requestedByUserId: user.id }, include: { group: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((g) => ({ id: g.id, groupId: g.groupId, groupName: g.group.name, purpose: g.purpose, status: g.expiresAt && g.expiresAt < new Date() && g.status === 'APPROVED' ? 'EXPIRED' : g.status, expiresAt: g.expiresAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString() }));
  }
}
