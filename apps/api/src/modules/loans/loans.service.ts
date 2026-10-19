import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  checkLoanEligibility,
  computeLoanSchedule,
  formatKes,
  Frequency,
  LoanApplicationInput,
  LoanDetail,
  LoanQuote,
  LoanSummary,
  periodDate,
  Permission,
} from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../finance/approvals.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { readLoanPolicy } from '../finance/policies';
import { installmentStatus } from '../finance/posting.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentInclude, toPaymentItems } from '../contributions/payment-mapper';

const loanInclude = {
  group: { select: { name: true } },
  membership: { select: { userId: true, user: { select: { fullName: true } } } },
  installments: { orderBy: { number: 'asc' } },
} satisfies Prisma.LoanInclude;
type LoanRow = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly finance: MemberFinanceService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  private async policy(groupId: string) {
    const g = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { loanPolicy: true } });
    return readLoanPolicy(g.loanPolicy);
  }

  async quote(groupId: string, membership: MembershipContext, input: { principalCents: number; installments: number; firstDueDate?: string }): Promise<LoanQuote> {
    const policy = await this.policy(groupId);
    const firstDueDate = input.firstDueDate ?? periodDate(today(), policy.repaymentFrequency as Frequency, 1);
    const schedule = computeLoanSchedule({
      principalCents: input.principalCents,
      rateBps: policy.rateBps,
      method: policy.interestMethod,
      installments: input.installments,
      frequency: policy.repaymentFrequency as Frequency,
      firstDueDate,
    });
    const eligibility = membership.id ? await this.eligibility(groupId, membership.id, input.principalCents, input.installments) : undefined;
    return { ...schedule, rateBps: policy.rateBps, frequency: policy.repaymentFrequency as Frequency, eligibility };
  }

  private async eligibility(groupId: string, membershipId: string, principalCents: number, installments: number) {
    const policy = await this.policy(groupId);
    const savings = (await this.finance.savingsByMembership(groupId, [membershipId])).get(membershipId) ?? 0;
    const outstanding = await this.finance.outstandingPrincipal(groupId, membershipId);
    const r = checkLoanEligibility({ policy, requestedCents: principalCents, installments, memberSavingsCents: savings, memberOutstandingLoanCents: outstanding });
    if (!policy.enabled) r.reasons.unshift('This group does not currently offer loans');
    return { ...r, eligible: r.eligible && policy.enabled };
  }

  async apply(groupId: string, input: LoanApplicationInput, actor: MembershipContext, meta: RequestMeta) {
    const policy = await this.policy(groupId);
    const elig = await this.eligibility(groupId, actor.id, input.principalCents, input.installments);
    if (!elig.eligible) throw new UnprocessableEntityException({ message: elig.reasons[0] ?? 'Not eligible', details: elig });
    const open = await this.prisma.loan.count({ where: { membershipId: actor.id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } });
    if (open > 0) throw new UnprocessableEntityException('You already have a loan application in progress.');
    if (input.guarantorMemberIds.includes(actor.id)) throw new UnprocessableEntityException('You cannot guarantee your own loan.');
    if (input.guarantorMemberIds.length) {
      const ok = await this.prisma.membership.count({ where: { groupId, id: { in: input.guarantorMemberIds }, status: 'ACTIVE' } });
      if (ok !== new Set(input.guarantorMemberIds).size) throw new UnprocessableEntityException('Guarantors must be active members of this group.');
    }
    const preview = computeLoanSchedule({
      principalCents: input.principalCents,
      rateBps: policy.rateBps,
      method: policy.interestMethod,
      installments: input.installments,
      frequency: policy.repaymentFrequency as Frequency,
      firstDueDate: periodDate(today(), policy.repaymentFrequency as Frequency, 1),
    });
    const loan = await this.prisma.$transaction(async (tx) => {
      const l = await tx.loan.create({
        data: {
          groupId,
          membershipId: actor.id,
          principalCents: big(input.principalCents),
          rateBps: policy.rateBps,
          interestMethod: policy.interestMethod,
          installmentsCount: input.installments,
          frequency: policy.repaymentFrequency,
          totalInterestCents: big(preview.totalInterestCents),
          purpose: input.purpose,
          requiredApprovals: policy.requiredApprovals,
          allowSelfApproval: policy.allowSelfApproval,
          policySnapshot: policy,
          guarantors: { create: input.guarantorMemberIds.map((membershipId) => ({ membershipId })) },
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'loan.applied', entityType: 'Loan', entityId: l.id, after: { ...input, policy }, approvalStatus: 'PENDING', meta }, tx);
      return l;
    });
    const approvers = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER'])).filter((u) => u !== actor.userId);
    await this.notifications.notify(approvers, { groupId, type: 'APPROVAL_REQUIRED', title: 'Loan application to review', body: `${formatKes(input.principalCents)} over ${input.installments} installments.`, data: { loanId: loan.id } });
    return this.detail(groupId, loan.id, actor);
  }

  async list(groupId: string, viewer: MembershipContext, q: { status?: string; memberId?: string; overdue?: boolean }): Promise<LoanSummary[]> {
    const canAll = viewer.permissions.includes(Permission.LOANS_VIEW_ALL);
    const rows = await this.prisma.loan.findMany({
      where: {
        groupId,
        ...(canAll ? (q.memberId ? { membershipId: q.memberId } : {}) : { membershipId: viewer.id }),
        ...(q.status ? { status: q.status as never } : {}),
      },
      include: loanInclude,
      orderBy: { appliedAt: 'desc' },
    });
    const approvals = await this.approvals.records('LOAN', rows.map((r) => r.id));
    const summaries = rows.map((l) => this.summary(l, approvals.get(l.id)?.filter((a) => a.decision === 'APPROVED').length ?? 0));
    return q.overdue ? summaries.filter((s) => s.overdueCents > 0) : summaries;
  }

  private summary(l: LoanRow, approvalsReceived: number): LoanSummary {
    const t = today();
    const paid = l.installments.reduce((a, i) => a + n(i.principalPaidCents) + n(i.interestPaidCents), 0);
    const total = n(l.principalCents) + n(l.totalInterestCents);
    const next = l.installments.find((i) => installmentStatus(i, t) !== 'PAID');
    const overdue = l.installments
      .filter((i) => installmentStatus(i, t) === 'OVERDUE')
      .reduce((a, i) => a + n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0);
    return {
      id: l.id,
      groupId: l.groupId,
      groupName: l.group.name,
      membershipId: l.membershipId,
      memberName: l.membership.user.fullName,
      principalCents: n(l.principalCents),
      interestCents: n(l.totalInterestCents),
      totalRepayableCents: total,
      paidCents: paid,
      outstandingCents: l.status === 'DISBURSED' ? total - paid : 0,
      status: l.status,
      interestMethod: l.interestMethod,
      rateBps: l.rateBps,
      installments: l.installmentsCount,
      purpose: l.purpose,
      appliedAt: l.appliedAt.toISOString(),
      disbursedAt: isoDate(l.disbursedAt),
      nextInstallment: next ? { dueDate: isoDate(next.dueDate), amountCents: n(next.principalCents) + n(next.interestCents) - n(next.principalPaidCents) - n(next.interestPaidCents) } : null,
      overdueCents: overdue,
      approvalsReceived,
      approvalsRequired: l.requiredApprovals,
    };
  }

  async detail(groupId: string, loanId: string, viewer: MembershipContext): Promise<LoanDetail> {
    const l = await this.prisma.loan.findFirst({ where: { id: loanId, groupId }, include: { ...loanInclude, guarantors: { include: { membership: { select: { user: { select: { fullName: true } } } } } } } });
    if (!l) throw new NotFoundException('Loan not found');
    const own = l.membershipId === viewer.id;
    if (!own && !viewer.permissions.includes(Permission.LOANS_VIEW_ALL)) throw new NotFoundException('Loan not found');
    const approvals = (await this.approvals.records('LOAN', [l.id])).get(l.id) ?? [];
    const repayments = await this.prisma.payment.findMany({ where: { groupId, purpose: 'LOAN_REPAYMENT', targetId: l.id }, include: paymentInclude, orderBy: { paidAt: 'desc' } });
    const t = today();
    const myDecision = await this.prisma.approval.findUnique({ where: { entityType_entityId_approverMembershipId: { entityType: 'LOAN', entityId: l.id, approverMembershipId: viewer.id || '-' } } });
    return {
      ...this.summary(l, approvals.filter((a) => a.decision === 'APPROVED').length),
      schedule: l.installments.map((i) => ({
        id: i.id,
        number: i.number,
        dueDate: isoDate(i.dueDate),
        principalCents: n(i.principalCents),
        interestCents: n(i.interestCents),
        totalCents: n(i.principalCents) + n(i.interestCents),
        paidCents: n(i.principalPaidCents) + n(i.interestPaidCents),
        status: installmentStatus(i, t),
      })),
      repayments: await toPaymentItems(this.prisma, repayments),
      approvals,
      guarantors: l.guarantors.map((g) => ({ membershipId: g.membershipId, name: g.membership.user.fullName })),
      disbursementReference: l.disbursementReference,
      canApprove:
        l.status === 'PENDING_APPROVAL' &&
        viewer.permissions.includes(Permission.LOANS_APPROVE) &&
        !myDecision &&
        (!own || l.allowSelfApproval),
      canDisburse: l.status === 'APPROVED' && viewer.permissions.includes(Permission.LOANS_DISBURSE) && !own,
    };
  }

  async decide(groupId: string, loanId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const loan = await this.prisma.loan.findFirst({ where: { id: loanId, groupId }, include: { membership: { select: { userId: true } } } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException('This loan is not awaiting approval');
    const self = loan.membershipId === actor.id;
    if (self && decision === 'APPROVE' && !loan.allowSelfApproval) {
      throw new ForbiddenException('You cannot approve your own loan.');
    }
    const result = await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, {
        groupId,
        entityType: 'LOAN',
        entityId: loan.id,
        approverMembershipId: actor.id,
        decision,
        comment,
        excludedMembershipIds: [],
        required: loan.requiredApprovals,
      });
      // Control for policies that allow self-approval: the borrower's approval
      // never counts on its own; at least one independent officer must approve.
      let reached = r.reached;
      if (reached && loan.allowSelfApproval) {
        const independent = await tx.approval.count({ where: { entityType: 'LOAN', entityId: loan.id, decision: 'APPROVED', approverMembershipId: { not: loan.membershipId } } });
        reached = independent >= Math.max(1, loan.requiredApprovals - 1);
      }
      if (r.rejected) await tx.loan.update({ where: { id: loan.id }, data: { status: 'REJECTED', decidedAt: new Date() } });
      else if (reached) await tx.loan.update({ where: { id: loan.id }, data: { status: 'APPROVED', decidedAt: new Date() } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: self ? 'loan.self_decision' : `loan.${decision.toLowerCase()}`, entityType: 'Loan', entityId: loan.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : reached ? 'APPROVED' : 'PENDING', after: { approvals: r.approvals, required: loan.requiredApprovals }, meta }, tx);
      return { ...r, reached };
    });
    if (result.rejected || result.reached) {
      await this.notifications.notify([loan.membership.userId], {
        groupId,
        type: result.rejected ? 'LOAN_REJECTED' : 'LOAN_APPROVED',
        title: result.rejected ? 'Loan application declined' : 'Loan approved',
        body: result.rejected ? `Your loan of ${formatKes(n(loan.principalCents))} was declined.${comment ? ` Reason: ${comment}` : ''}` : `Your loan of ${formatKes(n(loan.principalCents))} was approved and awaits disbursement.`,
        data: { loanId: loan.id },
      });
    }
    return this.detail(groupId, loan.id, actor);
  }

  async disburse(groupId: string, loanId: string, input: { method: string; reference?: string; disbursedAt: string; firstDueDate: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    const existing = await this.prisma.loan.findUnique({ where: { disbursementKey: input.idempotencyKey } });
    if (existing) {
      if (existing.id !== loanId) throw new UnprocessableEntityException('This idempotency key was used for another loan');
      return this.detail(groupId, loanId, actor);
    }
    const loan = await this.prisma.loan.findFirst({ where: { id: loanId, groupId } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.membershipId === actor.id) throw new ForbiddenException('You cannot disburse your own loan.');
    if (loan.status !== 'APPROVED') throw new UnprocessableEntityException('Only approved loans can be disbursed');
    if (input.disbursedAt > today()) throw new UnprocessableEntityException('Disbursement date cannot be in the future');
    if (input.firstDueDate <= input.disbursedAt) throw new UnprocessableEntityException('The first installment must fall after the disbursement date');
    if (input.firstDueDate > addDays(input.disbursedAt, 120)) throw new UnprocessableEntityException('The first installment must be within 120 days of disbursement');

    await this.prisma.financial(async (tx) => {
      const cash = await this.ledger.cashBalance(groupId, {}, tx);
      if (cash < n(loan.principalCents)) {
        throw new UnprocessableEntityException(`Insufficient group funds: available ${formatKes(cash)}, loan ${formatKes(n(loan.principalCents))}`);
      }
      const schedule = computeLoanSchedule({
        principalCents: n(loan.principalCents),
        rateBps: loan.rateBps,
        method: loan.interestMethod,
        installments: loan.installmentsCount,
        frequency: loan.frequency as Frequency,
        firstDueDate: input.firstDueDate,
      });
      const claimed = await tx.loan.updateMany({
        where: { id: loan.id, status: 'APPROVED' },
        data: {
          status: 'DISBURSED',
          disbursedAt: dbDate(input.disbursedAt),
          disbursementMethod: input.method as never,
          disbursementReference: input.reference?.toUpperCase() ?? null,
          disbursementKey: input.idempotencyKey,
          disbursedById: actor.userId,
          totalInterestCents: big(schedule.totalInterestCents),
        },
      });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Loan was already disbursed');
      await tx.loanInstallment.createMany({
        data: schedule.installments.map((i) => ({
          loanId: loan.id,
          number: i.number,
          dueDate: dbDate(i.dueDate),
          principalCents: big(i.principalCents),
          interestCents: big(i.interestCents),
        })),
      });
      await this.ledger.post(tx, {
        groupId,
        entryDate: input.disbursedAt,
        type: 'LOAN_DISBURSEMENT',
        description: `Loan disbursed ${formatKes(n(loan.principalCents))}`,
        reference: input.reference ?? null,
        membershipId: loan.membershipId,
        loanId: loan.id,
        createdById: actor.userId,
        lines: [
          { account: 'LOANS_RECEIVABLE', amountCents: n(loan.principalCents) },
          { account: 'CASH', amountCents: -n(loan.principalCents) },
        ],
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'loan.disbursed', entityType: 'Loan', entityId: loan.id, after: { ...input, totalInterestCents: schedule.totalInterestCents }, reference: input.reference, meta }, tx);
    });
    return this.detail(groupId, loan.id, actor);
  }

  async cancel(groupId: string, loanId: string, actor: MembershipContext, meta: RequestMeta) {
    const loan = await this.prisma.loan.findFirst({ where: { id: loanId, groupId } });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.membershipId !== actor.id && !actor.permissions.includes(Permission.LOANS_APPROVE)) throw new ForbiddenException('Only the applicant or an approver can cancel this application');
    const r = await this.prisma.loan.updateMany({ where: { id: loan.id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, data: { status: 'CANCELLED', decidedAt: new Date() } });
    if (r.count !== 1) throw new UnprocessableEntityException('Only loans not yet disbursed can be cancelled');
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'loan.cancelled', entityType: 'Loan', entityId: loan.id, meta });
    return this.detail(groupId, loan.id, actor);
  }
}
