import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContributionLedgerRow,
  CreateScheduleInput,
  formatKes,
  Permission,
  RecordPaymentInput,
  ReconciliationSummary,
  ScheduleRow,
} from '@chamahub/shared';
import { z } from 'zod';
import { paymentFilterSchema } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { paginate, skipTake } from '../../common/pagination';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { obligationStatus, ObligationsService } from '../finance/obligations.service';
import { PostingService } from '../finance/posting.service';
import { readSettings } from '../finance/policies';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentInclude, toPaymentItems } from './payment-mapper';

/** Methods whose references are externally issued and must be unique within a group. */
const UNIQUE_REFERENCE_METHODS = ['MPESA', 'BANK_TRANSFER', 'CHEQUE'];

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly obligations: ObligationsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------- schedules ---------- */

  async schedules(groupId: string): Promise<ScheduleRow[]> {
    const rows = await this.prisma.contributionSchedule.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } } },
    });
    const active = await this.prisma.membership.count({ where: { groupId, status: 'ACTIVE' } });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      amountCents: n(s.amountCents),
      frequency: s.frequency,
      startDate: isoDate(s.startDate),
      endDate: isoDate(s.endDate),
      active: s.active,
      memberCount: s.allMembers ? active : s._count.members,
    }));
  }

  async createSchedule(groupId: string, input: CreateScheduleInput, actor: MembershipContext, meta: RequestMeta) {
    if (input.endDate && input.endDate < input.startDate) throw new UnprocessableEntityException('End date must be after the start date');
    if (input.memberIds?.length) {
      const count = await this.prisma.membership.count({ where: { groupId, id: { in: input.memberIds }, status: 'ACTIVE' } });
      if (count !== new Set(input.memberIds).size) throw new UnprocessableEntityException('Some selected members are not active in this group');
    }
    const s = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contributionSchedule.create({
        data: {
          groupId,
          name: input.name,
          amountCents: big(input.amountCents),
          frequency: input.frequency,
          startDate: dbDate(input.startDate),
          endDate: input.endDate ? dbDate(input.endDate) : null,
          allMembers: !input.memberIds?.length,
          createdById: actor.userId,
          members: input.memberIds?.length ? { create: input.memberIds.map((membershipId) => ({ membershipId })) } : undefined,
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'schedule.created', entityType: 'ContributionSchedule', entityId: created.id, after: input, meta }, tx);
      return created;
    });
    await this.obligations.ensureForGroup(groupId);
    return { id: s.id };
  }

  async deactivateSchedule(groupId: string, scheduleId: string, actor: MembershipContext, meta: RequestMeta) {
    const s = await this.prisma.contributionSchedule.findFirst({ where: { id: scheduleId, groupId } });
    if (!s) throw new NotFoundException('Schedule not found');
    if (s.cycleId) throw new UnprocessableEntityException('Rotation schedules are managed from the rotation');
    await this.prisma.contributionSchedule.update({ where: { id: s.id }, data: { active: false, endDate: dbDate(today()) } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'schedule.deactivated', entityType: 'ContributionSchedule', entityId: s.id, meta });
    return { ok: true };
  }

  /* ---------- payments ---------- */

  async record(groupId: string, input: RecordPaymentInput, actor: MembershipContext, meta: RequestMeta) {
    const needed = input.purpose === 'LOAN_REPAYMENT' ? Permission.REPAYMENTS_RECORD : input.purpose === 'FINE' ? Permission.FINES_MANAGE : Permission.CONTRIBUTIONS_RECORD;
    // Members may report their OWN payment (e.g. an M-Pesa transfer) for an officer to verify.
    const selfReport = input.memberId === actor.id && !actor.permissions.includes(needed) && !actor.permissions.includes(Permission.CONTRIBUTIONS_RECORD);
    if (selfReport) {
      if (!actor.permissions.includes(Permission.LOANS_APPLY) && !actor.permissions.includes(Permission.VOTES_CAST)) {
        throw new ForbiddenException('Read-only members cannot report payments.');
      }
      if (!input.reference) throw new UnprocessableEntityException('Enter the M-Pesa or bank transaction code so the treasurer can verify it.');
    } else if (!actor.permissions.includes(needed) && !actor.permissions.includes(Permission.CONTRIBUTIONS_RECORD)) {
      throw new ForbiddenException('Your role in this group does not allow recording this payment.');
    }
    const fingerprint = { membershipId: input.memberId, amountCents: input.amountCents, purpose: input.purpose, targetId: input.targetId ?? null };
    const existing = await this.prisma.payment.findUnique({ where: { groupId_idempotencyKey: { groupId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return this.replay(existing, fingerprint);

    const member = await this.prisma.membership.findFirst({ where: { id: input.memberId, groupId } });
    if (!member || member.status === 'EXITED') throw new UnprocessableEntityException('This person is not an active member of the group');
    if (input.paidAt > today()) throw new UnprocessableEntityException('Payment date cannot be in the future');
    await this.validateTarget(groupId, input.memberId, input.purpose, input.targetId, input.amountCents);
    if (input.reference && UNIQUE_REFERENCE_METHODS.includes(input.method)) await this.assertReferenceUnused(groupId, input.reference);

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            groupId,
            membershipId: input.memberId,
            amountCents: big(input.amountCents),
            method: input.method,
            source: 'MANUAL',
            purpose: input.purpose,
            status: 'PENDING',
            reference: input.reference?.toUpperCase() ?? null,
            paidAt: dbDate(input.paidAt),
            idempotencyKey: input.idempotencyKey,
            targetId: input.targetId ?? null,
            notes: input.notes ?? null,
            recordedById: actor.userId,
          },
        });
        await this.audit.log({ groupId, actorUserId: actor.userId, action: selfReport ? 'payment.self_reported' : 'payment.recorded', entityType: 'Payment', entityId: p.id, after: p, reference: p.reference, approvalStatus: 'PENDING', meta }, tx);
        return p;
      });
      await this.notifyVerifiers(groupId, actor.userId, `${formatKes(input.amountCents)} payment awaiting verification`);
      return this.item(payment.id);
    } catch (err) {
      // A concurrent request with the same key won the race: return its result.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.payment.findUnique({ where: { groupId_idempotencyKey: { groupId, idempotencyKey: input.idempotencyKey } } });
        if (raced) return this.replay(raced, fingerprint);
      }
      throw err;
    }
  }

  private async replay(existing: { id: string; membershipId: string | null; amountCents: bigint; purpose: string; targetId: string | null }, fp: { membershipId: string; amountCents: number; purpose: string; targetId: string | null }) {
    if (existing.membershipId !== fp.membershipId || n(existing.amountCents) !== fp.amountCents || existing.purpose !== fp.purpose || existing.targetId !== fp.targetId) {
      throw new ConflictException('This idempotency key was already used for a different payment.');
    }
    return { ...(await this.item(existing.id)), replayed: true };
  }

  private async assertReferenceUnused(groupId: string, reference: string, exceptId?: string) {
    const dup = await this.prisma.payment.findFirst({
      where: { groupId, reference: reference.toUpperCase(), status: { notIn: ['FAILED'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new ConflictException(`Reference ${reference.toUpperCase()} has already been recorded in this group.`);
  }

  async validateTarget(groupId: string, membershipId: string, purpose: string, targetId: string | undefined, amountCents: number) {
    if (purpose === 'CONTRIBUTION') {
      if (targetId) {
        const o = await this.prisma.contributionObligation.findFirst({ where: { id: targetId, groupId, membershipId } });
        if (!o) throw new UnprocessableEntityException('The selected contribution does not belong to this member');
      }
      return;
    }
    if (!targetId) throw new UnprocessableEntityException(purpose === 'FINE' ? 'Select the fine being paid' : 'Select the loan being repaid');
    if (purpose === 'LOAN_REPAYMENT') {
      const loan = await this.prisma.loan.findFirst({ where: { id: targetId, groupId, membershipId }, include: { installments: true } });
      if (!loan || loan.status !== 'DISBURSED') throw new UnprocessableEntityException('Repayments can only be made to an active, disbursed loan of this member');
      const owed = loan.installments.reduce((a, i) => a + n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0);
      const pending = await this.prisma.payment.aggregate({ where: { targetId, status: 'PENDING' }, _sum: { amountCents: true } });
      if (amountCents + n(pending._sum.amountCents) > owed) {
        throw new UnprocessableEntityException(`Amount exceeds the outstanding loan balance of ${formatKes(owed)} (including pending payments)`);
      }
    }
    if (purpose === 'FINE') {
      const fine = await this.prisma.fine.findFirst({ where: { id: targetId, groupId, membershipId } });
      if (!fine || !['OUTSTANDING', 'PARTIAL'].includes(fine.status)) throw new UnprocessableEntityException('This fine is not payable');
      if (amountCents > n(fine.amountCents) - n(fine.paidCents)) throw new UnprocessableEntityException('Amount exceeds the fine balance');
    }
  }

  async verify(groupId: string, paymentId: string, decision: 'CONFIRM' | 'FAIL', note: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, groupId } });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status !== 'PENDING') throw new UnprocessableEntityException(`This payment is ${p.status.toLowerCase()} and cannot be verified`);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    if (p.recordedById === actor.userId && !readSettings(group.settings).allowSelfVerification) {
      throw new ForbiddenException('Another officer must verify a payment you recorded.');
    }
    if (p.membershipId === actor.id) throw new ForbiddenException('You cannot verify your own payment.');
    await this.prisma.financial(async (tx) => {
      if (decision === 'CONFIRM') {
        await this.posting.confirm(tx, p.id, actor.userId);
      } else {
        const r = await tx.payment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED', verifiedById: actor.userId, verifiedAt: new Date(), failureReason: note ?? 'Not received' } });
        if (r.count !== 1) throw new UnprocessableEntityException('Payment is no longer pending');
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: decision === 'CONFIRM' ? 'payment.confirmed' : 'payment.failed', entityType: 'Payment', entityId: p.id, before: { status: 'PENDING' }, after: { status: decision === 'CONFIRM' ? 'CONFIRMED' : 'FAILED' }, reason: note, reference: p.reference, approvalStatus: decision === 'CONFIRM' ? 'APPROVED' : 'REJECTED', meta }, tx);
    });
    if (decision === 'CONFIRM' && p.membershipId) {
      const m = await this.prisma.membership.findUniqueOrThrow({ where: { id: p.membershipId }, select: { userId: true } });
      await this.notifications.notify([m.userId], { groupId, type: 'PAYMENT_CONFIRMED', title: 'Payment confirmed', body: `${formatKes(n(p.amountCents))} has been confirmed${p.reference ? ` (ref ${p.reference})` : ''}.`, data: { paymentId: p.id } });
    }
    return this.item(p.id);
  }

  async reverse(groupId: string, paymentId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, groupId } });
    if (!p) throw new NotFoundException('Payment not found');
    await this.prisma.financial(async (tx) => {
      await this.posting.reverse(tx, p.id, reason, actor.userId);
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payment.reversed', entityType: 'Payment', entityId: p.id, before: { status: p.status }, after: { status: 'REVERSED' }, reason, reference: p.reference, meta }, tx);
    });
    return this.item(p.id);
  }

  async waive(groupId: string, obligationId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const o = await this.prisma.contributionObligation.findFirst({ where: { id: obligationId, groupId } });
    if (!o) throw new NotFoundException('Contribution not found');
    if (n(o.paidCents) > 0) throw new UnprocessableEntityException('Contributions with payments cannot be waived; reverse the payments first');
    if (o.waivedReason) throw new UnprocessableEntityException('Already waived');
    await this.prisma.$transaction(async (tx) => {
      await tx.contributionObligation.update({ where: { id: o.id }, data: { waivedReason: reason, waivedById: actor.userId, status: 'WAIVED' } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'obligation.waived', entityType: 'ContributionObligation', entityId: o.id, before: { status: o.status }, after: { status: 'WAIVED' }, reason, meta }, tx);
    });
    return { ok: true };
  }

  async item(paymentId: string) {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: paymentInclude });
    return (await toPaymentItems(this.prisma, [p]))[0];
  }

  async list(groupId: string, viewer: MembershipContext, q: z.infer<typeof paymentFilterSchema>) {
    const canSeeAll = viewer.permissions.includes(Permission.CONTRIBUTIONS_VIEW_ALL);
    const where: Prisma.PaymentWhereInput = {
      groupId,
      ...(canSeeAll ? (q.memberId ? { membershipId: q.memberId } : {}) : { membershipId: viewer.id }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.amountCents ? { amountCents: BigInt(q.amountCents) } : {}),
      ...(q.from || q.to ? { paidAt: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ reference: { contains: q.q.toUpperCase() } }, { membership: { user: { fullName: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, include: paymentInclude, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], ...skipTake(q.page, q.pageSize) }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(await toPaymentItems(this.prisma, rows), total, q.page, q.pageSize);
  }

  /** Professional contributions ledger: one row per obligation with its payments. */
  async ledger(groupId: string, q: { page: number; pageSize: number; from?: string; to?: string; memberId?: string; status?: string; scheduleId?: string }) {
    const where: Prisma.ContributionObligationWhereInput = {
      groupId,
      ...(q.memberId ? { membershipId: q.memberId } : {}),
      ...(q.scheduleId ? { scheduleId: q.scheduleId } : {}),
      ...(q.from || q.to ? { dueDate: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) } } : { dueDate: { lte: dbDate(today()) } }),
      ...(q.status === 'OUTSTANDING' ? { status: { notIn: ['PAID', 'WAIVED'] } } : q.status ? { status: q.status as never } : {}),
    };
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const { graceDays } = readSettings(group.settings);
    const [rows, total] = await Promise.all([
      this.prisma.contributionObligation.findMany({
        where,
        orderBy: [{ dueDate: 'desc' }, { membership: { user: { fullName: 'asc' } } }],
        ...skipTake(q.page, q.pageSize),
        include: {
          membership: { select: { user: { select: { fullName: true } } } },
          allocations: { include: { payment: true } },
        },
      }),
      this.prisma.contributionObligation.count({ where }),
    ]);
    const pending = await this.prisma.payment.findMany({ where: { status: 'PENDING', purpose: 'CONTRIBUTION', targetId: { in: rows.map((r) => r.id) } } });
    const userIds = [...new Set([...rows.flatMap((r) => r.allocations.map((a) => a.payment.recordedById)), ...pending.map((p) => p.recordedById)].filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
    const uname = new Map(users.map((u) => [u.id, u.fullName]));
    const t = today();
    const items: ContributionLedgerRow[] = rows.map((o) => {
      const linked = [...o.allocations.map((a) => ({ ...a.payment, allocated: a.amountCents })), ...pending.filter((p) => p.targetId === o.id).map((p) => ({ ...p, allocated: p.amountCents }))];
      const status = obligationStatus(o, t, graceDays);
      return {
        obligationId: o.id,
        dueDate: isoDate(o.dueDate),
        memberName: o.membership.user.fullName,
        membershipId: o.membershipId,
        period: o.periodLabel,
        expectedCents: n(o.amountCents),
        receivedCents: n(o.paidCents),
        pendingCents: pending.filter((p) => p.targetId === o.id).reduce((a, p) => a + n(p.amountCents), 0),
        outstandingCents: status === 'WAIVED' ? 0 : Math.max(n(o.amountCents) - n(o.paidCents), 0),
        status,
        payments: linked.map((p) => ({
          paymentId: p.id,
          amountCents: n(p.allocated),
          method: p.method,
          reference: p.reference,
          status: p.status,
          recordedByName: p.recordedById ? (uname.get(p.recordedById) ?? null) : 'M-Pesa',
          paidAt: isoDate(p.paidAt),
        })),
      };
    });
    return paginate(items, total, q.page, q.pageSize);
  }

  async reconciliation(groupId: string, range: { from?: string; to?: string }): Promise<ReconciliationSummary> {
    const dueRange = { ...(range.from ? { gte: dbDate(range.from) } : {}), lte: dbDate(range.to ?? today()) };
    const [expected, pending, failed, refs, unmatched, confirmed] = await Promise.all([
      this.prisma.contributionObligation.aggregate({ where: { groupId, dueDate: dueRange, status: { not: 'WAIVED' } }, _sum: { amountCents: true, paidCents: true } }),
      this.prisma.payment.aggregate({ where: { groupId, status: 'PENDING' }, _sum: { amountCents: true }, _count: true }),
      this.prisma.payment.count({ where: { groupId, status: 'FAILED', paidAt: dueRange } }),
      this.prisma.payment.groupBy({ by: ['reference'], where: { groupId, reference: { not: null }, status: { not: 'FAILED' } }, _count: { _all: true }, having: { reference: { _count: { gt: 1 } } } }),
      this.prisma.unmatchedPayment.findMany({ where: { groupId, status: 'UNMATCHED' }, orderBy: { receivedAt: 'desc' }, take: 100 }),
      this.prisma.payment.aggregate({ where: { groupId, status: 'CONFIRMED', purpose: 'CONTRIBUTION', paidAt: dueRange }, _sum: { amountCents: true } }),
    ]);
    const dupIds = refs.length
      ? await this.prisma.payment.findMany({ where: { groupId, reference: { in: refs.map((r) => r.reference!) }, status: { not: 'FAILED' } }, select: { id: true, reference: true } })
      : [];
    return {
      expectedCents: n(expected._sum.amountCents),
      confirmedCents: n(confirmed._sum.amountCents),
      pendingCents: n(pending._sum.amountCents),
      outstandingCents: Math.max(n(expected._sum.amountCents) - n(expected._sum.paidCents), 0),
      failedCount: failed,
      pendingCount: pending._count,
      duplicateReferences: refs.map((r) => ({ reference: r.reference!, count: r._count._all, paymentIds: dupIds.filter((d) => d.reference === r.reference).map((d) => d.id) })),
      unmatched: unmatched.map((u) => ({
        id: u.id,
        source: u.source,
        amountCents: n(u.amountCents),
        reference: u.reference,
        payerPhone: u.payerPhone,
        payerName: u.payerName,
        accountReference: u.accountReference,
        receivedAt: u.receivedAt.toISOString(),
        status: u.status,
      })),
    };
  }

  /** Attributes a provider-confirmed (e.g. M-Pesa C2B) payment to a member. */
  async matchUnmatched(groupId: string, unmatchedId: string, input: { memberId: string; purpose: 'CONTRIBUTION' | 'LOAN_REPAYMENT' | 'FINE'; targetId?: string }, actor: MembershipContext, meta: RequestMeta) {
    const u = await this.prisma.unmatchedPayment.findFirst({ where: { id: unmatchedId, groupId } });
    if (!u || u.status !== 'UNMATCHED') throw new NotFoundException('Unmatched payment not found');
    await this.validateTarget(groupId, input.memberId, input.purpose, input.targetId, n(u.amountCents));
    const payment = await this.prisma.financial(async (tx) => {
      const claimed = await tx.unmatchedPayment.updateMany({ where: { id: u.id, status: 'UNMATCHED' }, data: { status: 'MATCHED' } });
      if (claimed.count !== 1) throw new ConflictException('Already matched');
      const p = await tx.payment.create({
        data: {
          groupId,
          membershipId: input.memberId,
          amountCents: u.amountCents,
          method: 'MPESA',
          source: 'MPESA_C2B',
          purpose: input.purpose,
          status: 'PENDING',
          reference: u.reference,
          paidAt: dbDate(isoDate(new Date(u.receivedAt.getTime() + 3 * 3600_000))),
          idempotencyKey: `c2b:${u.reference}`,
          targetId: input.targetId ?? null,
          recordedById: actor.userId,
          notes: `Matched from ${u.source}${u.payerName ? ` (${u.payerName})` : ''}`,
        },
      });
      // The provider callback already validated receipt of the money.
      await this.posting.confirm(tx, p.id, null);
      await tx.unmatchedPayment.update({ where: { id: u.id }, data: { matchedPaymentId: p.id } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'reconciliation.matched', entityType: 'UnmatchedPayment', entityId: u.id, after: { paymentId: p.id, memberId: input.memberId }, reference: u.reference, meta }, tx);
      return p;
    });
    return this.item(payment.id);
  }

  async ignoreUnmatched(groupId: string, unmatchedId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const r = await this.prisma.unmatchedPayment.updateMany({ where: { id: unmatchedId, groupId, status: 'UNMATCHED' }, data: { status: 'IGNORED' } });
    if (r.count !== 1) throw new NotFoundException('Unmatched payment not found');
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'reconciliation.ignored', entityType: 'UnmatchedPayment', entityId: unmatchedId, reason, meta });
    return { ok: true };
  }

  private async notifyVerifiers(groupId: string, exceptUserId: string, body: string) {
    const ids = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'TREASURER'])).filter((id) => id !== exceptUserId);
    if (ids.length) await this.notifications.notify(ids, { groupId, type: 'APPROVAL_REQUIRED', title: 'Payment to verify', body });
  }
}
