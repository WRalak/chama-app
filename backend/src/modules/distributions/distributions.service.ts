import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeDistribution, DistributionPreviewInput, DistributionRecord, DistributionResult, formatKes } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../finance/approvals.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { readSettings } from '../finance/policies';
import { PostingService } from '../finance/posting.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class DistributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly finance: MemberFinanceService,
    private readonly ledger: LedgerService,
    private readonly posting: PostingService,
    private readonly notifications: NotificationsService,
  ) {}

  async preview(groupId: string, input: DistributionPreviewInput): Promise<DistributionResult> {
    if (input.periodFrom > input.periodTo) throw new UnprocessableEntityException('Period start must be before period end');
    const members = await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE' }, include: { user: { select: { fullName: true } } } });
    const ids = members.map((m) => m.id);
    const [cash, savings, loans] = await Promise.all([
      this.ledger.cashBalance(groupId),
      this.finance.savingsByMembership(groupId, ids, { from: input.periodFrom, to: input.periodTo }),
      this.finance.loanBalances(groupId, ids),
    ]);
    return computeDistribution({
      method: input.method,
      availableCashCents: cash,
      liabilitiesCents: input.liabilitiesCents,
      retainedCents: input.retainedCents,
      amountToDistributeCents: input.amountToDistributeCents,
      offsetOutstandingLoans: input.offsetOutstandingLoans,
      members: members.map((m) => ({
        memberId: m.id,
        name: m.user.fullName,
        contributedCents: savings.get(m.id) ?? 0,
        shares: input.shares?.[m.id] ?? m.shares,
        outstandingLoanCents: loans.get(m.id) ?? 0,
      })),
    });
  }

  async create(groupId: string, input: DistributionPreviewInput & { title: string }, actor: MembershipContext, meta: RequestMeta) {
    const calc = await this.preview(groupId, input);
    if (calc.distributedCents <= 0) throw new UnprocessableEntityException('Nothing is available to distribute with these settings');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.distribution.create({
        data: {
          groupId,
          title: input.title,
          method: input.method,
          periodFrom: dbDate(input.periodFrom),
          periodTo: dbDate(input.periodTo),
          status: 'PENDING_APPROVAL',
          calculation: calc as unknown as Prisma.InputJsonValue,
          inputs: input as unknown as Prisma.InputJsonValue,
          requiredApprovals: readSettings(group.settings).requiredFinancialApprovals,
          createdById: actor.userId,
          allocations: {
            create: calc.allocations.filter((a) => a.grossCents > 0).map((a) => ({ membershipId: a.memberId, grossCents: big(a.grossCents), loanOffsetCents: big(a.loanOffsetCents), netCents: big(a.netPayableCents) })),
          },
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'distribution.created', entityType: 'Distribution', entityId: created.id, after: { input, totals: { distributable: calc.distributableCents, distributed: calc.distributedCents } }, approvalStatus: 'PENDING', meta }, tx);
      return created;
    });
    return this.detail(groupId, d.id);
  }

  async list(groupId: string) {
    const rows = await this.prisma.distribution.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.detail(groupId, r.id)));
  }

  async detail(groupId: string, id: string): Promise<DistributionRecord> {
    const d = await this.prisma.distribution.findFirst({ where: { id, groupId }, include: { allocations: { include: { membership: { select: { user: { select: { fullName: true } } } } } } } });
    if (!d) throw new NotFoundException('Distribution not found');
    const creator = await this.prisma.user.findUnique({ where: { id: d.createdById }, select: { fullName: true } });
    return {
      id: d.id,
      title: d.title,
      status: d.status,
      method: d.method,
      periodFrom: isoDate(d.periodFrom),
      periodTo: isoDate(d.periodTo),
      calculation: d.calculation as unknown as DistributionResult,
      approvals: (await this.approvals.records('DISTRIBUTION', [d.id])).get(d.id) ?? [],
      approvalsRequired: d.requiredApprovals,
      createdByName: creator?.fullName ?? '',
      createdAt: d.createdAt.toISOString(),
      allocations: d.allocations
        .map((a) => ({
          id: a.id,
          membershipId: a.membershipId,
          memberName: a.membership.user.fullName,
          grossCents: n(a.grossCents),
          loanOffsetCents: n(a.loanOffsetCents),
          netPayableCents: n(a.netCents),
          paidAt: isoDate(a.paidAt),
          paymentReference: a.paymentReference,
        }))
        .sort((a, b) => a.memberName.localeCompare(b.memberName)),
    };
  }

  async decide(groupId: string, id: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const d = await this.prisma.distribution.findFirst({ where: { id, groupId } });
    if (!d) throw new NotFoundException('Distribution not found');
    if (d.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException('This distribution is not awaiting approval');
    if (d.createdById === actor.userId) throw new ForbiddenException('Another officer must approve a distribution you prepared.');
    await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'DISTRIBUTION', entityId: d.id, approverMembershipId: actor.id, decision, comment, excludedMembershipIds: [], required: d.requiredApprovals });
      if (r.rejected) await tx.distribution.update({ where: { id: d.id }, data: { status: 'CANCELLED' } });
      else if (r.reached) {
        const cash = await this.ledger.cashBalance(groupId, {}, tx);
        const total = (d.calculation as unknown as DistributionResult).distributedCents;
        if (cash < total) throw new UnprocessableEntityException(`Cash has fallen to ${formatKes(cash)} since this was calculated. Recalculate before approving.`);
        await tx.distribution.update({ where: { id: d.id }, data: { status: 'APPROVED' } });
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `distribution.${decision.toLowerCase()}`, entityType: 'Distribution', entityId: d.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
    });
    return this.detail(groupId, id);
  }

  async payAllocation(groupId: string, id: string, allocationId: string, input: { method: string; reference?: string; paidAt: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    const replay = await this.prisma.distributionAllocation.findUnique({ where: { paymentKey: input.idempotencyKey } });
    if (replay) {
      if (replay.id !== allocationId) throw new UnprocessableEntityException('This idempotency key was used for another payment');
      return this.detail(groupId, id);
    }
    const d = await this.prisma.distribution.findFirst({ where: { id, groupId }, include: { allocations: true } });
    if (!d) throw new NotFoundException('Distribution not found');
    if (d.status !== 'APPROVED') throw new UnprocessableEntityException('Only approved distributions can be paid');
    const a = d.allocations.find((x) => x.id === allocationId);
    if (!a) throw new NotFoundException('Allocation not found');
    if (a.paidAt) throw new UnprocessableEntityException('Already paid');
    if (a.membershipId === actor.id) throw new ForbiddenException('Another officer must record your own distribution payment.');
    if (input.paidAt > today()) throw new UnprocessableEntityException('Payment date cannot be in the future');
    await this.prisma.financial(async (tx) => {
      const gross = n(a.grossCents);
      // Offset only what is still owed now (loans may have been repaid since calculation).
      const owed = (await this.finance.loanBalances(groupId, [a.membershipId], tx)).get(a.membershipId) ?? 0;
      const offset = Math.min(n(a.loanOffsetCents), owed);
      const net = gross - offset;
      const cash = await this.ledger.cashBalance(groupId, {}, tx);
      if (cash < net) throw new UnprocessableEntityException(`Insufficient group funds: available ${formatKes(cash)}`);
      const claimed = await tx.distributionAllocation.updateMany({
        where: { id: a.id, paidAt: null },
        data: { paidAt: dbDate(input.paidAt), paymentMethod: input.method as never, paymentReference: input.reference ?? null, paymentKey: input.idempotencyKey, loanOffsetCents: big(offset), netCents: big(net) },
      });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Already paid');
      await this.ledger.post(tx, {
        groupId,
        entryDate: input.paidAt,
        type: 'DISTRIBUTION',
        description: `${d.title}: distribution`,
        reference: input.reference ?? null,
        membershipId: a.membershipId,
        allocationId: a.id,
        createdById: actor.userId,
        lines: [
          { account: 'DISTRIBUTIONS', amountCents: gross },
          { account: 'CASH', amountCents: -gross },
        ],
      });
      // The offset is a real loan repayment out of the member's share.
      let remaining = offset;
      const loans = await tx.loan.findMany({ where: { groupId, membershipId: a.membershipId, status: 'DISBURSED' }, orderBy: { disbursedAt: 'asc' }, include: { installments: true } });
      for (const loan of loans) {
        if (remaining <= 0) break;
        const loanOwed = loan.installments.reduce((s, i) => s + n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0);
        const take = Math.min(loanOwed, remaining);
        if (take <= 0) continue;
        remaining -= take;
        const p = await tx.payment.create({
          data: { groupId, membershipId: a.membershipId, amountCents: big(take), method: 'OTHER', source: 'MANUAL', purpose: 'LOAN_REPAYMENT', status: 'PENDING', paidAt: dbDate(input.paidAt), idempotencyKey: `dist:${a.id}:${loan.id}`, targetId: loan.id, recordedById: actor.userId, notes: `Offset from distribution "${d.title}"` },
        });
        await this.posting.confirm(tx, p.id, actor.userId);
      }
      const unpaid = await tx.distributionAllocation.count({ where: { distributionId: d.id, paidAt: null } });
      if (unpaid === 0) await tx.distribution.update({ where: { id: d.id }, data: { status: 'PAID' } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'distribution.allocation_paid', entityType: 'DistributionAllocation', entityId: a.id, after: { gross, offset, net, ...input }, reference: input.reference, meta }, tx);
    });
    const m = await this.prisma.membership.findUniqueOrThrow({ where: { id: a.membershipId }, select: { userId: true } });
    await this.notifications.notify([m.userId], { groupId, type: 'PAYOUT_COMPLETED', title: 'Distribution paid', body: `Your share of "${d.title}" has been paid.` });
    return this.detail(groupId, id);
  }

  async cancel(groupId: string, id: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const d = await this.prisma.distribution.findFirst({ where: { id, groupId }, include: { allocations: true } });
    if (!d) throw new NotFoundException('Distribution not found');
    if (d.allocations.some((a) => a.paidAt)) throw new UnprocessableEntityException('Payments have already been made from this distribution');
    if (!['PENDING_APPROVAL', 'APPROVED', 'DRAFT'].includes(d.status)) throw new UnprocessableEntityException('This distribution cannot be cancelled');
    await this.prisma.distribution.update({ where: { id: d.id }, data: { status: 'CANCELLED' } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'distribution.cancelled', entityType: 'Distribution', entityId: d.id, reason, meta });
    return this.detail(groupId, id);
  }
}
