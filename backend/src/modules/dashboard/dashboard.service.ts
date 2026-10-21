import { Injectable } from '@nestjs/common';
import { addDays, DashboardTask, formatDate, GroupDashboard, MONTHS, Permission } from '@chamahub/shared';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { LedgerService } from '../ledger/ledger.service';
import { RotationsService } from '../rotations/rotations.service';

function monthBounds(t: string) {
  const [y, m] = t.split('-').map(Number);
  const from = `${t.slice(0, 7)}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to, label: `${MONTHS[m - 1]} ${y}` };
}

/**
 * The management dashboard behind the mobile group home and the web
 * overview. Every figure comes from the ledger and records, and every block
 * is included only if the viewer holds the permission it needs. Task counts
 * apply the same maker-checker exclusions the actions themselves enforce.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly finance: MemberFinanceService,
    private readonly rotations: RotationsService,
  ) {}

  async forViewer(groupId: string, v: MembershipContext): Promise<GroupDashboard> {
    const can = (p: Permission) => v.permissions.includes(p);
    const t = today();
    const period = monthBounds(t);
    const tasks: DashboardTask[] = [];
    const task = (key: DashboardTask['key'], label: string, count: number, section: DashboardTask['section']) => count > 0 && tasks.push({ key, label, count, section });

    // Collections for the month and arrears to date.
    let collections: GroupDashboard['collections'] = null;
    if (can(Permission.CONTRIBUTIONS_VIEW_ALL)) {
      const [month, arrears, pending] = await Promise.all([
        this.prisma.contributionObligation.aggregate({ where: { groupId, waivedReason: null, dueDate: { gte: dbDate(period.from), lte: dbDate(period.to) } }, _sum: { amountCents: true, paidCents: true } }),
        this.finance.outstandingObligations(groupId),
        this.prisma.payment.aggregate({ where: { groupId, status: 'PENDING' }, _sum: { amountCents: true }, _count: true }),
      ]);
      const expected = n(month._sum.amountCents);
      const verified = n(month._sum.paidCents);
      const owing = [...arrears.values()].filter((c) => c > 0);
      collections = {
        expectedCents: expected,
        verifiedCents: verified,
        outstandingCents: Math.max(expected - verified, 0),
        progressPercent: expected ? Math.min(100, Math.floor((verified * 100) / expected)) : 0,
        arrearsCents: owing.reduce((a, b) => a + b, 0),
        membersInArrears: owing.length,
        pendingVerificationCount: pending._count,
        pendingVerificationCents: n(pending._sum.amountCents),
      };
    }

    const cashBalanceCents = can(Permission.REPORTS_VIEW) ? Number(await this.ledger.cashBalance(groupId)) : null;

    // Reconciliation and verification work.
    let reconciliation: GroupDashboard['reconciliation'] = null;
    if (can(Permission.CONTRIBUTIONS_VERIFY) || can(Permission.RECONCILIATION_MANAGE)) {
      const [toVerify, unmatched, dups, disputes] = await Promise.all([
        this.prisma.payment.count({ where: { groupId, status: 'PENDING', NOT: [{ recordedById: v.userId }, { membershipId: v.id }] } }),
        this.prisma.unmatchedPayment.count({ where: { groupId, status: 'UNMATCHED' } }),
        this.prisma.payment.groupBy({ by: ['reference'], where: { groupId, reference: { not: null }, status: { not: 'FAILED' } }, having: { reference: { _count: { gt: 1 } } } }),
        this.prisma.dispute.count({ where: { groupId, status: 'OPEN', membershipId: { not: v.id } } }),
      ]);
      const allPending = await this.prisma.payment.count({ where: { groupId, status: 'PENDING' } });
      reconciliation = { pendingVerification: allPending, unmatched, duplicateReferences: dups.length, openDisputes: disputes };
      if (can(Permission.CONTRIBUTIONS_VERIFY)) task('VERIFY_PAYMENTS', 'Payments to verify', toVerify, 'contributions');
      if (can(Permission.RECONCILIATION_MANAGE)) task('UNMATCHED_PAYMENTS', 'M-Pesa payments to match', unmatched, 'contributions');
      if (can(Permission.CONTRIBUTIONS_VERIFY)) task('DISPUTES', 'Open disputes', disputes, 'contributions');
    }

    // Loans.
    let loans: GroupDashboard['loans'] = null;
    if (can(Permission.LOANS_VIEW_ALL)) {
      const [balances, active, overdue] = await Promise.all([
        this.finance.loanBalances(groupId),
        this.prisma.loan.count({ where: { groupId, status: 'DISBURSED' } }),
        this.prisma.loanInstallment.count({ where: { loan: { groupId, status: 'DISBURSED' }, dueDate: { lt: dbDate(t) }, status: { not: 'PAID' } } }),
      ]);
      loans = { outstandingCents: [...balances.values()].reduce((a, b) => a + b, 0), activeCount: active, overdueInstallments: overdue };
    }
    if (can(Permission.LOANS_APPROVE)) {
      const pending = await this.prisma.loan.findMany({ where: { groupId, status: 'PENDING_APPROVAL', membershipId: { not: v.id }, OR: [{ preparedByMembershipId: null }, { preparedByMembershipId: { not: v.id } }] }, select: { id: true } });
      const decided = await this.prisma.approval.count({ where: { entityType: 'LOAN', entityId: { in: pending.map((l) => l.id) }, approverMembershipId: v.id } });
      task('LOAN_DECISIONS', 'Loan applications to review', pending.length - decided, 'loans');
    }
    if (can(Permission.LOANS_DISBURSE)) task('LOAN_DISBURSEMENTS', 'Approved loans to disburse', await this.prisma.loan.count({ where: { groupId, status: 'APPROVED', membershipId: { not: v.id } } }), 'loans');

    // Expenses.
    if (can(Permission.EXPENSES_APPROVE)) {
      const pending = await this.prisma.expense.findMany({ where: { groupId, status: 'PENDING_APPROVAL', recordedById: { not: v.userId } }, select: { id: true } });
      const decided = await this.prisma.approval.count({ where: { entityType: 'EXPENSE', entityId: { in: pending.map((e) => e.id) }, approverMembershipId: v.id } });
      task('EXPENSE_DECISIONS', 'Expenses to approve', pending.length - decided, 'expenses');
    }
    if (can(Permission.EXPENSES_RECORD)) task('EXPENSE_PAYMENTS', 'Approved expenses to pay', await this.prisma.expense.count({ where: { groupId, status: 'APPROVED' } }), 'expenses');

    // Rotation: reuse the rotation read model so counts match exactly what the viewer may do.
    let nextPayout: GroupDashboard['nextPayout'] = null;
    const upcoming: GroupDashboard['upcoming'] = [];
    if (can(Permission.ROTATIONS_VIEW)) {
      const open = await this.prisma.payoutCycle.findMany({ where: { groupId, status: { in: ['ACTIVE', 'DRAFT'] } }, select: { id: true } });
      for (const { id } of open) {
        const c = await this.rotations.detail(groupId, id, v);
        if (c.status === 'DRAFT') {
          if (c.can.approveActivation) task('ROTATION_APPROVALS', 'Rotation schedule to approve', 1, 'payouts');
          continue;
        }
        if (can(Permission.PAYOUTS_APPROVE)) task('ROTATION_APPROVALS', 'Rotation amendments to review', c.changeLog.filter((ch) => ch.status === 'PENDING').length, 'payouts');
        task('PAYOUT_PREPARE', 'Payouts ready to prepare', c.rounds.filter((r) => r.can.prepare).length, 'payouts');
        task('PAYOUT_DECISIONS', 'Payouts to approve', c.rounds.filter((r) => r.can.approve).length, 'payouts');
        task('PAYOUT_SEND', 'Approved payouts to send', c.rounds.filter((r) => r.can.disburse).length, 'payouts');
        task('PAYOUT_CONFIRM', 'Sent payouts to confirm', c.rounds.filter((r) => r.can.confirm).length, 'payouts');
        const r = c.currentRound;
        if (r) {
          nextPayout = {
            cycleId: c.id,
            roundId: r.id,
            round: r.round,
            recipientName: r.recipientName,
            payoutDate: r.payoutDate,
            status: r.status,
            expectedCents: r.expectedCents,
            confirmedCents: r.confirmedCents,
            ready: r.readiness ? r.readiness.ready : null,
            blockers: r.readiness ? r.readiness.checks.filter((x) => x.status === 'FAIL').map((x) => x.label) : [],
          };
          upcoming.push({ date: r.payoutDate, label: `Payout round ${r.round} · ${r.recipientName}`, amountCents: r.recipientsInRound > 1 ? r.expectedShareCents : r.expectedCents, kind: 'PAYOUT' });
        }
      }
    }
    if (can(Permission.DISTRIBUTIONS_APPROVE)) task('DISTRIBUTION_DECISIONS', 'Distributions to approve', await this.prisma.distribution.count({ where: { groupId, status: 'PENDING_APPROVAL' } }), 'reports');
    if (can(Permission.MINUTES_APPROVE)) task('MINUTES_APPROVAL', 'Minutes to approve', await this.prisma.minutes.count({ where: { status: 'DRAFT', meeting: { groupId }, recordedById: { not: v.userId } } }), 'meetings');
    if (can(Permission.FINDINGS_RESOLVE)) task('FINDINGS', 'Audit findings to answer', await this.prisma.auditFinding.count({ where: { groupId, status: 'OPEN' } }), 'audit');

    // Upcoming deadlines.
    const nextDue = await this.prisma.contributionObligation.groupBy({ by: ['dueDate'], where: { groupId, waivedReason: null, dueDate: { gte: dbDate(t), lte: dbDate(addDays(t, 45)) }, ...(can(Permission.CONTRIBUTIONS_VIEW_ALL) ? {} : { membershipId: v.id }) }, _sum: { amountCents: true }, orderBy: { dueDate: 'asc' }, take: 2 });
    for (const d of nextDue) upcoming.push({ date: isoDate(d.dueDate), label: can(Permission.CONTRIBUTIONS_VIEW_ALL) ? 'Contributions due (all members)' : 'Your contribution is due', amountCents: n(d._sum.amountCents), kind: 'CONTRIBUTION' });
    if (can(Permission.MEETINGS_VIEW)) {
      const m = await this.prisma.meeting.findFirst({ where: { groupId, status: 'SCHEDULED', scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: 'asc' } });
      if (m) upcoming.push({ date: isoDate(new Date(m.scheduledAt.getTime() + 3 * 3600_000)), label: `Meeting: ${m.title}`, amountCents: null, kind: 'MEETING' });
    }
    if (can(Permission.LOANS_VIEW_ALL)) {
      const first = await this.prisma.loanInstallment.findFirst({ where: { loan: { groupId, status: 'DISBURSED' }, dueDate: { gte: dbDate(t) }, status: { not: 'PAID' } }, orderBy: { dueDate: 'asc' }, select: { dueDate: true } });
      if (first) {
        const due = await this.prisma.loanInstallment.findMany({ where: { loan: { groupId, status: 'DISBURSED' }, dueDate: first.dueDate, status: { not: 'PAID' } }, select: { principalCents: true, interestCents: true, principalPaidCents: true, interestPaidCents: true } });
        upcoming.push({ date: isoDate(first.dueDate), label: 'Loan installments due', amountCents: due.reduce((a, i) => a + n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0), kind: 'LOAN' });
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));

    // Recent money movements (the ledger's cash lines).
    let recentActivity: GroupDashboard['recentActivity'] = null;
    if (can(Permission.REPORTS_VIEW)) {
      const entries = await this.prisma.journalEntry.findMany({ where: { groupId }, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: 8, include: { lines: { where: { account: 'CASH' } } } });
      recentActivity = entries.map((e) => {
        const cash = e.lines.reduce((a, l) => a + n(l.amountCents), 0);
        return { id: e.id, date: isoDate(e.entryDate), description: e.description, amountCents: Math.abs(cash), direction: cash > 0 ? 'IN' : cash < 0 ? 'OUT' : 'NONE' };
      });
    }

    return { groupId, asOf: `${formatDate(t)}`, period, collections, cashBalanceCents, nextPayout, reconciliation, loans, tasks, recentActivity, upcoming: upcoming.slice(0, 5) };
  }
}
