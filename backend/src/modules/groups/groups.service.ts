import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  CreateGroupInput,
  Frequency,
  GroupDetail,
  GroupMembershipSummary,
  GroupOverview,
  GroupRole,
  resolvePermissions,
  RolePolicy,
  sanitizeRolePermissions,
  SpecialRole,
  Permission,
  updateGroupSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { DEFAULT_SETTINGS, readLoanPolicy, readSettings } from '../finance/policies';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { defaultLoanPolicy, addMonths } from '@chamahub/shared';

export function newInviteCode() {
  // 8 chars from an unambiguous alphabet (no 0/O/1/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: MemberFinanceService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly platform: PlatformSettingsService,
  ) {}

  async create(userId: string, input: CreateGroupInput, meta: RequestMeta) {
    const plan = await this.prisma.plan.findFirst({ where: { active: true }, orderBy: { priceCents: 'asc' } });
    const group = await this.prisma.$transaction(async (tx) => {
      const g = await tx.group.create({
        data: {
          name: input.name,
          type: input.type,
          description: input.description ?? null,
          county: input.county ?? null,
          registrationNumber: input.registrationNumber ?? null,
          financialYearStartMonth: input.financialYearStartMonth,
          inviteCode: newInviteCode(),
          settings: DEFAULT_SETTINGS,
          loanPolicy: { ...defaultLoanPolicy, enabled: input.type !== 'MERRY_GO_ROUND' },
          createdById: userId,
          memberships: { create: { userId, role: 'CHAIRPERSON' } },
          ...(plan ? { subscription: { create: { planId: plan.id, status: 'TRIALING', trialEndsAt: new Date(Date.now() + (await this.platform.get()).trialDays * 86_400_000) } } } : {}),
        },
      });
      await this.audit.log({ groupId: g.id, actorUserId: userId, action: 'group.created', entityType: 'Group', entityId: g.id, after: input, meta }, tx);
      return g;
    });
    return group;
  }

  async mine(userId: string): Promise<GroupMembershipSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: { not: 'EXITED' }, group: { status: 'ACTIVE' } },
      include: {
        group: {
          include: {
            _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
            schedules: { where: { active: true }, orderBy: [{ cycleId: 'asc' }, { createdAt: 'asc' }], take: 1 },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    const t = dbDate(today());
    return Promise.all(
      memberships.map(async (m) => {
        const [nextObligation, outstanding, loans, nextRound] = await Promise.all([
          this.prisma.contributionObligation.findFirst({
            where: { membershipId: m.id, status: { notIn: ['PAID', 'WAIVED'] } },
            orderBy: { dueDate: 'asc' },
            select: { dueDate: true },
          }),
          this.finance.outstandingObligations(m.groupId, [m.id]),
          this.finance.loanBalances(m.groupId, [m.id]),
          this.prisma.payoutRound.findFirst({
            where: { membershipId: m.id, status: { notIn: ['COMPLETED', 'CANCELLED'] }, cycle: { status: 'ACTIVE' }, payoutDate: { gte: t } },
            orderBy: { payoutDate: 'asc' },
            select: { payoutDate: true },
          }),
        ]);
        const s = m.group.schedules[0];
        return {
          groupId: m.groupId,
          membershipId: m.id,
          name: m.group.name,
          type: m.group.type,
          role: m.role as GroupRole,
          specialRoles: m.specialRoles as SpecialRole[],
          permissions: resolvePermissions(m.role as GroupRole, m.group.rolePolicy as RolePolicy | null, m.specialRoles as SpecialRole[]),
          status: m.status,
          memberCount: m.group._count.memberships,
          schedule: s ? { name: s.name, amountCents: n(s.amountCents), frequency: s.frequency as Frequency } : null,
          nextDueDate: nextObligation ? isoDate(nextObligation.dueDate) : null,
          outstandingCents: outstanding.get(m.id) ?? 0,
          loanBalanceCents: loans.get(m.id) ?? 0,
          nextPayoutDate: nextRound ? isoDate(nextRound.payoutDate) : null,
        };
      }),
    );
  }

  async detail(groupId: string, membership: MembershipContext): Promise<GroupDetail> {
    const g = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }, createdBy: { select: { fullName: true } } },
    });
    const mine = membership.id ? await this.prisma.membership.findUnique({ where: { id: membership.id }, select: { specialRoles: true } }) : null;
    if (!g) throw new NotFoundException('Group not found');
    const canInvite = membership.permissions.includes('members.invite');
    return {
      id: g.id,
      name: g.name,
      type: g.type,
      description: g.description,
      county: g.county,
      registrationNumber: g.registrationNumber,
      financialYearStartMonth: g.financialYearStartMonth,
      inviteCode: canInvite ? g.inviteCode : null,
      settings: readSettings(g.settings),
      loanPolicy: readLoanPolicy(g.loanPolicy),
      memberCount: g._count.memberships,
      createdAt: g.createdAt.toISOString(),
      myMembership: { membershipId: membership.id, role: membership.role, specialRoles: (mine?.specialRoles ?? []) as SpecialRole[], permissions: [...membership.permissions] },
      rolePolicy: membership.permissions.includes(Permission.PERMISSIONS_CONFIGURE) ? ((g.rolePolicy as RolePolicy | null) ?? null) : null,
      // The founder is recorded for history only; it confers no ongoing control.
      founderName: g.createdBy.fullName,
    };
  }

  async update(groupId: string, input: z.infer<typeof updateGroupSchema>, userId: string, meta: RequestMeta) {
    const before = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    const settings = input.settings ? { ...readSettings(before.settings), ...input.settings } : undefined;
    const loanPolicy = input.loanPolicy ? { ...readLoanPolicy(before.loanPolicy), ...input.loanPolicy } : undefined;
    const after = await this.prisma.$transaction(async (tx) => {
      const g = await tx.group.update({
        where: { id: groupId },
        data: {
          name: input.name,
          type: input.type,
          description: input.description,
          county: input.county,
          registrationNumber: input.registrationNumber,
          financialYearStartMonth: input.financialYearStartMonth,
          settings,
          loanPolicy,
        },
      });
      await this.audit.log(
        {
          groupId,
          actorUserId: userId,
          action: 'group.updated',
          entityType: 'Group',
          entityId: groupId,
          before: { name: before.name, type: before.type, settings: before.settings, loanPolicy: before.loanPolicy },
          after: { name: g.name, type: g.type, settings: g.settings, loanPolicy: g.loanPolicy },
          meta,
        },
        tx,
      );
      return g;
    });
    return after;
  }

  /**
   * Replaces one role's permissions for this group. The request is clamped
   * to platform safeguards; anything outside them is rejected, not ignored.
   */
  async updateRolePolicy(groupId: string, role: GroupRole, permissions: Permission[] | null, reason: string, actor: MembershipContext, meta: RequestMeta) {
    if (permissions) {
      const { rejected } = sanitizeRolePermissions(role, permissions);
      if (rejected.length) throw new UnprocessableEntityException({ message: `These permissions cannot be given to this role: ${rejected.join(', ')}`, details: { rejected } });
    }
    const g = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { rolePolicy: true } });
    const before = (g.rolePolicy as RolePolicy | null) ?? {};
    const next: RolePolicy = { ...before };
    if (permissions) next[role] = sanitizeRolePermissions(role, permissions).permissions;
    else delete next[role];
    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({ where: { id: groupId }, data: { rolePolicy: Object.keys(next).length ? (next as object) : Prisma.DbNull } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'group.role_policy_changed', entityType: 'Group', entityId: groupId, before: { [role]: before[role] ?? 'default' }, after: { [role]: next[role] ?? 'default' }, reason, meta }, tx);
    });
    const officers = (await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE', role: { not: 'MEMBER' } }, select: { userId: true } })).map((m) => m.userId).filter((u) => u !== actor.userId);
    await this.notifications.notify(officers, { groupId, type: 'ANNOUNCEMENT', title: 'Role permissions changed', body: `Permissions for the ${role.toLowerCase().replace('_', ' ')} role were updated. Reason: ${reason}` });
    return { role, permissions: resolvePermissions(role, next) };
  }

  async rotateInviteCode(groupId: string, disable: boolean, userId: string, meta: RequestMeta) {
    const code = disable ? null : newInviteCode();
    await this.prisma.group.update({ where: { id: groupId }, data: { inviteCode: code } });
    await this.audit.log({ groupId, actorUserId: userId, action: disable ? 'group.invite_code_disabled' : 'group.invite_code_rotated', entityType: 'Group', entityId: groupId, meta });
    return { inviteCode: code };
  }

  async overview(groupId: string): Promise<GroupOverview> {
    const t = today();
    const start = addMonths(`${t.slice(0, 7)}-01`, -5);
    const [cash, totalContrib, outstanding, loans, pendingVerification, activeMembers, pendingLoans, pendingExpenses, pendingDistributions, monthlyLines] = await Promise.all([
      this.ledger.cashBalance(groupId),
      this.ledger.accountBalance(groupId, 'MEMBER_CONTRIBUTIONS'),
      this.finance.outstandingObligations(groupId),
      this.ledger.accountBalance(groupId, 'LOANS_RECEIVABLE'),
      this.prisma.payment.count({ where: { groupId, status: 'PENDING' } }),
      this.prisma.membership.count({ where: { groupId, status: 'ACTIVE' } }),
      this.prisma.loan.count({ where: { groupId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.expense.count({ where: { groupId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.distribution.count({ where: { groupId, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.journalLine.findMany({
        where: { entry: { groupId, entryDate: { gte: dbDate(start) } }, account: { in: ['MEMBER_CONTRIBUTIONS', 'EXPENSES', 'LOANS_RECEIVABLE', 'INTEREST_INCOME'] } },
        select: { account: true, amountCents: true, entry: { select: { entryDate: true, type: true, reverses: { select: { type: true } } } } },
      }),
    ]);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(start, i).slice(0, 7));
    const monthly = months.map((month) => ({ month, contributionsCents: 0, expensesCents: 0, repaymentsCents: 0 }));
    for (const l of monthlyLines) {
      const bucket = monthly.find((m) => m.month === isoDate(l.entry.entryDate).slice(0, 7));
      if (!bucket) continue;
      const effType = l.entry.type === 'REVERSAL' ? l.entry.reverses?.type : l.entry.type;
      const amt = n(l.amountCents);
      if (l.account === 'MEMBER_CONTRIBUTIONS') bucket.contributionsCents -= amt;
      else if (l.account === 'EXPENSES') bucket.expensesCents += amt;
      else if (effType === 'LOAN_REPAYMENT_PRINCIPAL') bucket.repaymentsCents -= amt;
    }
    return {
      cashBalanceCents: cash,
      totalContributionsCents: -totalContrib,
      outstandingContributionsCents: [...outstanding.values()].reduce((a, b) => a + b, 0),
      loansOutstandingCents: loans,
      pendingApprovals: pendingLoans + pendingExpenses + pendingDistributions,
      pendingVerification,
      activeMembers,
      monthly,
    };
  }
}
