import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maskPhone, paginationSchema, PlatformAuditRow, PlatformPermission, platformSettingsSchema, reasonSchema, supportAccessRequestSchema } from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentStaff, PlatformApi, Public, ReqMeta, RequireAnyPlatform, RequirePlatform, RequireRecentAuth } from '../../common/decorators';
import { n } from '../../common/money';
import { paginate, skipTake } from '../../common/pagination';
import { RequestMeta, StaffContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { aiConfigured, emailConfigured, env, mpesaConfigured, smsConfigured, whatsappConfigured } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from '../auth/otp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformAuditService } from '../platform-auth/platform-audit.service';
import { DashboardService } from './dashboard.service';
import { PlatformSettingsService } from './platform-settings.service';

const PP = PlatformPermission;
const listQuery = paginationSchema.extend({ q: z.string().trim().max(80).optional() });
const userQuery = listQuery.extend({ status: z.enum(['active', 'disabled', 'locked', 'deletion_requested']).optional() });
const groupQuery = listQuery.extend({ status: z.enum(['ACTIVE', 'ARCHIVED', 'SUSPENDED']).optional(), country: z.string().length(2).toUpperCase().optional(), plan: z.string().max(40).optional() });
const reasonBody = z.object({ reason: reasonSchema });
const interventionSchema = z.object({
  kind: z.enum(['NOTE', 'CONTACTED_OFFICERS', 'BILLING_ADJUSTMENT_REQUESTED', 'FRAUD_REVIEW', 'ESCALATION']),
  note: z.string().trim().min(5).max(2000),
});
const dateRange = z.object({ from: z.string().date().optional(), to: z.string().date().optional() });
const auditQuery = paginationSchema.extend({
  actor: z.string().max(60).optional(),
  action: z.string().max(80).optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  targetType: z.string().max(60).optional(),
  targetId: z.string().max(80).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
const SECURITY_ACTIONS = ['platform.login', 'platform.account_locked', 'platform.permission_denied', 'platform.password_', 'platform.mfa_', 'platform.staff_sessions_revoked', 'platform.user_sessions_revoked', 'platform.staff_suspended', 'platform.staff_access_changed', 'platform.owner_bootstrap', 'platform.support_access', 'security.alert'];
const MEMBER_SECURITY_ACTIONS = ['auth.login_failed', 'auth.refresh_reuse_detected', 'auth.password_reset'];

/**
 * The platform portal's operations API. Staff see metadata about users and groups, never a
 * group's money; reading a group's records needs a time-limited grant approved by that group.
 */
@PlatformApi()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly groupAudit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
    private readonly otp: OtpService,
    private readonly dashboard: DashboardService,
  ) {}

  /* ---------------- overview ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_STATS)
  @Get('dashboard')
  async getDashboard(@Query(new ZodPipe(dateRange)) q: z.infer<typeof dateRange>, @CurrentStaff() staff: StaffContext) {
    const to = q.to ? new Date(`${q.to}T00:00:00Z`) : new Date();
    if (q.to) to.setUTCDate(to.getUTCDate() + 1);
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 90 * 86_400_000);
    if (from >= to) throw new BadRequestException('The start date must be before the end date.');
    if (to.getTime() - from.getTime() > 3 * 366 * 86_400_000) throw new BadRequestException('Choose a range of three years or less.');
    return this.dashboard.build(from, to, staff.permissions.includes(PP.PLATFORM_VIEW_REVENUE));
  }

  /** Top-bar search: each section only appears when the caller may see it. */
  @Get('search')
  async search(@Query(new ZodPipe(z.object({ q: z.string().trim().min(2).max(80) }))) { q }: { q: string }, @CurrentStaff() staff: StaffContext) {
    const can = (p: PlatformPermission) => staff.permissions.includes(p);
    const digits = q.replace(/\D/g, '');
    const [users, groups, cases, people] = await Promise.all([
      can(PP.PLATFORM_VIEW_USERS)
        ? this.prisma.user.findMany({ where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { email: { contains: q.toLowerCase() } }] }, select: { id: true, fullName: true, phone: true }, take: 5 })
        : [],
      can(PP.PLATFORM_VIEW_GROUPS) ? this.prisma.group.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: q }] }, select: { id: true, name: true, countryCode: true }, take: 5 }) : [],
      can(PP.PLATFORM_SUPPORT)
        ? this.prisma.supportCase.findMany({
            where: { AND: [{ OR: [{ number: { contains: q.toUpperCase() } }, { subject: { contains: q, mode: 'insensitive' } }] }, can(PP.PLATFORM_SUPPORT_MANAGE) ? {} : { assignedToId: staff.accountId }] },
            select: { id: true, number: true, subject: true, status: true },
            take: 5,
          })
        : [],
      can(PP.PLATFORM_MANAGE_HELPERS) ? this.prisma.platformAccount.findMany({ where: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q.toLowerCase() } }] }, select: { id: true, fullName: true, email: true }, take: 5 }) : [],
    ]);
    return {
      users: users.map((u) => ({ id: u.id, name: u.fullName, phoneMasked: maskPhone(u.phone) })),
      groups,
      cases,
      staff: people.map((p) => ({ id: p.id, name: p.fullName, email: p.email })),
    };
  }

  /** What needs the caller's attention, for the bell in the top bar. Counts only what they can act on. */
  @Get('notifications')
  async attention(@CurrentStaff() staff: StaffContext) {
    const can = (p: PlatformPermission) => staff.permissions.includes(p);
    const open = { notIn: ['RESOLVED', 'CLOSED'] as ('RESOLVED' | 'CLOSED')[] };
    const items: { key: string; label: string; count: number; href: string }[] = [];
    if (can(PP.PLATFORM_SUPPORT)) {
      items.push({ key: 'mine', label: 'Cases assigned to you', count: await this.prisma.supportCase.count({ where: { assignedToId: staff.accountId, status: open } }), href: '/platform/support/mine' });
      items.push({ key: 'reply', label: 'Users replied — your turn', count: await this.prisma.supportCase.count({ where: { assignedToId: staff.accountId, status: 'IN_PROGRESS', messages: { some: { authorUserId: { not: null } } } } }), href: '/platform/support/mine' });
    }
    if (can(PP.PLATFORM_SUPPORT_MANAGE)) {
      items.push({ key: 'unassigned', label: 'Unassigned cases', count: await this.prisma.supportCase.count({ where: { assignedToId: null, status: open } }), href: '/platform/support?scope=unassigned' });
      items.push({ key: 'escalated', label: 'Escalated cases', count: await this.prisma.supportCase.count({ where: { status: 'ESCALATED' } }), href: '/platform/support?status=ESCALATED' });
    }
    if (can(PP.PLATFORM_REQUEST_GROUP_ACCESS)) {
      items.push({ key: 'grants', label: 'Group access approved for you', count: await this.prisma.supportAccessGrant.count({ where: { requestedByAccountId: staff.accountId, status: 'APPROVED', expiresAt: { gt: new Date() } } }), href: '/platform/support/access' });
    }
    if (can(PP.PLATFORM_VIEW_BILLING)) {
      items.push({ key: 'billing', label: 'Open billing cases', count: await this.prisma.billingCase.count({ where: { status: { not: 'RESOLVED' } } }), href: '/platform/billing' });
    }
    if (can(PP.PLATFORM_VIEW_SECURITY)) {
      items.push({ key: 'security', label: 'Failed staff sign-ins (24 h)', count: await this.prisma.platformAuditLog.count({ where: { action: 'platform.login', outcome: 'FAILURE', createdAt: { gte: new Date(Date.now() - 86_400_000) } } }), href: '/platform/security' });
    }
    return { items, total: items.reduce((s, i) => s + i.count, 0) };
  }

  /* ---------------- users ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_USERS)
  @Get('users')
  async users(@Query(new ZodPipe(userQuery)) q: z.infer<typeof userQuery>) {
    const digits = q.q?.replace(/\D/g, '') ?? '';
    const where: Prisma.UserWhereInput = {
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []), { email: { contains: q.q.toLowerCase() } }] } : {}),
      ...(q.status === 'disabled' ? { disabledAt: { not: null } } : q.status === 'locked' ? { lockedUntil: { gt: new Date() } } : q.status === 'deletion_requested' ? { deletionRequestedAt: { not: null } } : q.status === 'active' ? { disabledAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: { _count: { select: { memberships: { where: { status: { not: 'EXITED' } } }, supportCases: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows.map((u) => this.userRow(u)), total, q.page, q.pageSize);
  }

  @RequirePlatform(PP.PLATFORM_VIEW_USERS)
  @Get('users/:id')
  async user(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        _count: { select: { memberships: { where: { status: { not: 'EXITED' } } }, supportCases: true } },
        memberships: { where: { status: { not: 'EXITED' } }, select: { role: true, status: true, joinedAt: true, group: { select: { id: true, name: true, status: true } } } },
        supportCases: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, subject: true, status: true, createdAt: true } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { lastUsedAt: true } },
      },
    });
    if (!u) throw new NotFoundException('User not found');
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.user_viewed', targetType: 'User', targetId: id, meta });
    return {
      ...this.userRow(u),
      groups: u.memberships.map((m) => ({ id: m.group.id, name: m.group.name, role: m.role, status: m.status, groupStatus: m.group.status, joinedAt: m.joinedAt.toISOString() })),
      cases: u.supportCases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      activeSessions: u.sessions.length,
      lastActiveAt: u.sessions.map((s) => s.lastUsedAt).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
    };
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_ACCOUNTS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('users/:id/status')
  async userStatus(@Param('id') id: string, @Body(new ZodPipe(z.object({ disabled: z.boolean(), reason: reasonSchema }))) body: { disabled: boolean; reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { disabledAt: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { disabledAt: body.disabled ? new Date() : null } }),
      ...(body.disabled ? [this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'account_disabled' } })] : []),
    ]);
    await this.audit.log({ actorAccountId: staff.accountId, action: body.disabled ? 'platform.user_suspended' : 'platform.user_reactivated', targetType: 'User', targetId: id, reason: body.reason, before: { disabled: !!target.disabledAt }, after: { disabled: body.disabled }, meta });
    return { ok: true };
  }

  /** Signs a member out of every device (suspected account takeover). Their password is unchanged. */
  @RequirePlatform(PP.PLATFORM_MANAGE_ACCOUNTS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('users/:id/revoke-sessions')
  async revokeUserSessions(@Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: { reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const r = await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'revoked_by_support' } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.user_sessions_revoked', targetType: 'User', targetId: id, reason: body.reason, after: { sessions: r.count }, meta });
    return { ok: true, revoked: r.count };
  }

  /** Sends a reset code to the user's own phone. Staff never see the code. */
  @RequirePlatform(PP.PLATFORM_MANAGE_ACCOUNTS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('users/:id/send-reset-code')
  async sendResetCode(@Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: { reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { phone: true, disabledAt: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.disabledAt) throw new ForbiddenException('This account is suspended. Reactivate it first.');
    await this.otp.issue(target.phone, 'RESET_PASSWORD');
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.user_reset_code_sent', targetType: 'User', targetId: id, reason: body.reason, meta });
    return { ok: true, message: 'A reset code was sent by SMS to the account holder’s own phone.' };
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_ACCOUNTS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('users/:id/unlock')
  async unlock(@Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: { reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const r = await this.prisma.user.updateMany({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    if (!r.count) throw new NotFoundException('User not found');
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.user_unlocked', targetType: 'User', targetId: id, reason: body.reason, meta });
    return { ok: true };
  }

  /* ---------------- groups (metadata only) ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_GROUPS)
  @Get('groups')
  async groups(@Query(new ZodPipe(groupQuery)) q: z.infer<typeof groupQuery>) {
    const where: Prisma.GroupWhereInput = {
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { id: q.q }] } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.country ? { countryCode: q.country } : {}),
      ...(q.plan === 'FREE' ? { OR: [{ subscription: null }, { subscription: { plan: { tier: 0 } } }] } : q.plan ? { subscription: { plan: { code: q.plan } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.group.findMany({ where, include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }, subscription: { include: { plan: { select: { code: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.group.count({ where }),
    ]);
    return paginate(
      rows.map((g) => ({ id: g.id, name: g.name, type: g.type, status: g.status, countryCode: g.countryCode, currency: g.currency, members: g._count.memberships, plan: g.subscription?.plan.name ?? 'Free', planCode: g.subscription?.plan.code ?? 'FREE', subscriptionStatus: g.subscription?.status ?? null, currentPeriodEnd: g.subscription?.currentPeriodEnd?.toISOString() ?? null, createdAt: g.createdAt.toISOString() })),
      total,
      q.page,
      q.pageSize,
    );
  }

  @RequirePlatform(PP.PLATFORM_VIEW_GROUPS)
  @Get('groups/:id')
  async group(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const g = await this.prisma.group.findUnique({
      where: { id },
      include: {
        _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
        subscription: { include: { plan: { select: { code: true, name: true } } } },
        memberships: { where: { status: 'ACTIVE', role: { in: ['CHAIRPERSON', 'TREASURER', 'SECRETARY'] } }, select: { role: true, user: { select: { fullName: true } } } },
      },
    });
    if (!g) throw new NotFoundException('Group not found');
    const [cases, billingCases, interventions, grants] = await Promise.all([
      this.prisma.supportCase.findMany({ where: { groupId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true } }),
      staff.permissions.includes(PP.PLATFORM_VIEW_BILLING) ? this.prisma.billingCase.findMany({ where: { groupId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, subject: true, status: true, priority: true, createdAt: true } }) : [],
      this.prisma.platformAuditLog.findMany({ where: { targetType: 'Group', targetId: id, action: { in: ['platform.group_intervention', 'platform.group_suspended', 'platform.group_reactivated'] } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.supportAccessGrant.findMany({ where: { groupId: id }, orderBy: { createdAt: 'desc' }, take: 20, include: { requestedByAccount: { select: { fullName: true } } } }),
    ]);
    const actorNames = new Map((await this.prisma.platformAccount.findMany({ where: { id: { in: interventions.map((i) => i.actorAccountId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((a) => [a.id, a.fullName]));
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.group_viewed', targetType: 'Group', targetId: id, meta });
    return {
      id: g.id,
      name: g.name,
      type: g.type,
      status: g.status,
      countryCode: g.countryCode,
      currency: g.currency,
      timezone: g.timezone,
      members: g._count.memberships,
      plan: g.subscription?.plan.name ?? 'Free',
      subscriptionStatus: g.subscription?.status ?? null,
      currentPeriodEnd: g.subscription?.currentPeriodEnd?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      officers: g.memberships.map((m) => ({ role: m.role, name: m.user.fullName })),
      supportCases: cases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      billingCases: billingCases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      interventions: interventions.map((i) => ({ id: i.id, action: i.action, at: i.createdAt.toISOString(), by: i.actorAccountId ? (actorNames.get(i.actorAccountId) ?? 'Staff') : 'System', reason: i.reason, details: i.after })),
      accessGrants: grants.map((x) => ({ id: x.id, by: x.requestedByAccount?.fullName ?? 'Former staff', purpose: x.purpose, status: grantStatus(x), expiresAt: x.expiresAt?.toISOString() ?? null, createdAt: x.createdAt.toISOString() })),
    };
  }

  /** Stops a group from making changes (members can still read their records). Reversible and audited. */
  @RequirePlatform(PP.PLATFORM_MANAGE_GROUPS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('groups/:id/suspend')
  suspendGroup(@Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: { reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.setGroupStatus(id, 'SUSPENDED', body.reason, staff, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_GROUPS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post('groups/:id/reactivate')
  reactivateGroup(@Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: { reason: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.setGroupStatus(id, 'ACTIVE', body.reason, staff, meta);
  }

  private async setGroupStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', reason: string, staff: StaffContext, meta: RequestMeta) {
    const g = await this.prisma.group.findUnique({ where: { id }, select: { status: true } });
    if (!g) throw new NotFoundException('Group not found');
    if (g.status === 'ARCHIVED') throw new BadRequestException('This group is archived by its members.');
    if (g.status === status) throw new BadRequestException('Nothing to change.');
    await this.prisma.group.update({ where: { id }, data: { status } });
    await this.audit.log({ actorAccountId: staff.accountId, action: status === 'SUSPENDED' ? 'platform.group_suspended' : 'platform.group_reactivated', targetType: 'Group', targetId: id, reason, before: { status: g.status }, after: { status }, meta });
    // The group's own audit trail shows that ChamaHub acted, and why.
    await this.groupAudit.log({ groupId: id, actorUserId: null, action: status === 'SUSPENDED' ? 'platform.group_suspended' : 'platform.group_reactivated', entityType: 'Group', entityId: id, reason, meta });
    const officers = await this.notifications.groupUserIds(id, ['CHAIRPERSON', 'TREASURER', 'SECRETARY']);
    await this.notifications.notify(officers, { groupId: id, type: 'ANNOUNCEMENT', title: status === 'SUSPENDED' ? 'Your group has been paused by ChamaHub' : 'Your group is active again', body: status === 'SUSPENDED' ? `Records stay readable but no changes can be made. Reason: ${reason}. Contact support from the Help screen.` : 'You can record contributions, loans and payouts again.' });
    return { ok: true, status };
  }

  @RequireAnyPlatform(PP.PLATFORM_MANAGE_GROUPS, PP.PLATFORM_SUPPORT_MANAGE)
  @Post('groups/:id/interventions')
  async intervention(@Param('id') id: string, @Body(new ZodPipe(interventionSchema)) body: z.infer<typeof interventionSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    if (!(await this.prisma.group.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Group not found');
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.group_intervention', targetType: 'Group', targetId: id, reason: body.note, after: { kind: body.kind }, meta });
    return { ok: true };
  }

  /* ---------------- exceptional group access ---------------- */

  /**
   * Asks a group's chairperson for temporary, read-only access. Without support_manage the
   * request must be for a case assigned to the caller about that group.
   */
  @RequirePlatform(PP.PLATFORM_REQUEST_GROUP_ACCESS)
  @Post('support-access')
  async requestAccess(@Body(new ZodPipe(supportAccessRequestSchema)) body: z.infer<typeof supportAccessRequestSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const group = await this.prisma.group.findUnique({ where: { id: body.groupId }, select: { id: true } });
    if (!group) throw new NotFoundException('Group not found');
    if (!staff.permissions.includes(PP.PLATFORM_SUPPORT_MANAGE)) {
      const c = body.caseId ? await this.prisma.supportCase.findFirst({ where: { id: body.caseId, groupId: body.groupId, assignedToId: staff.accountId, status: { notIn: ['RESOLVED', 'CLOSED'] } } }) : null;
      if (!c) throw new ForbiddenException('Request access from an open case about this group that is assigned to you.');
    }
    const { maxSupportAccessHours } = await this.settings.get();
    if (body.hours > maxSupportAccessHours) throw new ForbiddenException(`Access is limited to ${maxSupportAccessHours} hours by platform policy.`);
    const g = await this.prisma.supportAccessGrant.create({ data: { groupId: body.groupId, requestedByAccountId: staff.accountId, purpose: body.caseId ? `${body.purpose} (case ${body.caseId})` : body.purpose, hours: body.hours } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.support_access_requested', targetType: 'Group', targetId: body.groupId, reason: body.purpose, after: { grantId: g.id, hours: body.hours, caseId: body.caseId ?? null }, meta });
    await this.groupAudit.log({ groupId: body.groupId, actorUserId: null, action: 'platform.support_access_requested', entityType: 'SupportAccessGrant', entityId: g.id, reason: body.purpose, approvalStatus: 'PENDING', meta });
    const chairs = await this.notifications.groupUserIds(body.groupId, ['CHAIRPERSON']);
    await this.notifications.notify(chairs, { groupId: body.groupId, type: 'APPROVAL_REQUIRED', title: 'ChamaHub support asks to view your records', body: `Purpose: ${body.purpose}. Read-only, for ${body.hours} hour(s), only if you approve. Review it in Settings › Support access.` });
    return { id: g.id, status: g.status };
  }

  @RequirePlatform(PP.PLATFORM_REQUEST_GROUP_ACCESS)
  @Get('support-access')
  async myGrants(@CurrentStaff() staff: StaffContext) {
    const rows = await this.prisma.supportAccessGrant.findMany({ where: { requestedByAccountId: staff.accountId }, include: { group: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((g) => ({ id: g.id, groupId: g.groupId, groupName: g.group.name, purpose: g.purpose, hours: g.hours, status: grantStatus(g), expiresAt: g.expiresAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString() }));
  }

  /**
   * The read-only view an approved grant allows: members and the group's recent records, no
   * contact details and no way to change anything. Every view is recorded in both audit trails.
   */
  @RequirePlatform(PP.PLATFORM_REQUEST_GROUP_ACCESS)
  @Get('support-access/:id/records')
  async grantRecords(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const g = await this.prisma.supportAccessGrant.findFirst({ where: { id, requestedByAccountId: staff.accountId, status: 'APPROVED', expiresAt: { gt: new Date() } }, include: { group: { select: { id: true, name: true, currency: true } } } });
    if (!g) {
      await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.support_access_used', outcome: 'DENIED', targetType: 'SupportAccessGrant', targetId: id, meta });
      throw new NotFoundException('No active, approved access for this group.');
    }
    const groupId = g.groupId;
    const [members, payments, loans] = await Promise.all([
      this.prisma.membership.findMany({ where: { groupId, status: { not: 'EXITED' } }, select: { id: true, role: true, status: true, joinedAt: true, user: { select: { fullName: true } } }, orderBy: { joinedAt: 'asc' } }),
      this.prisma.payment.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, membershipId: true, amountCents: true, currency: true, purpose: true, status: true, method: true, reference: true, paidAt: true } }),
      this.prisma.loan.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, membershipId: true, principalCents: true, totalInterestCents: true, status: true, appliedAt: true, disbursedAt: true } }),
    ]);
    const memberName = new Map(members.map((m) => [m.id, m.user.fullName]));
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.support_access_used', targetType: 'Group', targetId: groupId, reason: g.purpose, after: { grantId: id }, meta });
    await this.groupAudit.log({ groupId, actorUserId: null, action: 'support.access', entityType: 'SupportAccessGrant', entityId: id, reason: g.purpose, after: { viewedBy: staff.fullName }, meta });
    return {
      group: g.group,
      expiresAt: g.expiresAt!.toISOString(),
      readOnly: true,
      members: members.map((m) => ({ name: m.user.fullName, role: m.role, status: m.status, joinedAt: m.joinedAt.toISOString() })),
      payments: payments.map((p) => ({ id: p.id, member: p.membershipId ? (memberName.get(p.membershipId) ?? 'Former member') : null, amountMinor: n(p.amountCents), currency: p.currency, purpose: p.purpose, status: p.status, method: p.method, reference: p.reference, paidAt: p.paidAt.toISOString().slice(0, 10) })),
      loans: loans.map((l) => ({ id: l.id, member: memberName.get(l.membershipId) ?? 'Former member', principalMinor: n(l.principalCents), interestMinor: n(l.totalInterestCents), status: l.status, appliedAt: l.appliedAt.toISOString(), disbursedAt: l.disbursedAt?.toISOString().slice(0, 10) ?? null })),
    };
  }

  /* ---------------- audit & security ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_AUDIT)
  @Get('audit')
  async auditLog(@Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(q.actor ? { actorAccountId: q.actor } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    // Reading the audit trail is itself recorded (but only once per page view, not per row).
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.audit_viewed', after: { filters: { ...q, page: undefined, pageSize: undefined } }, meta });
    return paginate(await this.auditRows(rows), total, q.page, q.pageSize);
  }

  @RequirePlatform(PP.PLATFORM_VIEW_SECURITY)
  @Get('security-events')
  async securityEvents(@Query(new ZodPipe(paginationSchema)) q: z.infer<typeof paginationSchema>) {
    const where: Prisma.PlatformAuditLogWhereInput = { OR: [{ outcome: { in: ['FAILURE', 'DENIED'] } }, ...SECURITY_ACTIONS.map((a) => ({ action: { startsWith: a } }))] };
    const [rows, total, memberEvents] = await Promise.all([
      this.prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.platformAuditLog.count({ where }),
      this.prisma.auditEvent.groupBy({ by: ['action'], where: { action: { in: MEMBER_SECURITY_ACTIONS }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: { _all: true } }),
    ]);
    return { ...paginate(await this.auditRows(rows), total, q.page, q.pageSize), memberAuth7d: memberEvents.map((e) => ({ action: e.action, count: e._count._all })) };
  }

  @RequirePlatform(PP.PLATFORM_VIEW_SECURITY)
  @Get('jobs')
  async jobs() {
    const rows = await this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 100 });
    return rows.map((j) => ({ ...j, startedAt: j.startedAt.toISOString(), finishedAt: j.finishedAt.toISOString() }));
  }

  /* ---------------- platform settings ---------------- */

  @RequirePlatform(PP.PLATFORM_CONFIGURE)
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @RequirePlatform(PP.PLATFORM_CONFIGURE)
  @RequireRecentAuth()
  @Patch('settings')
  async updateSettings(@Body(new ZodPipe(platformSettingsSchema.partial())) body: Partial<z.infer<typeof platformSettingsSchema>>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const before = await this.settings.get();
    if (body.trialPlanCode && !(await this.prisma.plan.findFirst({ where: { code: body.trialPlanCode, active: true } }))) throw new NotFoundException('Trial plan not found or inactive');
    const after = await this.settings.set({ ...before, ...body }, staff.accountId);
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.settings_changed', targetType: 'PlatformSetting', targetId: 'platform', before, after, meta });
    return after;
  }

  /** Which integrations are configured. "Configured" is not "verified": nothing here claims an end-to-end test passed. */
  @RequirePlatform(PP.PLATFORM_CONFIGURE)
  @Get('integrations')
  async integrations() {
    const e = env();
    let database: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const since24 = new Date(Date.now() - 86_400_000);
    const [failedJobs, failedDeliveries] = await Promise.all([this.prisma.jobRun.count({ where: { status: 'FAILED', startedAt: { gte: since24 } } }), this.prisma.notificationDelivery.count({ where: { status: 'FAILED', createdAt: { gte: since24 } } })]);
    return {
      database,
      failedJobs24h: failedJobs,
      failedDeliveries24h: failedDeliveries,
      integrations: [
        { key: 'mpesa', name: 'M-Pesa Daraja (group collections)', configured: mpesaConfigured(), status: mpesaConfigured() ? `Configured (${e.MPESA_ENV}); not verified end to end` : 'Not configured' },
        { key: 'sms', name: "SMS (Africa's Talking)", configured: smsConfigured(), status: smsConfigured() ? 'Configured' : 'Not configured: SMS is not being sent' },
        { key: 'whatsapp', name: 'WhatsApp Business', configured: whatsappConfigured(), status: whatsappConfigured() ? 'Configured' : 'Not configured' },
        { key: 'email', name: 'E-mail relay (staff invitations, resets)', configured: emailConfigured(), status: emailConfigured() ? 'Configured' : 'Not configured: staff invitations show a one-time link instead' },
        { key: 'ai', name: 'AI assistant', configured: aiConfigured(), status: aiConfigured() ? `Configured (${e.AI_MODEL})` : 'Not configured: assistant is off' },
        { key: 'paystack', name: 'Paystack (subscriptions)', configured: !!e.PAYSTACK_SECRET_KEY, status: e.PAYSTACK_SECRET_KEY ? (e.PAYSTACK_SECRET_KEY.startsWith('sk_live') ? 'Live key set; not verified end to end' : 'Test key set') : 'Not configured' },
        { key: 'billing_mpesa', name: 'M-Pesa (subscriptions)', configured: !!(e.BILLING_MPESA_CONSUMER_KEY && e.BILLING_MPESA_SHORTCODE), status: e.BILLING_MPESA_CONSUMER_KEY ? `Configured (${e.BILLING_MPESA_ENV}); not verified end to end` : 'Not configured' },
      ],
    };
  }

  /* ---------------- helpers ---------------- */

  private userRow(u: Prisma.UserGetPayload<{ include: { _count: { select: { memberships: true; supportCases: true } } } }>) {
    return {
      id: u.id,
      fullName: u.fullName,
      phoneMasked: maskPhone(u.phone),
      email: u.email,
      phoneVerified: !!u.phoneVerifiedAt,
      groups: u._count.memberships,
      supportCases: u._count.supportCases,
      status: u.disabledAt ? 'DISABLED' : u.lockedUntil && u.lockedUntil > new Date() ? 'LOCKED' : 'ACTIVE',
      deletionRequestedAt: u.deletionRequestedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private async auditRows(rows: Prisma.PlatformAuditLogGetPayload<object>[]): Promise<PlatformAuditRow[]> {
    const ids = [...new Set(rows.map((r) => r.actorAccountId).filter((x): x is string => !!x))];
    const names = new Map((await this.prisma.platformAccount.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((a) => [a.id, a.fullName]));
    return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actorAccountId ? (names.get(r.actorAccountId) ?? 'Staff') : r.actorLabel, actorId: r.actorAccountId, action: r.action, targetType: r.targetType, targetId: r.targetId, outcome: r.outcome, reason: r.reason, requestId: r.requestId, ipAddress: r.ipAddress, before: r.before, after: r.after }));
  }
}

function grantStatus(g: { status: string; expiresAt: Date | null }) {
  return g.status === 'APPROVED' && g.expiresAt && g.expiresAt < new Date() ? 'EXPIRED' : g.status;
}

/** Public: the maintenance banner apps show. */
@Controller('platform-notice')
export class PlatformNoticeController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Public()
  @Get()
  async notice() {
    return { maintenanceNotice: (await this.settings.get()).maintenanceNotice };
  }
}
