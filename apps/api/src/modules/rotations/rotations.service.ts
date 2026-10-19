import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateCycleInput, formatKes, Frequency, PayoutStatus, planRotation, RotationCycle, RotationRoundRow, roundShortfall } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { ApprovalsService } from '../finance/approvals.service';
import { ObligationsService } from '../finance/obligations.service';
import { readSettings } from '../finance/policies';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';

const cycleInclude = {
  group: { select: { name: true } },
  rounds: {
    orderBy: { round: 'asc' },
    include: {
      membership: { select: { user: { select: { fullName: true } } } },
      obligations: { select: { id: true, amountCents: true, paidCents: true, waivedReason: true } },
    },
  },
  changes: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.PayoutCycleInclude;
type CycleRow = Prisma.PayoutCycleGetPayload<{ include: typeof cycleInclude }>;

@Injectable()
export class RotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly obligations: ObligationsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(groupId: string, input: CreateCycleInput, actor: MembershipContext, meta: RequestMeta) {
    const members = await this.prisma.membership.findMany({ where: { groupId, id: { in: input.memberIdsInOrder }, status: 'ACTIVE' }, select: { id: true } });
    if (members.length !== new Set(input.memberIdsInOrder).size || members.length !== input.memberIdsInOrder.length) {
      throw new UnprocessableEntityException('Every member in the payout order must be an active member, listed once');
    }
    const active = await this.prisma.payoutCycle.count({ where: { groupId, status: 'ACTIVE' } });
    if (active > 0) throw new ConflictException('Close the current rotation cycle before starting a new one');
    const plan = planRotation({ startDate: input.startDate, frequency: input.frequency, contributionCents: input.contributionCents, order: input.memberIdsInOrder, recipientContributes: input.recipientContributes });
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const required = readSettings(group.settings).requiredFinancialApprovals;
    const cycle = await this.prisma.$transaction(async (tx) => {
      const c = await tx.payoutCycle.create({
        data: {
          groupId,
          name: input.name,
          contributionCents: big(input.contributionCents),
          frequency: input.frequency,
          startDate: dbDate(input.startDate),
          recipientContributes: input.recipientContributes,
          createdById: actor.userId,
          rounds: { create: plan.map((r) => ({ round: r.round, membershipId: r.recipientMemberId, payoutDate: dbDate(r.payoutDate), expectedCents: big(r.expectedCollectionCents), requiredApprovals: required })) },
        },
      });
      await tx.contributionSchedule.create({
        data: {
          groupId,
          name: input.name,
          amountCents: big(input.contributionCents),
          frequency: input.frequency,
          startDate: dbDate(input.startDate),
          endDate: dbDate(plan[plan.length - 1].payoutDate),
          allMembers: false,
          cycleId: c.id,
          createdById: actor.userId,
          members: { create: input.memberIdsInOrder.map((membershipId) => ({ membershipId })) },
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.created', entityType: 'PayoutCycle', entityId: c.id, after: { ...input, plan }, meta }, tx);
      return c;
    });
    await this.obligations.ensureForGroup(groupId);
    return this.detail(groupId, cycle.id, actor);
  }

  async list(groupId: string, viewer: MembershipContext) {
    const rows = await this.prisma.payoutCycle.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.detail(groupId, r.id, viewer)));
  }

  async detail(groupId: string, cycleId: string, viewer: MembershipContext): Promise<RotationCycle> {
    const c = await this.prisma.payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: cycleInclude });
    if (!c) throw new NotFoundException('Rotation not found');
    return this.toCycle(c, viewer);
  }

  private async toCycle(c: CycleRow, viewer: MembershipContext): Promise<RotationCycle> {
    const approvals = await this.approvals.records('PAYOUT', c.rounds.map((r) => r.id));
    const obligationIds = c.rounds.flatMap((r) => r.obligations.map((o) => o.id));
    const pending = await this.prisma.payment.groupBy({ by: ['targetId'], where: { status: 'PENDING', targetId: { in: obligationIds } }, _sum: { amountCents: true } });
    const pendingBy = new Map(pending.map((p) => [p.targetId, n(p._sum.amountCents)]));
    const t = today();
    const rounds: RotationRoundRow[] = c.rounds.map((r) => {
      const waived = r.obligations.filter((o) => o.waivedReason).reduce((a, o) => a + n(o.amountCents), 0);
      const expected = n(r.expectedCents) - waived;
      const confirmed = r.obligations.reduce((a, o) => a + n(o.paidCents), 0);
      const pendingCents = r.obligations.reduce((a, o) => a + (pendingBy.get(o.id) ?? 0), 0);
      let status: PayoutStatus = r.status;
      if (r.status === 'SCHEDULED') {
        if (confirmed >= expected && expected > 0) status = 'READY';
        else if (confirmed > 0 || pendingCents > 0 || isoDate(r.payoutDate) <= t) status = 'COLLECTING';
      }
      return {
        id: r.id,
        round: r.round,
        recipientMembershipId: r.membershipId,
        recipientName: r.membership.user.fullName,
        payoutDate: isoDate(r.payoutDate),
        expectedCents: expected,
        confirmedCents: confirmed,
        pendingCents,
        shortfallCents: roundShortfall({ expectedCollectionCents: expected, confirmedCollectionCents: confirmed }),
        status,
        approvals: approvals.get(r.id) ?? [],
        approvalsRequired: r.requiredApprovals,
        payoutReference: r.payoutReference,
        completedAt: r.completedAt?.toISOString() ?? null,
        shortfallReason: r.shortfallReason,
      };
    });
    const open = rounds.filter((r) => r.status !== 'COMPLETED');
    const proposerIds = c.changes.map((ch) => ch.proposedByMembershipId);
    const proposers = await this.prisma.membership.findMany({ where: { id: { in: proposerIds } }, select: { id: true, user: { select: { fullName: true } } } });
    const pname = new Map(proposers.map((p) => [p.id, p.user.fullName]));
    return {
      id: c.id,
      groupId: c.groupId,
      groupName: c.group.name,
      name: c.name,
      status: c.status,
      contributionCents: n(c.contributionCents),
      frequency: c.frequency as Frequency,
      startDate: isoDate(c.startDate),
      recipientContributes: c.recipientContributes,
      rounds,
      currentRound: open[0] ?? null,
      nextRound: open[1] ?? null,
      remainingRounds: open.length,
      myRounds: rounds.filter((r) => r.recipientMembershipId === viewer.id),
      changeLog: c.changes.map((ch) => ({ at: ch.createdAt.toISOString(), byName: pname.get(ch.proposedByMembershipId) ?? '', reason: `${ch.reason} (${ch.status.toLowerCase()})` })),
    };
  }

  private async loadRound(groupId: string, cycleId: string, roundId: string) {
    const cycle = await this.prisma.payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: cycleInclude });
    if (!cycle) throw new NotFoundException('Rotation not found');
    const round = cycle.rounds.find((r) => r.id === roundId);
    if (!round) throw new NotFoundException('Round not found');
    return { cycle, round };
  }

  async approvePayout(groupId: string, cycleId: string, roundId: string, input: { comment?: string; shortfallReason?: string }, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (cycle.status !== 'ACTIVE') throw new UnprocessableEntityException('This rotation is not active');
    if (['APPROVED', 'COMPLETED'].includes(round.status)) throw new UnprocessableEntityException('This payout has already been approved');
    const earlierOpen = cycle.rounds.filter((r) => r.round < round.round && r.status !== 'COMPLETED');
    if (earlierOpen.length) throw new UnprocessableEntityException(`Round ${earlierOpen[0].round} must be paid out first. Rounds are never skipped silently; propose an order change instead.`);
    if (round.membershipId === actor.id) throw new ForbiddenException('You cannot approve your own payout.');
    const view = (await this.toCycle(cycle, actor)).rounds.find((r) => r.id === round.id)!;
    if (view.confirmedCents <= 0) throw new UnprocessableEntityException('No confirmed collection for this round yet');
    if (view.shortfallCents > 0 && !input.shortfallReason?.trim()) {
      throw new UnprocessableEntityException(`Collection is short by ${formatKes(view.shortfallCents)}. Record a reason to approve a reduced payout.`);
    }
    await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'PAYOUT', entityId: round.id, approverMembershipId: actor.id, decision: 'APPROVE', comment: input.comment, excludedMembershipIds: [round.membershipId], required: round.requiredApprovals });
      if (r.reached) {
        await tx.payoutRound.update({ where: { id: round.id }, data: { status: 'APPROVED', shortfallReason: view.shortfallCents > 0 ? input.shortfallReason : null } });
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.approval', entityType: 'PayoutRound', entityId: round.id, reason: input.shortfallReason ?? input.comment, approvalStatus: r.reached ? 'APPROVED' : 'PENDING', after: { confirmedCents: view.confirmedCents, expectedCents: view.expectedCents }, meta }, tx);
    });
    return this.detail(groupId, cycleId, actor);
  }

  async completePayout(groupId: string, cycleId: string, roundId: string, input: { method: string; reference?: string; paidAt: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    const replay = await this.prisma.payoutRound.findUnique({ where: { payoutKey: input.idempotencyKey } });
    if (replay) {
      if (replay.id !== roundId) throw new UnprocessableEntityException('This idempotency key was used for another payout');
      return this.detail(groupId, cycleId, actor);
    }
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (round.status !== 'APPROVED') throw new UnprocessableEntityException('The payout must be approved before it is recorded as paid');
    if (round.membershipId === actor.id) throw new ForbiddenException('Another officer must record your payout.');
    if (input.paidAt > today()) throw new UnprocessableEntityException('Payout date cannot be in the future');
    const view = (await this.toCycle(cycle, actor)).rounds.find((r) => r.id === round.id)!;
    const amount = view.confirmedCents;
    await this.prisma.financial(async (tx) => {
      const cash = await this.ledger.cashBalance(groupId, {}, tx);
      if (cash < amount) throw new UnprocessableEntityException(`Insufficient group funds for this payout: available ${formatKes(cash)}`);
      const claimed = await tx.payoutRound.updateMany({ where: { id: round.id, status: 'APPROVED' }, data: { status: 'COMPLETED', payoutMethod: input.method as never, payoutReference: input.reference?.toUpperCase() ?? null, payoutKey: input.idempotencyKey, payoutAmountCents: big(amount), completedAt: new Date() } });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Payout already recorded');
      await this.ledger.post(tx, {
        groupId,
        entryDate: input.paidAt,
        type: 'PAYOUT',
        description: `${cycle.name} round ${round.round} payout to ${round.membership.user.fullName}`,
        reference: input.reference ?? null,
        membershipId: round.membershipId,
        roundId: round.id,
        createdById: actor.userId,
        lines: [
          { account: 'PAYOUTS', amountCents: amount },
          { account: 'CASH', amountCents: -amount },
        ],
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.completed', entityType: 'PayoutRound', entityId: round.id, after: { ...input, amountCents: amount }, reference: input.reference, meta }, tx);
    });
    const recipient = await this.prisma.membership.findUniqueOrThrow({ where: { id: round.membershipId }, select: { userId: true } });
    await this.notifications.notify([recipient.userId], { groupId, type: 'PAYOUT_COMPLETED', title: 'Payout sent', body: `${formatKes(amount)} from ${cycle.name} (round ${round.round}) has been paid to you${input.reference ? `, ref ${input.reference}` : ''}.` });
    return this.detail(groupId, cycleId, actor);
  }

  async proposeReorder(groupId: string, cycleId: string, input: { memberIdsInOrder: string[]; reason: string }, actor: MembershipContext, meta: RequestMeta) {
    const cycle = await this.prisma.payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: { rounds: { orderBy: { round: 'asc' } }, changes: true } });
    if (!cycle || cycle.status !== 'ACTIVE') throw new NotFoundException('Active rotation not found');
    if (cycle.changes.some((c) => c.status === 'PENDING')) throw new ConflictException('Another order change is awaiting approval');
    const movable = cycle.rounds.filter((r) => r.status === 'SCHEDULED');
    const current = movable.map((r) => r.membershipId);
    const proposed = input.memberIdsInOrder;
    if (proposed.length !== current.length || [...proposed].sort().join() !== [...current].sort().join()) {
      throw new UnprocessableEntityException('The new order must contain exactly the recipients of rounds not yet approved or paid');
    }
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const change = await this.prisma.cycleChange.create({ data: { cycleId, beforeOrder: current, afterOrder: proposed, reason: input.reason, proposedByMembershipId: actor.id } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.reorder_proposed', entityType: 'CycleChange', entityId: change.id, before: current, after: proposed, reason: input.reason, approvalStatus: 'PENDING', meta });
    const required = readSettings(group.settings).requiredFinancialApprovals;
    return { changeId: change.id, approvalsRequired: required };
  }

  async decideReorder(groupId: string, cycleId: string, changeId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const change = await this.prisma.cycleChange.findFirst({ where: { id: changeId, cycleId, cycle: { groupId } } });
    if (!change || change.status !== 'PENDING') throw new NotFoundException('Pending change not found');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const required = readSettings(group.settings).requiredFinancialApprovals;
    await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'CYCLE_CHANGE', entityId: change.id, approverMembershipId: actor.id, decision, comment, excludedMembershipIds: [change.proposedByMembershipId], excludedMessage: 'Another officer must approve your proposed change.', required });
      if (r.rejected) await tx.cycleChange.update({ where: { id: change.id }, data: { status: 'REJECTED' } });
      else if (r.reached) await this.applyReorder(tx, cycleId, change.id, change.afterOrder as string[], change.reason);
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `rotation.reorder_${decision.toLowerCase()}`, entityType: 'CycleChange', entityId: change.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
    });
    return this.detail(groupId, cycleId, actor);
  }

  private async applyReorder(tx: Tx, cycleId: string, changeId: string, order: string[], reason: string) {
    const cycle = await tx.payoutCycle.findUniqueOrThrow({ where: { id: cycleId }, include: { rounds: { orderBy: { round: 'asc' } }, schedule: true } });
    const movable = cycle.rounds.filter((r) => r.status === 'SCHEDULED');
    if (movable.map((r) => r.membershipId).sort().join() !== [...order].sort().join()) {
      throw new UnprocessableEntityException('The rotation changed since this proposal; propose again');
    }
    for (let i = 0; i < movable.length; i++) {
      const round = movable[i];
      const next = order[i];
      if (round.membershipId === next) continue;
      await tx.payoutRound.update({ where: { id: round.id }, data: { membershipId: next } });
      if (!cycle.recipientContributes && cycle.schedule) {
        // New recipient no longer owes this round; previous recipient now does.
        const owed = await tx.contributionObligation.findFirst({ where: { roundId: round.id, membershipId: next } });
        if (owed) {
          if (n(owed.paidCents) > 0) throw new UnprocessableEntityException('A new recipient has already contributed to their round; reverse that payment first');
          await tx.contributionObligation.update({ where: { id: owed.id }, data: { waivedReason: `Rotation order changed: ${reason}`, status: 'WAIVED' } });
        }
        const prev = await tx.contributionObligation.findFirst({ where: { roundId: round.id, membershipId: round.membershipId } });
        if (prev) await tx.contributionObligation.update({ where: { id: prev.id }, data: { waivedReason: null, status: 'UPCOMING' } });
        else {
          await tx.contributionObligation.create({
            data: { groupId: cycle.groupId, scheduleId: cycle.schedule.id, membershipId: round.membershipId, dueDate: round.payoutDate, periodLabel: `Round ${round.round}`, amountCents: cycle.contributionCents, roundId: round.id },
          });
        }
      }
    }
    await tx.cycleChange.update({ where: { id: changeId }, data: { status: 'APPROVED', appliedAt: new Date() } });
  }

  async close(groupId: string, cycleId: string, actor: MembershipContext, meta: RequestMeta) {
    const cycle = await this.prisma.payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: { rounds: true } });
    if (!cycle) throw new NotFoundException('Rotation not found');
    if (cycle.status !== 'ACTIVE') throw new UnprocessableEntityException('Rotation is not active');
    const open = cycle.rounds.filter((r) => r.status !== 'COMPLETED').map((r) => r.round);
    if (open.length) throw new UnprocessableEntityException(`Rounds ${open.join(', ')} are not complete. A cycle is never closed with unpaid rounds.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutCycle.update({ where: { id: cycle.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.contributionSchedule.updateMany({ where: { cycleId: cycle.id }, data: { active: false } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.closed', entityType: 'PayoutCycle', entityId: cycle.id, meta }, tx);
    });
    return this.detail(groupId, cycleId, actor);
  }
}
