import { Injectable } from '@nestjs/common';
import { ActivityItem, addDays, CalendarEntry, PersonalDashboard, recipientShare } from '@chamahub/shared';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { installmentStatus } from '../finance/posting.service';
import { GroupsService } from '../groups/groups.service';
import { paymentInclude, toPaymentItems } from '../contributions/payment-mapper';
import { effectiveType } from '../statements/statements.service';

/**
 * Aggregates a user's position across all their Chamas. Every figure comes
 * from each group's own records; nothing is merged across group books.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
    private readonly finance: MemberFinanceService,
  ) {}

  private async memberships(userId: string, activeOnly = true) {
    return this.prisma.membership.findMany({
      where: { userId, ...(activeOnly ? { status: { not: 'EXITED' } } : {}), group: { status: 'ACTIVE' } },
      select: { id: true, groupId: true, group: { select: { name: true } } },
    });
  }

  async dashboard(userId: string): Promise<PersonalDashboard> {
    const ms = await this.memberships(userId);
    const ids = ms.map((m) => m.id);
    const t = today();
    const monthStart = `${t.slice(0, 7)}-01`;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const [groups, obligations, monthLines, payoutLines, rounds, recent, invitations, unread, allLines, pending] = await Promise.all([
      this.groups.mine(userId),
      this.finance.obligationItems({ membershipIds: ids, to: addDays(t, 30) }),
      this.prisma.journalLine.findMany({ where: { account: 'MEMBER_CONTRIBUTIONS', entry: { membershipId: { in: ids }, entryDate: { gte: dbDate(monthStart), lte: dbDate(t) } } }, select: { amountCents: true } }),
      this.prisma.journalLine.findMany({ where: { account: 'PAYOUTS', entry: { membershipId: { in: ids } } }, select: { amountCents: true } }),
      this.prisma.payoutRound.findMany({
        where: { membershipId: { in: ids }, status: { notIn: ['COMPLETED', 'CANCELLED'] }, cycle: { status: 'ACTIVE' } },
        include: { cycle: { select: { name: true, groupId: true, recipientsPerRound: true, group: { select: { name: true } } } } },
        orderBy: { payoutDate: 'asc' },
        take: 10,
      }),
      this.prisma.journalEntry.findMany({
        where: { membershipId: { in: ids } },
        include: { lines: true, reverses: { select: { type: true } }, group: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.invitation.count({ where: { phone: user.phone, status: 'PENDING', expiresAt: { gt: new Date() } } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.journalLine.aggregate({ where: { account: 'MEMBER_CONTRIBUTIONS', entry: { membershipId: { in: ids } } }, _sum: { amountCents: true } }),
      this.prisma.payment.aggregate({ where: { membershipId: { in: ids }, status: 'PENDING' }, _sum: { amountCents: true }, _count: true }),
    ]);
    const lastRound = rounds.length
      ? new Map((await this.prisma.payoutRound.groupBy({ by: ['cycleId'], where: { cycleId: { in: [...new Set(rounds.map((r) => r.cycleId))] }, status: { not: 'CANCELLED' } }, _max: { round: true } })).map((x) => [x.cycleId, x._max.round ?? 0]))
      : new Map<string, number>();
    const open = obligations.filter((o) => o.outstandingCents > 0);
    const overdue = open.filter((o) => o.status === 'OVERDUE');
    const upcoming = open.filter((o) => o.status !== 'OVERDUE').slice(0, 10);
    const recentActivity: ActivityItem[] = recent.map((e) => {
      const cash = e.lines.filter((l) => l.account === 'CASH').reduce((a, l) => a + n(l.amountCents), 0);
      const type = effectiveType(e);
      const label =
        e.type === 'REVERSAL' ? 'Reversed' : type === 'CONTRIBUTION' ? 'Contribution confirmed' : type === 'LOAN_DISBURSEMENT' ? 'Loan disbursed to you' : type === 'LOAN_REPAYMENT_PRINCIPAL' ? 'Loan repayment confirmed' : type === 'PAYOUT' ? 'Payout received' : type === 'DISTRIBUTION' ? 'Distribution received' : type === 'FINE_PAYMENT' ? 'Fine paid' : e.description;
      return { id: e.id, groupId: e.groupId, groupName: e.group.name, at: e.createdAt.toISOString(), title: label, amountCents: Math.abs(cash), kind: e.type };
    });
    const next = open.filter((o) => o.dueDate >= t).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return {
      activeGroups: groups.filter((g) => g.status === 'ACTIVE').length,
      // Credits to member contributions are negative ledger lines: confirmed money only.
      totalContributedCents: -n(allLines._sum.amountCents),
      dueNowCents: open.filter((o) => o.dueDate <= t).reduce((a, o) => a + o.outstandingCents, 0),
      pendingVerification: { count: pending._count, cents: n(pending._sum.amountCents) },
      nextDeadline: next ? { groupId: next.groupId, groupName: next.groupName, periodLabel: next.periodLabel, dueDate: next.dueDate, amountCents: next.outstandingCents } : null,
      contributedThisMonthCents: -monthLines.reduce((a, l) => a + n(l.amountCents), 0),
      upcoming,
      overdue,
      overdueCents: overdue.reduce((a, o) => a + o.outstandingCents, 0),
      outstandingLoanCents: groups.reduce((a, g) => a + g.loanBalanceCents, 0),
      payoutsReceivedCents: payoutLines.reduce((a, l) => a + n(l.amountCents), 0),
      upcomingPayouts: rounds.map((r) => ({ groupId: r.cycle.groupId, groupName: r.cycle.group.name, cycleName: r.cycle.name, payoutDate: isoDate(r.payoutDate), expectedCents: recipientShare(n(r.expectedCents), r.cycle.recipientsPerRound, r.slot - 1), status: r.status, round: r.round, totalRounds: lastRound.get(r.cycleId) ?? r.round })),
      recentActivity,
      groups,
      pendingInvitations: invitations,
      unreadNotifications: unread,
    };
  }

  async obligations(userId: string, q: { groupId?: string; from?: string; to?: string; status?: string }) {
    const ms = (await this.memberships(userId)).filter((m) => !q.groupId || m.groupId === q.groupId);
    const items = await this.finance.obligationItems({ membershipIds: ms.map((m) => m.id), from: q.from, to: q.to ?? addDays(today(), 60) });
    if (q.status === 'OUTSTANDING') return items.filter((i) => i.outstandingCents > 0);
    return q.status ? items.filter((i) => i.status === q.status) : items;
  }

  async payments(userId: string, q: { groupId?: string; limit: number }) {
    const ms = (await this.memberships(userId, false)).filter((m) => !q.groupId || m.groupId === q.groupId);
    const rows = await this.prisma.payment.findMany({ where: { membershipId: { in: ms.map((m) => m.id) } }, include: paymentInclude, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: q.limit });
    return toPaymentItems(this.prisma, rows);
  }

  async loans(userId: string) {
    const ms = await this.memberships(userId, false);
    const rows = await this.prisma.loan.findMany({ where: { membershipId: { in: ms.map((m) => m.id) } }, select: { id: true, groupId: true }, orderBy: { appliedAt: 'desc' } });
    return rows;
  }

  /** One calendar combining every Chama's contributions, installments, payouts and meetings. */
  async calendar(userId: string, q: { from: string; to: string; groupId?: string }): Promise<CalendarEntry[]> {
    const ms = (await this.memberships(userId)).filter((m) => !q.groupId || m.groupId === q.groupId);
    const ids = ms.map((m) => m.id);
    const groupIds = ms.map((m) => m.groupId);
    const range = { gte: dbDate(q.from), lte: dbDate(q.to) };
    const t = today();
    const [obligations, installments, rounds, meetings] = await Promise.all([
      this.finance.obligationItems({ membershipIds: ids, from: q.from, to: q.to }),
      this.prisma.loanInstallment.findMany({ where: { dueDate: range, loan: { membershipId: { in: ids }, status: 'DISBURSED' } }, include: { loan: { select: { groupId: true, group: { select: { name: true } } } } } }),
      this.prisma.payoutRound.findMany({ where: { membershipId: { in: ids }, payoutDate: range, status: { not: 'CANCELLED' }, cycle: { status: { in: ['ACTIVE', 'COMPLETED'] } } }, include: { cycle: { select: { name: true, groupId: true, recipientsPerRound: true, group: { select: { name: true } } } } } }),
      this.prisma.meeting.findMany({ where: { groupId: { in: groupIds }, scheduledAt: { gte: dbDate(q.from), lt: new Date(dbDate(q.to).getTime() + 86_400_000) }, status: { not: 'CANCELLED' } }, include: { group: { select: { name: true } } } }),
    ]);
    const entries: CalendarEntry[] = [
      ...obligations.map((o) => ({ id: o.id, kind: 'CONTRIBUTION' as const, groupId: o.groupId, groupName: o.groupName, date: o.dueDate, title: `${o.scheduleName} · ${o.periodLabel}`, amountCents: o.status === 'PAID' ? o.amountCents : o.outstandingCents, status: o.status })),
      ...installments.map((i) => ({ id: i.id, kind: 'LOAN_INSTALLMENT' as const, groupId: i.loan.groupId, groupName: i.loan.group.name, date: isoDate(i.dueDate), title: `Loan installment ${i.number}`, amountCents: n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), status: installmentStatus(i, t) })),
      ...rounds.map((r) => ({ id: r.id, kind: 'PAYOUT' as const, groupId: r.cycle.groupId, groupName: r.cycle.group.name, date: isoDate(r.payoutDate), title: `Your payout · ${r.cycle.name} round ${r.round}`, amountCents: recipientShare(n(r.expectedCents), r.cycle.recipientsPerRound, r.slot - 1), status: r.status })),
      ...meetings.map((m) => ({ id: m.id, kind: 'MEETING' as const, groupId: m.groupId, groupName: m.group.name, date: isoDate(new Date(m.scheduledAt.getTime() + 3 * 3600_000)), title: m.title, amountCents: null, status: m.status })),
    ];
    return entries.sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date < b.date ? -1 : 1));
  }

}
