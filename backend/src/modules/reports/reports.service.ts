import { BadRequestException, Injectable } from '@nestjs/common';
import { centsToDecimalString as d, formatDate, LABELS } from '@chamahub/shared';
import { dbDate, isoDate } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ContributionsService } from '../contributions/contributions.service';
import { LoansService } from '../loans/loans.service';
import { StatementsService } from '../statements/statements.service';
import { auditScope } from '../audit/audit.controller';

export interface Report {
  title: string;
  headers: string[];
  rows: (string | number | null)[][];
  totals?: Record<string, number>;
}

export const REPORTS = [
  'cashbook',
  'contributions',
  'loan-portfolio',
  'repayments',
  'expenses',
  'fines',
  'member-statement',
  'group-statement',
  'payouts',
  'distributions',
  'income-expenditure',
  'audit',
] as const;
export type ReportName = (typeof REPORTS)[number];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementsService,
    private readonly contributions: ContributionsService,
    private readonly loans: LoansService,
  ) {}

  async build(groupId: string, name: ReportName, q: { from: string; to: string; memberId?: string }, viewer: MembershipContext): Promise<Report> {
    const period = { gte: dbDate(q.from), lte: dbDate(q.to) };
    switch (name) {
      case 'cashbook': {
        const s = await this.statements.groupStatement(groupId, q.from, q.to, { showMemberNames: true });
        return {
          title: 'Cashbook',
          headers: ['Date', 'Type', 'Description', 'Member', 'Reference', 'In (KSh)', 'Out (KSh)', 'Balance (KSh)'],
          rows: [['', 'Opening balance', '', '', '', '', '', d(s.openingBalanceCents)], ...s.transactions.map((t) => [t.date, t.type, t.description, t.memberName, t.reference, d(t.inflowCents), d(t.outflowCents), d(t.balanceCents)])],
          totals: { openingCents: s.openingBalanceCents, closingCents: s.closingBalanceCents },
        };
      }
      case 'group-statement': {
        const s = await this.statements.groupStatement(groupId, q.from, q.to, { showMemberNames: false });
        const lines: [string, number][] = [
          ['Opening balance', s.openingBalanceCents],
          ['Contributions received', s.contributionsCents],
          ['Loan repayments (principal)', s.loanRepaymentsCents],
          ['Interest received', s.interestReceivedCents],
          ['Fines received', s.finesReceivedCents],
          ['Other income / opening balances', s.otherIncomeCents],
          ['Expenses', -s.expensesCents],
          ['Loans disbursed', -s.loansDisbursedCents],
          ['Rotation payouts', -s.payoutsCents],
          ['Distributions', -s.distributionsCents],
          ['Closing balance', s.closingBalanceCents],
          ['Loans outstanding (not cash)', s.loansOutstandingCents],
        ];
        return { title: 'Group statement', headers: ['Line', 'Amount (KSh)'], rows: lines.map(([k, v]) => [k, d(v)]) };
      }
      case 'contributions': {
        const page = await this.contributions.ledger(groupId, { page: 1, pageSize: 100000, from: q.from, to: q.to, memberId: q.memberId });
        return {
          title: 'Contributions report',
          headers: ['Due date', 'Member', 'Period', 'Expected', 'Received', 'Pending', 'Outstanding', 'Status'],
          rows: page.items.map((r) => [r.dueDate, r.memberName, r.period, d(r.expectedCents), d(r.receivedCents), d(r.pendingCents), d(r.outstandingCents), r.status]),
          totals: { expectedCents: page.items.reduce((a, r) => a + r.expectedCents, 0), receivedCents: page.items.reduce((a, r) => a + r.receivedCents, 0) },
        };
      }
      case 'loan-portfolio': {
        const list = await this.loans.list(groupId, viewer, {});
        return {
          title: 'Loan portfolio',
          headers: ['Member', 'Status', 'Method', 'Rate (bps/period)', 'Principal', 'Interest', 'Paid', 'Outstanding', 'Overdue', 'Disbursed', 'Next due'],
          rows: list.map((l) => [l.memberName, l.status, LABELS.interestMethod[l.interestMethod], l.rateBps, d(l.principalCents), d(l.interestCents), d(l.paidCents), d(l.outstandingCents), d(l.overdueCents), l.disbursedAt, l.nextInstallment?.dueDate ?? '']),
          totals: { outstandingCents: list.reduce((a, l) => a + l.outstandingCents, 0), overdueCents: list.reduce((a, l) => a + l.overdueCents, 0) },
        };
      }
      case 'repayments':
      case 'member-statement': {
        if (name === 'member-statement' && !q.memberId) throw new BadRequestException('Select a member');
        const rows = await this.prisma.payment.findMany({
          where: { groupId, paidAt: period, ...(name === 'repayments' ? { purpose: 'LOAN_REPAYMENT' } : { membershipId: q.memberId }) },
          include: { membership: { select: { user: { select: { fullName: true } } } }, allocations: true },
          orderBy: { paidAt: 'asc' },
        });
        return {
          title: name === 'repayments' ? 'Repayment report' : `Member statement — ${rows[0]?.membership?.user.fullName ?? ''}`,
          headers: ['Date', 'Member', 'Purpose', 'Method', 'Reference', 'Amount', 'Principal', 'Interest', 'Status'],
          rows: rows.map((p) => [isoDate(p.paidAt), p.membership?.user.fullName ?? '', p.purpose, p.method, p.reference, d(n(p.amountCents)), d(p.allocations.reduce((a, x) => a + n(x.principalCents), 0)), d(p.allocations.reduce((a, x) => a + n(x.interestCents), 0)), p.status]),
        };
      }
      case 'expenses': {
        const rows = await this.prisma.expense.findMany({ where: { groupId, incurredOn: period }, orderBy: { incurredOn: 'asc' } });
        return {
          title: 'Expenses report',
          headers: ['Date', 'Category', 'Description', 'Payee', 'Amount', 'Status', 'Paid on', 'Reference'],
          rows: rows.map((e) => [isoDate(e.incurredOn), e.category, e.description, e.payee, d(n(e.amountCents)), e.status, isoDate(e.paidAt), e.paymentReference]),
          totals: { paidCents: rows.filter((e) => e.status === 'PAID').reduce((a, e) => a + n(e.amountCents), 0) },
        };
      }
      case 'fines': {
        const rows = await this.prisma.fine.findMany({ where: { groupId, issuedOn: period }, include: { membership: { select: { user: { select: { fullName: true } } } } }, orderBy: { issuedOn: 'asc' } });
        return {
          title: 'Fines report',
          headers: ['Date', 'Member', 'Reason', 'Amount', 'Paid', 'Status', 'Waiver reason'],
          rows: rows.map((f) => [isoDate(f.issuedOn), f.membership.user.fullName, f.reason, d(n(f.amountCents)), d(n(f.paidCents)), f.status, f.waivedReason]),
        };
      }
      case 'payouts': {
        const rows = await this.prisma.payoutRound.findMany({ where: { cycle: { groupId, status: { in: ['ACTIVE', 'COMPLETED'] } }, payoutDate: period }, include: { cycle: { select: { name: true } }, membership: { select: { user: { select: { fullName: true } } } } }, orderBy: [{ cycleId: 'asc' }, { round: 'asc' }, { slot: 'asc' }] });
        return {
          title: 'Payout report',
          headers: ['Cycle', 'Round', 'Recipient', 'Scheduled date', 'Expected', 'Paid', 'Status', 'Reference', 'Shortfall reason'],
          rows: rows.map((r) => [r.cycle.name, r.round, r.membership.user.fullName, isoDate(r.payoutDate), d(n(r.expectedCents)), r.payoutAmountCents === null ? '' : d(n(r.payoutAmountCents)), r.status, r.payoutReference, r.shortfallReason]),
        };
      }
      case 'distributions': {
        const rows = await this.prisma.distributionAllocation.findMany({ where: { distribution: { groupId, periodTo: period } }, include: { distribution: { select: { title: true, method: true, status: true } }, membership: { select: { user: { select: { fullName: true } } } } } });
        return {
          title: 'Distribution report',
          headers: ['Distribution', 'Method', 'Status', 'Member', 'Gross', 'Loan offset', 'Net paid', 'Paid on', 'Reference'],
          rows: rows.map((a) => [a.distribution.title, LABELS.distributionMethod[a.distribution.method], a.distribution.status, a.membership.user.fullName, d(n(a.grossCents)), d(n(a.loanOffsetCents)), d(n(a.netCents)), isoDate(a.paidAt), a.paymentReference]),
        };
      }
      case 'income-expenditure': {
        const lines = await this.prisma.journalLine.findMany({
          where: { entry: { groupId, entryDate: period }, account: { in: ['INTEREST_INCOME', 'FINE_INCOME', 'OTHER_INCOME', 'EXPENSES'] } },
          select: { account: true, amountCents: true, entry: { select: { entryDate: true } } },
        });
        const months = new Map<string, { interest: number; fines: number; other: number; expenses: number }>();
        for (const l of lines) {
          const m = isoDate(l.entry.entryDate).slice(0, 7);
          const b = months.get(m) ?? { interest: 0, fines: 0, other: 0, expenses: 0 };
          const v = n(l.amountCents);
          if (l.account === 'INTEREST_INCOME') b.interest -= v;
          if (l.account === 'FINE_INCOME') b.fines -= v;
          if (l.account === 'OTHER_INCOME') b.other -= v;
          if (l.account === 'EXPENSES') b.expenses += v;
          months.set(m, b);
        }
        const sorted = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
        return {
          title: 'Income and expenditure',
          headers: ['Month', 'Interest income', 'Fine income', 'Other income', 'Total income', 'Expenditure', 'Surplus / (deficit)'],
          rows: sorted.map(([m, b]) => {
            const income = b.interest + b.fines + b.other;
            return [m, d(b.interest), d(b.fines), d(b.other), d(income), d(b.expenses), d(income - b.expenses)];
          }),
        };
      }
      case 'audit': {
        const rows = await this.prisma.auditEvent.findMany({ where: { groupId, ...auditScope(viewer), createdAt: { gte: dbDate(q.from), lt: new Date(dbDate(q.to).getTime() + 86_400_000) } }, include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } });
        return {
          title: 'Audit report',
          headers: ['Time (UTC)', 'User', 'Action', 'Record', 'Record id', 'Reason', 'Approval', 'Reference'],
          rows: rows.map((a) => [a.createdAt.toISOString(), a.actor?.fullName ?? 'System', a.action, a.entityType, a.entityId, a.reason, a.approvalStatus, a.reference]),
        };
      }
    }
  }

  describe(name: ReportName, q: { from: string; to: string }) {
    return `${name}-${q.from}-to-${q.to}`.replace(/[^\w.-]/g, '_') + ` (${formatDate(q.from)} – ${formatDate(q.to)})`;
  }
}
