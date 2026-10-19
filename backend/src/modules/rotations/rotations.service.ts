import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  addDays,
  amendRotationOrder,
  ApprovalRecord,
  assessPayoutReadiness,
  carryOverOrder,
  CreateCycleInput,
  drawOrder,
  formatDate,
  formatKes,
  Frequency,
  GroupRole,
  LABELS,
  PayoutReadiness,
  PayoutStatus,
  Permission,
  planRotation,
  recipientShare,
  resolvePermissions,
  RolePolicy,
  RotationAmendment,
  RotationAmendmentInput,
  RotationCycle,
  RotationError,
  RotationRoundRow,
  RotationSlotPlan,
  roundShortfall,
  SpecialRole,
} from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { DecisionsService } from '../decisions/decisions.service';
import { ApprovalsService } from '../finance/approvals.service';
import { ObligationsService } from '../finance/obligations.service';
import { readSettings } from '../finance/policies';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';

const cycleInclude = {
  group: { select: { name: true, settings: true, rolePolicy: true } },
  rounds: {
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    include: {
      membership: { select: { userId: true, user: { select: { fullName: true } } } },
      obligations: { select: { id: true, membershipId: true, amountCents: true, paidCents: true, waivedReason: true } },
      disbursements: { orderBy: { attempt: 'asc' } },
    },
  },
  changes: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.PayoutCycleInclude;
type CycleRow = Prisma.PayoutCycleGetPayload<{ include: typeof cycleInclude }>;
type RoundRow = CycleRow['rounds'][number];

/** Stored payout statuses that mean the round's recipient is locked in place. */
const LOCKED: PayoutStatus[] = ['AWAITING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED'];
const DONE: PayoutStatus[] = ['COMPLETED', 'CANCELLED'];
const SUBJECT = 'PayoutCycle';

function rotationError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RotationError) throw new UnprocessableEntityException(err.message);
    throw err;
  }
}

/**
 * Merry-go-round engine: schedules are drafted, approved by officers or a
 * members' vote, and only then generate contributions. Payouts move through
 * readiness → preparation → independent approval → disbursement → confirmed
 * completion. Nothing advances automatically, and the approved schedule is
 * kept; every later change is an approved amendment.
 */
@Injectable()
export class RotationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly obligations: ObligationsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly decisions: DecisionsService,
  ) {}

  onModuleInit() {
    this.decisions.onOutcome(SUBJECT, async ({ subjectId, groupId, status, id }) => {
      const cycle = await this.prisma.payoutCycle.findFirst({ where: { id: subjectId, groupId, proposalId: id } });
      if (!cycle || cycle.status !== 'DRAFT') return;
      if (status === 'PASSED') await this.activate(groupId, cycle.id, null, 'Approved by members’ vote');
      else await this.cancelInternal(groupId, cycle.id, null, status === 'CANCELLED' ? 'Members’ vote was cancelled' : 'Members’ vote did not pass');
    });
  }

  /* ---------- helpers ---------- */

  private async members(groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { rolePolicy: true } });
    const rows = await this.prisma.membership.findMany({ where: { groupId }, select: { id: true, userId: true, role: true, specialRoles: true, status: true, joinedAt: true, user: { select: { fullName: true } } } });
    return rows.map((m) => ({ ...m, name: m.user.fullName, permissions: resolvePermissions(m.role as GroupRole, group.rolePolicy as RolePolicy | null, m.specialRoles as SpecialRole[]) }));
  }

  private async load(groupId: string, cycleId: string, tx?: Tx): Promise<CycleRow> {
    const c = await (tx ?? this.prisma).payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: cycleInclude });
    if (!c) throw new NotFoundException('Rotation not found');
    return c;
  }

  private payoutKey(r: { id: string; preparationNo: number }) {
    return `${r.id}:${r.preparationNo}`;
  }

  private creatorMembershipId(c: { createdById: string }, members: { id: string; userId: string }[]) {
    return members.find((m) => m.userId === c.createdById)?.id ?? null;
  }

  /* ---------- create, approve, activate ---------- */

  async create(groupId: string, input: CreateCycleInput, actor: MembershipContext, meta: RequestMeta) {
    const all = await this.members(groupId);
    const active = new Map(all.filter((m) => m.status === 'ACTIVE').map((m) => [m.id, m]));
    if (input.memberIds.some((id) => !active.has(id))) throw new UnprocessableEntityException('Every member in the rotation must be an active member of this group');
    const open = await this.prisma.payoutCycle.count({ where: { groupId, status: { in: ['DRAFT', 'ACTIVE'] } } });
    if (open > 0) throw new ConflictException('Finish or cancel the current rotation before drafting a new one');

    let order = input.memberIds;
    let seed: string | null = null;
    let participants: string[] | null = null;
    let previousCycleId: string | null = null;
    if (input.orderMethod === 'RANDOM_DRAW') {
      seed = randomBytes(16).toString('hex');
      participants = [...input.memberIds].sort();
      order = rotationError(() => drawOrder(participants!, seed!));
    } else if (input.orderMethod === 'CARRY_OVER') {
      const prev = await this.prisma.payoutCycle.findFirst({ where: { groupId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, include: { rounds: { where: { status: { not: 'CANCELLED' } }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] } } });
      if (!prev) throw new UnprocessableEntityException('There is no completed rotation to carry the order over from');
      previousCycleId = prev.id;
      participants = [...input.memberIds].sort((a, b) => active.get(a)!.joinedAt.getTime() - active.get(b)!.joinedAt.getTime() || a.localeCompare(b));
      order = carryOverOrder(prev.rounds.map((r) => r.membershipId), participants);
    }
    const plan = rotationError(() => planRotation({ startDate: input.startDate, frequency: input.frequency, contributionCents: input.contributionCents, order, recipientsPerRound: input.recipientsPerRound, recipientContributes: input.recipientContributes }));
    const required = readSettings((await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } })).settings).requiredFinancialApprovals;

    const cycle = await this.prisma.$transaction(async (tx) => {
      const c = await tx.payoutCycle.create({
        data: {
          groupId,
          name: input.name,
          status: 'DRAFT',
          contributionCents: big(input.contributionCents),
          frequency: input.frequency,
          startDate: dbDate(input.startDate),
          recipientContributes: input.recipientContributes,
          recipientsPerRound: input.recipientsPerRound,
          orderMethod: input.orderMethod,
          drawSeed: seed,
          drawParticipants: participants ?? undefined,
          previousCycleId,
          approvalMode: input.approvalMode,
          createdById: actor.userId,
          rounds: {
            create: plan.flatMap((r) => r.recipients.map((m, i) => ({ round: r.round, slot: i + 1, membershipId: m, payoutDate: dbDate(r.payoutDate), expectedCents: big(r.expectedCollectionCents), requiredApprovals: required }))),
          },
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.drafted', entityType: 'PayoutCycle', entityId: c.id, after: { ...input, order, drawSeed: seed, plan }, approvalStatus: 'PENDING', meta }, tx);
      return c;
    });

    const name = (id: string) => active.get(id)!.name;
    if (input.approvalMode === 'MEMBER_VOTE') {
      const lines = plan.map((r) => `Round ${r.round} (${formatDate(r.payoutDate)}): ${r.recipients.map(name).join(', ')}`);
      const p = await this.decisions.createProposal(
        groupId,
        {
          title: `Approve rotation: ${input.name}`,
          description: `${LABELS.rotationOrderMethod[input.orderMethod]}. ${formatKes(input.contributionCents)} ${LABELS.frequency[input.frequency].toLowerCase()} from ${formatDate(input.startDate)}.${seed ? ` Draw seed ${seed}.` : ''}\n${lines.join('\n')}`,
          closesAt: input.vote!.closesAt,
          quorumPercent: input.vote!.quorumPercent,
          passPercent: input.vote!.passPercent,
          subjectType: SUBJECT,
          subjectId: cycle.id,
        },
        actor,
        meta,
      );
      await this.prisma.payoutCycle.update({ where: { id: cycle.id }, data: { proposalId: p.id } });
    } else {
      const approvers = all.filter((m) => m.status === 'ACTIVE' && m.id !== actor.id && m.permissions.includes(Permission.PAYOUTS_APPROVE));
      await this.notifications.notify(approvers.map((m) => m.userId), { groupId, type: 'APPROVAL_REQUIRED', title: 'Rotation schedule to approve', body: `${input.name}: ${plan.length} rounds from ${formatDate(input.startDate)}. Review the order before it becomes binding.`, data: { cycleId: cycle.id } });
    }
    return this.detail(groupId, cycle.id, actor);
  }

  async decideActivation(groupId: string, cycleId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const c = await this.load(groupId, cycleId);
    if (c.status !== 'DRAFT') throw new UnprocessableEntityException('This rotation is not awaiting approval');
    if (c.approvalMode !== 'OFFICERS') throw new UnprocessableEntityException('Members approve this rotation by vote');
    const all = await this.members(groupId);
    const creator = this.creatorMembershipId(c, all);
    const required = readSettings(c.group.settings).requiredFinancialApprovals;
    const r = await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'CYCLE_ACTIVATION', entityId: c.id, approverMembershipId: actor.id, decision, comment, excludedMembershipIds: creator ? [creator] : [], excludedMessage: 'Another officer must approve the schedule you drafted.', required });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `rotation.activation_${decision.toLowerCase()}`, entityType: 'PayoutCycle', entityId: c.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
      return r;
    });
    if (r.rejected) await this.cancelInternal(groupId, c.id, actor, comment ? `Rejected: ${comment}` : 'Schedule rejected by an officer', meta);
    else if (r.reached) await this.activate(groupId, c.id, actor, 'Approved by officers', meta);
    return this.detail(groupId, cycleId, actor);
  }

  /** Makes an approved draft binding: snapshots the plan, creates the contribution schedule and notifies members. */
  private async activate(groupId: string, cycleId: string, actor: MembershipContext | null, how: string, meta?: RequestMeta) {
    const all = await this.members(groupId);
    const byId = new Map(all.map((m) => [m.id, m]));
    await this.prisma.financial(async (tx) => {
      const c = await this.load(groupId, cycleId, tx);
      if (c.status !== 'DRAFT') return;
      const inactive = c.rounds.filter((r) => byId.get(r.membershipId)?.status !== 'ACTIVE');
      if (inactive.length) throw new UnprocessableEntityException(`${byId.get(inactive[0].membershipId)?.name ?? 'A member'} is no longer an active member; draft the rotation again`);
      const running = await tx.payoutCycle.count({ where: { groupId, status: 'ACTIVE' } });
      if (running) throw new ConflictException('Another rotation is already active');
      const plan: Omit<RotationSlotPlan, 'memberName'>[] = c.rounds.map((r) => ({ round: r.round, slot: r.slot, membershipId: r.membershipId, payoutDate: isoDate(r.payoutDate) }));
      const claimed = await tx.payoutCycle.updateMany({ where: { id: c.id, status: 'DRAFT' }, data: { status: 'ACTIVE', activatedAt: new Date(), approvedPlan: plan } });
      if (claimed.count !== 1) return;
      const memberIds = [...new Set(c.rounds.map((r) => r.membershipId))];
      await tx.contributionSchedule.create({
        data: {
          groupId,
          name: c.name,
          amountCents: c.contributionCents,
          frequency: c.frequency,
          startDate: c.startDate,
          endDate: c.rounds[c.rounds.length - 1].payoutDate,
          allMembers: false,
          cycleId: c.id,
          createdById: c.createdById,
          members: { create: memberIds.map((membershipId) => ({ membershipId })) },
        },
      });
      await this.audit.log({ groupId, actorUserId: actor?.userId ?? null, action: 'rotation.activated', entityType: 'PayoutCycle', entityId: c.id, reason: how, after: { plan }, approvalStatus: 'APPROVED', meta }, tx);
    });
    await this.obligations.ensureForGroup(groupId);
    const c = await this.load(groupId, cycleId);
    const g = c.group.name.toUpperCase();
    for (const m of new Set(c.rounds.map((r) => r.membershipId))) {
      const mine = c.rounds.filter((r) => r.membershipId === m);
      const member = byId.get(m);
      if (!member) continue;
      await this.notifications.notify([member.userId], {
        groupId,
        type: 'ROTATION_UPDATED',
        title: 'Rotation schedule approved',
        body: `${g}: "${c.name}" is approved (${how.toLowerCase()}). Your payout: ${mine.map((r) => `round ${r.round} on ${formatDate(isoDate(r.payoutDate))}`).join(', ')}. You contribute ${formatKes(n(c.contributionCents))} ${LABELS.frequency[c.frequency as Frequency].toLowerCase()} from ${formatDate(isoDate(c.startDate))}.`,
        data: { cycleId: c.id },
      });
    }
  }

  async cancelDraft(groupId: string, cycleId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const c = await this.load(groupId, cycleId);
    if (c.status !== 'DRAFT') throw new UnprocessableEntityException('Only a rotation awaiting approval can be cancelled. An active rotation is closed once every round is paid.');
    if (c.proposalId) {
      const p = await this.prisma.proposal.findUnique({ where: { id: c.proposalId }, select: { status: true } });
      if (p?.status === 'OPEN') await this.decisions.close(groupId, c.proposalId, true, actor, meta); // the outcome handler cancels the draft
    }
    await this.cancelInternal(groupId, c.id, actor, reason, meta);
    return this.detail(groupId, cycleId, actor);
  }

  private async cancelInternal(groupId: string, cycleId: string, actor: MembershipContext | null, reason: string, meta?: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payoutCycle.updateMany({ where: { id: cycleId, groupId, status: 'DRAFT' }, data: { status: 'CANCELLED' } });
      if (claimed.count !== 1) return;
      await tx.payoutRound.updateMany({ where: { cycleId }, data: { status: 'CANCELLED', cancelledReason: reason } });
      await this.audit.log({ groupId, actorUserId: actor?.userId ?? null, action: 'rotation.cancelled', entityType: 'PayoutCycle', entityId: cycleId, reason, meta }, tx);
    });
  }

  /* ---------- read model ---------- */

  async list(groupId: string, viewer: MembershipContext) {
    const rows = await this.prisma.payoutCycle.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.detail(groupId, r.id, viewer)));
  }

  async detail(groupId: string, cycleId: string, viewer: MembershipContext): Promise<RotationCycle> {
    return this.toCycle(await this.load(groupId, cycleId), viewer);
  }

  /** Per-round collection figures. Obligations hang off each round's first slot. */
  private async collections(c: CycleRow) {
    const byRound = new Map<number, RoundRow[]>();
    for (const r of c.rounds) byRound.set(r.round, [...(byRound.get(r.round) ?? []), r]);
    const obligationIds = c.rounds.flatMap((r) => r.obligations.map((o) => o.id));
    const pending = obligationIds.length
      ? await this.prisma.payment.groupBy({ by: ['targetId'], where: { groupId: c.groupId, status: 'PENDING', targetId: { in: obligationIds } }, _sum: { amountCents: true }, _count: true })
      : [];
    const pendingBy = new Map(pending.map((p) => [p.targetId, { cents: n(p._sum.amountCents), count: p._count }]));
    const out = new Map<number, { expected: number; confirmed: number; pendingCents: number; pendingCount: number; obligationIds: string[]; rows: RoundRow[] }>();
    for (const [round, rows] of byRound) {
      const obls = rows.flatMap((r) => r.obligations);
      const live = obls.filter((o) => !o.waivedReason);
      const expected = obls.length ? live.reduce((a, o) => a + n(o.amountCents), 0) : n(rows[0].expectedCents);
      const confirmed = obls.reduce((a, o) => a + n(o.paidCents), 0);
      const pend = obls.reduce((a, o) => ({ cents: a.cents + (pendingBy.get(o.id)?.cents ?? 0), count: a.count + (pendingBy.get(o.id)?.count ?? 0) }), { cents: 0, count: 0 });
      out.set(round, { expected, confirmed, pendingCents: pend.cents, pendingCount: pend.count, obligationIds: obls.map((o) => o.id), rows });
    }
    return out;
  }

  private earliestOpenRound(c: CycleRow): number | null {
    const open = c.rounds.filter((r) => !DONE.includes(r.status as PayoutStatus)).map((r) => r.round);
    return open.length ? Math.min(...open) : null;
  }

  /** Money owed by the recipient in this group right now (overdue contributions, unpaid fines, overdue loan installments). */
  private async recipientLiabilities(groupId: string, membershipId: string, graceDays: number) {
    const cutoff = dbDate(addDays(today(), -graceDays));
    const [obls, fines, inst] = await Promise.all([
      this.prisma.contributionObligation.findMany({ where: { groupId, membershipId, waivedReason: null, dueDate: { lt: cutoff }, status: { notIn: ['PAID', 'WAIVED'] } }, select: { amountCents: true, paidCents: true } }),
      this.prisma.fine.findMany({ where: { groupId, membershipId, status: { in: ['OUTSTANDING', 'PARTIAL'] } }, select: { amountCents: true, paidCents: true } }),
      this.prisma.loanInstallment.findMany({ where: { loan: { groupId, membershipId, status: 'DISBURSED' }, dueDate: { lt: dbDate(today()) }, status: { not: 'PAID' } }, select: { principalCents: true, interestCents: true, principalPaidCents: true, interestPaidCents: true } }),
    ]);
    return (
      obls.reduce((a, o) => a + Math.max(n(o.amountCents) - n(o.paidCents), 0), 0) +
      fines.reduce((a, f) => a + Math.max(n(f.amountCents) - n(f.paidCents), 0), 0) +
      inst.reduce((a, i) => a + Math.max(n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0), 0)
    );
  }

  /** Ledger cash less payouts already sent but not yet confirmed (not yet posted). */
  private async availableCash(groupId: string, tx?: Tx) {
    const cash = await this.ledger.cashBalance(groupId, {}, tx);
    const sent = await (tx ?? this.prisma).payoutDisbursement.aggregate({ where: { groupId, status: 'PROCESSING' }, _sum: { amountCents: true } });
    return Number(cash) - n(sent._sum.amountCents);
  }

  private async readinessFor(c: CycleRow, r: RoundRow, coll: Awaited<ReturnType<RotationsService['collections']>>): Promise<PayoutReadiness> {
    const settings = readSettings(c.group.settings);
    const round = coll.get(r.round)!;
    const disputes = await this.prisma.dispute.count({
      where: {
        groupId: c.groupId,
        status: 'OPEN',
        OR: [{ roundId: { in: round.rows.map((x) => x.id) } }, ...(round.obligationIds.length ? [{ payment: { targetId: { in: round.obligationIds } } }, { payment: { allocations: { some: { obligationId: { in: round.obligationIds } } } } }] : [])],
      },
    });
    const pendingAmendment = c.changes.some((ch) => ch.status === 'PENDING');
    const alreadyPaid = round.rows.filter((x) => x.id !== r.id).reduce((a, x) => a + x.disbursements.filter((d) => d.status !== 'FAILED').reduce((s, d) => s + n(d.amountCents), 0), 0);
    return assessPayoutReadiness({
      cycleActive: c.status === 'ACTIVE',
      earliestOpenRound: this.earliestOpenRound(c),
      round: r.round,
      payoutDate: isoDate(r.payoutDate),
      today: today(),
      allowEarlyPayout: settings.allowEarlyPayout,
      expectedCents: round.expected,
      confirmedCents: round.confirmed,
      alreadyPaidOutCents: alreadyPaid,
      recipientsInRound: round.rows.length,
      slotIndex: round.rows.findIndex((x) => x.id === r.id),
      missedContributionPolicy: settings.missedContributionPolicy,
      pendingPaymentCount: round.pendingCount,
      pendingPaymentCents: round.pendingCents,
      openDisputes: disputes,
      recipientLiabilitiesCents: await this.recipientLiabilities(c.groupId, r.membershipId, settings.graceDays),
      holdWhenRecipientInArrears: settings.holdPayoutWhenRecipientInArrears,
      availableCashCents: await this.availableCash(c.groupId),
      pendingAmendment,
    });
  }

  private displayStatus(c: CycleRow, r: RoundRow, earliest: number | null): PayoutStatus {
    if (r.status === 'SCHEDULED' && c.status === 'ACTIVE' && earliest === r.round) return 'READINESS_CHECK';
    return r.status as PayoutStatus;
  }

  private async toCycle(c: CycleRow, viewer: MembershipContext): Promise<RotationCycle> {
    const all = await this.members(c.groupId);
    const byId = new Map(all.map((m) => [m.id, m]));
    const byUser = new Map(all.map((m) => [m.userId, m]));
    const nameOf = (id: string | null | undefined) => (id ? byId.get(id)?.name ?? 'Former member' : '');
    const userName = (id: string | null | undefined) => (id ? byUser.get(id)?.name ?? 'Former member' : '');
    const coll = await this.collections(c);
    const earliest = this.earliestOpenRound(c);
    const payoutApprovals = await this.approvals.records('PAYOUT', c.rounds.map((r) => this.payoutKey(r)));
    const activationApprovals = (await this.approvals.records('CYCLE_ACTIVATION', [c.id])).get(c.id) ?? [];
    const changeApprovals = await this.approvals.records('CYCLE_CHANGE', c.changes.map((ch) => ch.id));
    const mine = await this.prisma.approval.findMany({ where: { groupId: c.groupId, approverMembershipId: viewer.id, entityId: { in: [c.id, ...c.rounds.map((r) => this.payoutKey(r))] } }, select: { entityId: true } });
    const decidedKeys = new Set(mine.map((a) => a.entityId));
    const can = (p: Permission) => viewer.permissions.includes(p);
    const manage = can(Permission.ROTATIONS_MANAGE);
    const approve = can(Permission.PAYOUTS_APPROVE);
    const readOnly = !!viewer.supportGrantId;

    const rounds: RotationRoundRow[] = [];
    for (const r of c.rounds) {
      const round = coll.get(r.round)!;
      const status = this.displayStatus(c, r, earliest);
      const isRecipient = r.membershipId === viewer.id;
      const inTurn = c.status === 'ACTIVE' && earliest === r.round && ['READINESS_CHECK', 'AWAITING_APPROVAL', 'APPROVED', 'FAILED'].includes(status);
      const mayInspect = manage || approve || isRecipient;
      const readiness = inTurn && mayInspect ? await this.readinessFor(c, r, coll) : null;
      const approvals: ApprovalRecord[] = payoutApprovals.get(this.payoutKey(r)) ?? [];
      const live = [...r.disbursements].reverse().find((d) => d.status !== 'FAILED') ?? null;
      const last = r.disbursements[r.disbursements.length - 1] ?? null;
      const shown = live ?? last;
      const decided = decidedKeys.has(this.payoutKey(r));
      const slotIndex = round.rows.findIndex((x) => x.id === r.id);
      rounds.push({
        id: r.id,
        round: r.round,
        slot: r.slot,
        recipientsInRound: round.rows.length,
        recipientMembershipId: r.membershipId,
        recipientName: nameOf(r.membershipId),
        payoutDate: isoDate(r.payoutDate),
        expectedCents: round.expected,
        confirmedCents: round.confirmed,
        pendingCents: round.pendingCents,
        shortfallCents: roundShortfall({ expectedCollectionCents: round.expected, confirmedCollectionCents: round.confirmed }),
        expectedShareCents: recipientShare(round.expected, round.rows.length, slotIndex),
        status,
        approvals,
        approvalsRequired: r.requiredApprovals,
        readiness,
        preparedByName: r.preparedByMembershipId ? nameOf(r.preparedByMembershipId) : null,
        preparedAt: r.preparedAt?.toISOString() ?? null,
        preparedAmountCents: r.preparedAmountCents === null ? null : n(r.preparedAmountCents),
        shortfallReason: r.shortfallReason,
        disbursement:
          shown && mayInspect
            ? { method: shown.method, reference: shown.reference, destination: shown.destination, sentAt: isoDate(shown.sentOn), byName: nameOf(shown.recordedByMembershipId), evidenceNote: shown.evidenceNote }
            : shown
              ? { method: shown.method, reference: shown.reference, destination: null, sentAt: isoDate(shown.sentOn), byName: nameOf(shown.recordedByMembershipId), evidenceNote: null }
              : null,
        confirmation: live?.status === 'CONFIRMED' ? { kind: live.confirmationKind!, byName: userName(live.confirmedByUserId), at: live.confirmedAt!.toISOString(), note: live.confirmationNote } : null,
        failureReason: last?.status === 'FAILED' ? last.failureReason : null,
        attempts: r.disbursements.length,
        payoutAmountCents: r.payoutAmountCents === null ? null : n(r.payoutAmountCents),
        payoutReference: r.payoutReference,
        completedAt: r.completedAt?.toISOString() ?? null,
        can: {
          prepare: !readOnly && manage && !isRecipient && ['READINESS_CHECK', 'AWAITING_APPROVAL', 'APPROVED'].includes(status) && !!readiness?.ready,
          approve: !readOnly && approve && !isRecipient && status === 'AWAITING_APPROVAL' && r.preparedByMembershipId !== viewer.id && !decided,
          disburse: !readOnly && manage && !isRecipient && (status === 'APPROVED' || status === 'FAILED'),
          confirm: !readOnly && status === 'PROCESSING' && (isRecipient || ((manage || approve) && live?.recordedByMembershipId !== viewer.id)),
          fail: !readOnly && status === 'PROCESSING' && (manage || approve) && !isRecipient,
          reportProblem: !readOnly && isRecipient && (status === 'PROCESSING' || status === 'COMPLETED'),
        },
      });
    }
    const open = rounds.filter((r) => !DONE.includes(r.status));
    const creator = this.creatorMembershipId(c, all);
    const plan = (c.approvedPlan as Omit<RotationSlotPlan, 'memberName'>[] | null)?.map((p) => ({ ...p, memberName: nameOf(p.membershipId) })) ?? null;
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
      recipientsPerRound: c.recipientsPerRound,
      orderMethod: c.orderMethod,
      drawSeed: c.drawSeed,
      drawParticipants: (c.drawParticipants as string[] | null) ?? null,
      approvalMode: c.approvalMode,
      activationApprovals,
      activationApprovalsRequired: readSettings(c.group.settings).requiredFinancialApprovals,
      proposalId: c.proposalId,
      createdByName: userName(c.createdById),
      activatedAt: c.activatedAt?.toISOString() ?? null,
      approvedPlan: plan,
      rounds,
      currentRound: open[0] ?? null,
      nextRound: open.find((r) => r.round > (open[0]?.round ?? 0)) ?? null,
      remainingRounds: new Set(open.map((r) => r.round)).size,
      myRounds: rounds.filter((r) => r.recipientMembershipId === viewer.id),
      changeLog: c.changes.map((ch) => ({
        id: ch.id,
        kind: ch.kind,
        at: ch.createdAt.toISOString(),
        byName: nameOf(ch.proposedByMembershipId),
        reason: ch.reason,
        status: ch.status,
        before: ch.beforeOrder as string[],
        after: ch.afterOrder as string[],
        beforeNames: (ch.beforeOrder as string[]).map(nameOf),
        afterNames: (ch.afterOrder as string[]).map(nameOf),
        joinedNames: ((ch.joined as string[] | null) ?? []).map(nameOf),
        leftNames: ((ch.left as string[] | null) ?? []).map(nameOf),
        approvals: changeApprovals.get(ch.id) ?? [],
        appliedAt: ch.appliedAt?.toISOString() ?? null,
      })),
      can: {
        approveActivation: !readOnly && approve && c.status === 'DRAFT' && c.approvalMode === 'OFFICERS' && creator !== viewer.id && !decidedKeys.has(c.id),
        cancel: !readOnly && manage && c.status === 'DRAFT',
        amend: !readOnly && manage && c.status === 'ACTIVE' && !c.changes.some((ch) => ch.status === 'PENDING'),
        close: !readOnly && manage && c.status === 'ACTIVE' && open.length === 0,
      },
    };
  }

  /* ---------- payout lifecycle ---------- */

  private async loadRound(groupId: string, cycleId: string, roundId: string, tx?: Tx) {
    const cycle = await this.load(groupId, cycleId, tx);
    const round = cycle.rounds.find((r) => r.id === roundId);
    if (!round) throw new NotFoundException('Payout not found');
    return { cycle, round };
  }

  /** Officers who could approve this payout (holding payouts.approve, not the preparer or recipient). */
  private async eligibleApprovers(groupId: string, exclude: string[]) {
    return (await this.members(groupId)).filter((m) => m.status === 'ACTIVE' && !exclude.includes(m.id) && m.permissions.includes(Permission.PAYOUTS_APPROVE));
  }

  /** Runs the readiness checks and fixes the amount; approvers then approve exactly this. */
  async prepare(groupId: string, cycleId: string, roundId: string, input: { shortfallReason?: string; comment?: string }, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (round.membershipId === actor.id) throw new ForbiddenException('Another officer must prepare your payout.');
    const status = this.displayStatus(cycle, round, this.earliestOpenRound(cycle));
    if (!['READINESS_CHECK', 'AWAITING_APPROVAL', 'APPROVED'].includes(status)) throw new UnprocessableEntityException(`This payout cannot be prepared while it is ${LABELS.payoutStatus[status].toLowerCase()}`);
    const readiness = await this.readinessFor(cycle, round, await this.collections(cycle));
    if (!readiness.ready) {
      const failed = readiness.checks.filter((c) => c.status === 'FAIL');
      throw new UnprocessableEntityException({ message: `Not ready for payout: ${failed.map((c) => c.detail).join(' ')}`, details: { checks: readiness.checks } });
    }
    const reason = input.shortfallReason?.trim() ?? '';
    if (readiness.needsShortfallReason && reason.length < 5) {
      throw new UnprocessableEntityException(`Collection is short by ${formatKes(readiness.shortfallCents)}. Record why the group agrees to pay ${formatKes(readiness.payableCents)}.`);
    }
    const approvers = await this.eligibleApprovers(groupId, [actor.id, round.membershipId]);
    if (approvers.length < round.requiredApprovals) {
      throw new UnprocessableEntityException(`This payout needs ${round.requiredApprovals} approval(s) from officers other than you and the recipient, but only ${approvers.length} can approve. Assign a Payout Approver or change the group's approval rule.`);
    }
    await this.prisma.financial(async (tx) => {
      const claimed = await tx.payoutRound.updateMany({
        where: { id: round.id, preparationNo: round.preparationNo, status: { in: ['SCHEDULED', 'AWAITING_APPROVAL', 'APPROVED'] } },
        data: { status: 'AWAITING_APPROVAL', preparationNo: { increment: 1 }, preparedByMembershipId: actor.id, preparedAt: new Date(), preparedAmountCents: big(readiness.payableCents), readinessSnapshot: readiness as unknown as Prisma.InputJsonValue, shortfallReason: readiness.needsShortfallReason ? reason : null },
      });
      if (claimed.count !== 1) throw new ConflictException('This payout changed while you were preparing it; reload and try again');
      await this.audit.log({ groupId, actorUserId: actor.userId, action: round.status === 'SCHEDULED' ? 'payout.prepared' : 'payout.re_prepared', entityType: 'PayoutRound', entityId: round.id, reason: reason || input.comment, after: { amountCents: readiness.payableCents, checks: readiness.checks }, approvalStatus: 'PENDING', meta }, tx);
    });
    await this.notifications.notify(approvers.map((m) => m.userId), { groupId, type: 'APPROVAL_REQUIRED', title: 'Payout to approve', body: `${cycle.name} round ${round.round}: ${formatKes(readiness.payableCents)} to ${round.membership.user.fullName}${readiness.needsShortfallReason ? ` (short by ${formatKes(readiness.shortfallCents)}: ${reason})` : ''}.`, data: { cycleId, roundId } });
    return this.detail(groupId, cycleId, actor);
  }

  async decidePayout(groupId: string, cycleId: string, roundId: string, input: { decision: 'APPROVE' | 'REJECT'; comment?: string }, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (round.status !== 'AWAITING_APPROVAL') throw new UnprocessableEntityException('This payout is not awaiting approval');
    if (round.membershipId === actor.id) throw new ForbiddenException('You cannot approve your own payout.');
    if (input.decision === 'REJECT' && (input.comment?.trim().length ?? 0) < 5) throw new UnprocessableEntityException('Give a reason for rejecting the payout');
    if (input.decision === 'APPROVE') {
      // Approvers approve what is true now, not only what was true at preparation.
      const readiness = await this.readinessFor(cycle, round, await this.collections(cycle));
      if (!readiness.ready) throw new UnprocessableEntityException({ message: `No longer ready for payout: ${readiness.checks.filter((c) => c.status === 'FAIL').map((c) => c.detail).join(' ')}`, details: { checks: readiness.checks } });
      if (readiness.payableCents !== n(round.preparedAmountCents)) {
        throw new ConflictException(`The confirmed collection changed since preparation (now ${formatKes(readiness.payableCents)}). The payout must be prepared again.`);
      }
    }
    const r = await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'PAYOUT', entityId: this.payoutKey(round), approverMembershipId: actor.id, decision: input.decision, comment: input.comment, excludedMembershipIds: [round.membershipId, ...(round.preparedByMembershipId ? [round.preparedByMembershipId] : [])], excludedMessage: 'The officer who prepared a payout cannot also approve it.', required: round.requiredApprovals });
      if (r.rejected) await tx.payoutRound.updateMany({ where: { id: round.id, status: 'AWAITING_APPROVAL' }, data: { status: 'SCHEDULED' } });
      else if (r.reached) await tx.payoutRound.updateMany({ where: { id: round.id, status: 'AWAITING_APPROVAL' }, data: { status: 'APPROVED' } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `payout.${input.decision === 'APPROVE' ? 'approval' : 'rejected'}`, entityType: 'PayoutRound', entityId: round.id, reason: input.comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', after: { amountCents: n(round.preparedAmountCents), preparation: round.preparationNo }, meta }, tx);
      return r;
    });
    const preparer = round.preparedByMembershipId ? (await this.members(groupId)).find((m) => m.id === round.preparedByMembershipId) : undefined;
    if (preparer && (r.reached || r.rejected)) {
      await this.notifications.notify([preparer.userId], { groupId, type: 'PAYOUT_APPROVED', title: r.reached ? 'Payout approved' : 'Payout rejected', body: `${cycle.name} round ${round.round} to ${round.membership.user.fullName}: ${r.reached ? `approved for ${formatKes(n(round.preparedAmountCents))}. Send it and record the transaction reference.` : `rejected — ${input.comment}`}`, data: { cycleId, roundId } });
    }
    return this.detail(groupId, cycleId, actor);
  }

  /** Records that the approved amount was sent. It is not complete until confirmed. */
  async disburse(groupId: string, cycleId: string, roundId: string, input: { method: string; reference?: string; destination?: string; sentAt: string; evidenceNote?: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    const replay = await this.prisma.payoutDisbursement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) {
      if (replay.roundId !== roundId || replay.groupId !== groupId) throw new UnprocessableEntityException('This idempotency key was used for another payout');
      return this.detail(groupId, cycleId, actor);
    }
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (round.status !== 'APPROVED' && round.status !== 'FAILED') throw new UnprocessableEntityException('Only an approved payout can be sent');
    if (round.membershipId === actor.id) throw new ForbiddenException('Another officer must send your payout.');
    if (input.sentAt > today()) throw new UnprocessableEntityException('The date sent cannot be in the future');
    const amount = n(round.preparedAmountCents);
    const reference = input.reference?.trim().toUpperCase() || null;
    if (reference) {
      const used = await this.prisma.payoutDisbursement.findFirst({ where: { groupId, reference } });
      if (used) throw new ConflictException(`Reference ${reference} is already recorded for another payout`);
    }
    await this.prisma.financial(async (tx) => {
      const available = await this.availableCash(groupId, tx);
      if (available < amount) throw new UnprocessableEntityException(`Insufficient group funds: available ${formatKes(available)}, payout ${formatKes(amount)}`);
      const claimed = await tx.payoutRound.updateMany({ where: { id: round.id, status: { in: ['APPROVED', 'FAILED'] } }, data: { status: 'PROCESSING' } });
      if (claimed.count !== 1) throw new ConflictException('This payout is already being sent');
      await tx.payoutDisbursement.create({
        data: { groupId, roundId: round.id, attempt: round.disbursements.length + 1, idempotencyKey: input.idempotencyKey, amountCents: big(amount), method: input.method as never, reference, destination: input.destination?.trim() || null, sentOn: dbDate(input.sentAt), evidenceNote: input.evidenceNote?.trim() || null, recordedByMembershipId: actor.id },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.sent', entityType: 'PayoutRound', entityId: round.id, reference: reference ?? undefined, after: { amountCents: amount, method: input.method, sentAt: input.sentAt, attempt: round.disbursements.length + 1 }, meta }, tx);
    });
    await this.notifications.notify([round.membership.userId], { groupId, type: 'PAYOUT_SENT', title: 'Payout sent — please confirm', body: `${formatKes(amount)} from ${cycle.name} (round ${round.round}) was sent via ${LABELS.paymentMethod[input.method as keyof typeof LABELS.paymentMethod]}${reference ? `, ref ${reference}` : ''}. Open ChamaHub to confirm you received it, or report a problem.`, data: { cycleId, roundId } });
    return this.detail(groupId, cycleId, actor);
  }

  /**
   * Completion needs evidence independent of the sender: the recipient
   * confirms receipt, or another officer verifies the reference against the
   * provider statement. Only then is the payout posted to the ledger.
   */
  async confirm(groupId: string, cycleId: string, roundId: string, input: { note?: string }, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    const live = round.disbursements.find((d) => d.status === 'PROCESSING');
    if (round.status !== 'PROCESSING' || !live) throw new UnprocessableEntityException('There is no sent payout awaiting confirmation');
    if (actor.supportGrantId) throw new ForbiddenException('Support access is read-only');
    const isRecipient = round.membershipId === actor.id;
    if (!isRecipient) {
      if (!actor.permissions.includes(Permission.ROTATIONS_MANAGE) && !actor.permissions.includes(Permission.PAYOUTS_APPROVE)) throw new ForbiddenException('Only the recipient or another officer can confirm this payout');
      if (live.recordedByMembershipId === actor.id) throw new ForbiddenException('The officer who sent the payout cannot also confirm it. The recipient or another officer must confirm.');
      if (!live.reference && live.method !== 'CASH') throw new UnprocessableEntityException('There is no transaction reference to verify; the recipient must confirm receipt');
      const disputed = await this.prisma.dispute.count({ where: { groupId, roundId: round.id, status: 'OPEN' } });
      if (disputed) throw new UnprocessableEntityException('The recipient reported a problem with this payout. Resolve the dispute first, or let the recipient confirm.');
    }
    const kind = isRecipient ? 'RECIPIENT' : 'OFFICER_VERIFIED';
    const amount = n(live.amountCents);
    await this.prisma.financial(async (tx) => {
      const done = await tx.payoutDisbursement.updateMany({ where: { id: live.id, status: 'PROCESSING' }, data: { status: 'CONFIRMED', confirmationKind: kind, confirmedByUserId: actor.userId, confirmedAt: new Date(), confirmationNote: input.note?.trim() || null } });
      if (done.count !== 1) throw new ConflictException('This payout was already confirmed or marked failed');
      await tx.payoutRound.update({ where: { id: round.id }, data: { status: 'COMPLETED', payoutMethod: live.method, payoutReference: live.reference, payoutAmountCents: live.amountCents, completedAt: new Date() } });
      await this.ledger.post(tx, {
        groupId,
        entryDate: isoDate(live.sentOn),
        type: 'PAYOUT',
        description: `${cycle.name} round ${round.round} payout to ${round.membership.user.fullName}`,
        reference: live.reference,
        membershipId: round.membershipId,
        roundId: round.id,
        createdById: actor.userId,
        lines: [
          { account: 'PAYOUTS', amountCents: amount },
          { account: 'CASH', amountCents: -amount },
        ],
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.completed', entityType: 'PayoutRound', entityId: round.id, reference: live.reference ?? undefined, reason: input.note, after: { amountCents: amount, confirmation: kind }, approvalStatus: 'APPROVED', meta }, tx);
    });
    // Group-wide notice carries no private financial details beyond the rotation itself.
    const members = (await this.members(groupId)).filter((m) => m.status === 'ACTIVE');
    const fresh = await this.load(groupId, cycleId);
    const next = fresh.rounds.find((r) => !DONE.includes(r.status as PayoutStatus));
    await this.notifications.notify(members.map((m) => m.userId), {
      groupId,
      type: 'PAYOUT_COMPLETED',
      title: 'Payout completed',
      body: `${cycle.group.name.toUpperCase()}: Round ${round.round} payout to ${round.membership.user.fullName.split(' ')[0]} is complete (${kind === 'RECIPIENT' ? 'confirmed by the recipient' : 'verified by an officer'}).${next ? ` Next scheduled recipient: ${next.membership.user.fullName.split(' ')[0]} on ${formatDate(isoDate(next.payoutDate))}, subject to the group's rules and approvals.` : ' All rounds are paid.'}`,
      data: { cycleId, roundId },
    });
    return this.detail(groupId, cycleId, actor);
  }

  async fail(groupId: string, cycleId: string, roundId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    const live = round.disbursements.find((d) => d.status === 'PROCESSING');
    if (round.status !== 'PROCESSING' || !live) throw new UnprocessableEntityException('There is no sent payout to mark as failed');
    if (round.membershipId === actor.id) throw new ForbiddenException('Report a problem instead; an officer will investigate');
    if (!actor.permissions.includes(Permission.ROTATIONS_MANAGE) && !actor.permissions.includes(Permission.PAYOUTS_APPROVE)) throw new ForbiddenException('Only officers who send or approve payouts can mark one as failed');
    if (actor.supportGrantId) throw new ForbiddenException('Support access is read-only');
    await this.prisma.financial(async (tx) => {
      const done = await tx.payoutDisbursement.updateMany({ where: { id: live.id, status: 'PROCESSING' }, data: { status: 'FAILED', failureReason: reason, failedByUserId: actor.userId, failedAt: new Date() } });
      if (done.count !== 1) throw new ConflictException('This payout was already confirmed or marked failed');
      await tx.payoutRound.update({ where: { id: round.id }, data: { status: 'FAILED' } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.failed', entityType: 'PayoutRound', entityId: round.id, reference: live.reference ?? undefined, reason, after: { attempt: live.attempt }, meta }, tx);
    });
    await this.notifications.notify([round.membership.userId], { groupId, type: 'PAYOUT_FAILED', title: 'Payout failed', body: `The ${cycle.name} round ${round.round} payout${live.reference ? ` (ref ${live.reference})` : ''} did not go through: ${reason}. Officers will send it again.`, data: { cycleId, roundId } });
    return this.detail(groupId, cycleId, actor);
  }

  /** The recipient reports money not received (or a wrong amount); this opens a dispute that blocks officer confirmation. */
  async reportProblem(groupId: string, cycleId: string, roundId: string, details: string, actor: MembershipContext, meta: RequestMeta) {
    const { cycle, round } = await this.loadRound(groupId, cycleId, roundId);
    if (round.membershipId !== actor.id || actor.supportGrantId) throw new ForbiddenException('Only the recipient can report a problem with their payout');
    if (round.status !== 'PROCESSING' && round.status !== 'COMPLETED') throw new UnprocessableEntityException('Nothing has been sent for this payout yet');
    const d = await this.prisma.dispute.create({ data: { groupId, membershipId: actor.id, roundId: round.id, subject: `Payout round ${round.round}: problem reported`, details } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'payout.problem_reported', entityType: 'Dispute', entityId: d.id, reason: details, meta });
    const officers = (await this.members(groupId)).filter((m) => m.status === 'ACTIVE' && m.id !== actor.id && (m.permissions.includes(Permission.ROTATIONS_MANAGE) || m.permissions.includes(Permission.PAYOUTS_APPROVE)));
    await this.notifications.notify(officers.map((m) => m.userId), { groupId, type: 'ANNOUNCEMENT', title: 'Payout problem reported', body: `${round.membership.user.fullName} reported a problem with the ${cycle.name} round ${round.round} payout: ${details}`, data: { cycleId, roundId, disputeId: d.id } });
    return this.detail(groupId, cycleId, actor);
  }

  /* ---------- amendments ---------- */

  private orderState(c: CycleRow) {
    const lockedRounds = new Set(c.rounds.filter((r) => LOCKED.includes(r.status as PayoutStatus)).map((r) => r.round));
    const live = c.rounds.filter((r) => r.status !== 'CANCELLED');
    // A round is movable only if none of its recipients has entered payout.
    return {
      recipientsPerRound: c.recipientsPerRound,
      locked: live.filter((r) => lockedRounds.has(r.round)).map((r) => r.membershipId),
      movable: live.filter((r) => !lockedRounds.has(r.round)).map((r) => r.membershipId),
      movableRows: live.filter((r) => !lockedRounds.has(r.round)),
      firstMovableRound: live.find((r) => !lockedRounds.has(r.round))?.round ?? (Math.max(0, ...live.map((r) => r.round)) + 1),
    };
  }

  async proposeAmendment(groupId: string, cycleId: string, input: RotationAmendmentInput, actor: MembershipContext, meta: RequestMeta) {
    const c = await this.load(groupId, cycleId);
    if (c.status !== 'ACTIVE') throw new UnprocessableEntityException('Only an active rotation can be amended');
    if (c.changes.some((ch) => ch.status === 'PENDING')) throw new ConflictException('Another amendment is awaiting approval');
    const state = this.orderState(c);
    const change: RotationAmendment = input.kind === 'REORDER' ? { kind: 'REORDER', order: input.order } : input.kind === 'ADD_MEMBERS' ? { kind: 'ADD_MEMBERS', memberIds: input.memberIds } : input.kind === 'REMOVE_MEMBER' ? { kind: 'REMOVE_MEMBER', memberId: input.memberId } : { kind: 'REPLACE_MEMBER', memberId: input.memberId, replacementId: input.replacementId };
    const result = rotationError(() => amendRotationOrder(state, change));
    const active = new Set((await this.members(groupId)).filter((m) => m.status === 'ACTIVE').map((m) => m.id));
    if (result.joined.some((id) => !active.has(id))) throw new UnprocessableEntityException('New members must be active members of this group');
    const ch = await this.prisma.cycleChange.create({ data: { cycleId, kind: input.kind, beforeOrder: state.movable, afterOrder: result.movable, joined: result.joined, left: result.left, reason: input.reason, proposedByMembershipId: actor.id } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.amendment_proposed', entityType: 'CycleChange', entityId: ch.id, before: state.movable, after: { kind: input.kind, order: result.movable, joined: result.joined, left: result.left }, reason: input.reason, approvalStatus: 'PENDING', meta });
    const approvers = await this.eligibleApprovers(groupId, [actor.id]);
    await this.notifications.notify(approvers.map((m) => m.userId), { groupId, type: 'APPROVAL_REQUIRED', title: 'Rotation amendment to approve', body: `${c.name}: ${LABELS.rotationAmendment[input.kind]} — ${input.reason}`, data: { cycleId, changeId: ch.id } });
    return { changeId: ch.id, approvalsRequired: readSettings(c.group.settings).requiredFinancialApprovals };
  }

  /** Older clients send a plain reorder. */
  proposeReorder(groupId: string, cycleId: string, input: { memberIdsInOrder: string[]; reason: string }, actor: MembershipContext, meta: RequestMeta) {
    return this.proposeAmendment(groupId, cycleId, { kind: 'REORDER', order: input.memberIdsInOrder, reason: input.reason }, actor, meta);
  }

  async decideAmendment(groupId: string, cycleId: string, changeId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const change = await this.prisma.cycleChange.findFirst({ where: { id: changeId, cycleId, cycle: { groupId } } });
    if (!change || change.status !== 'PENDING') throw new NotFoundException('Pending amendment not found');
    const c = await this.load(groupId, cycleId);
    const required = readSettings(c.group.settings).requiredFinancialApprovals;
    let applied = false;
    await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'CYCLE_CHANGE', entityId: change.id, approverMembershipId: actor.id, decision, comment, excludedMembershipIds: [change.proposedByMembershipId], excludedMessage: 'Another officer must approve the amendment you proposed.', required });
      if (r.rejected) await tx.cycleChange.update({ where: { id: change.id }, data: { status: 'REJECTED' } });
      else if (r.reached) {
        await this.applyAmendment(tx, groupId, cycleId, change);
        applied = true;
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `rotation.amendment_${decision.toLowerCase()}`, entityType: 'CycleChange', entityId: change.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
    });
    if (applied) {
      await this.obligations.ensureForGroup(groupId);
      const fresh = await this.load(groupId, cycleId);
      const members = await this.members(groupId);
      const affected = new Set([...(change.beforeOrder as string[]), ...(change.afterOrder as string[]), ...((change.left as string[] | null) ?? [])]);
      for (const m of members.filter((x) => affected.has(x.id))) {
        const mine = fresh.rounds.filter((r) => r.membershipId === m.id && r.status !== 'CANCELLED');
        await this.notifications.notify([m.userId], {
          groupId,
          type: 'ROTATION_UPDATED',
          title: 'Rotation schedule amended',
          body: `${c.group.name.toUpperCase()}: "${c.name}" was amended (${LABELS.rotationAmendment[change.kind].toLowerCase()}: ${change.reason}). ${mine.length ? `Your payout: ${mine.map((r) => `round ${r.round} on ${formatDate(isoDate(r.payoutDate))}`).join(', ')}.` : 'You are no longer a recipient in this rotation.'}`,
          data: { cycleId },
        });
      }
    }
    return this.detail(groupId, cycleId, actor);
  }

  /** Back-compat name used by the reorder endpoint. */
  decideReorder(groupId: string, cycleId: string, changeId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    return this.decideAmendment(groupId, cycleId, changeId, decision, comment, actor, meta);
  }

  /**
   * Re-plans the rounds that are not in payout. Round dates always come from
   * the original start date. Obligations follow the schedule: members who
   * leave stop owing future rounds (what they already owe stays owed), and
   * members who join owe only rounds due from the day the amendment applies.
   */
  private async applyAmendment(tx: Tx, groupId: string, cycleId: string, change: { id: string; kind: string; beforeOrder: Prisma.JsonValue; afterOrder: Prisma.JsonValue; joined: Prisma.JsonValue; left: Prisma.JsonValue; reason: string }) {
    const c = await this.load(groupId, cycleId, tx);
    const state = this.orderState(c);
    if (state.movable.join('|') !== (change.beforeOrder as string[]).join('|')) throw new UnprocessableEntityException('The rotation changed since this amendment was proposed; propose it again');
    const after = change.afterOrder as string[];
    const joined = (change.joined as string[] | null) ?? [];
    const left = (change.left as string[] | null) ?? [];
    const t = today();
    const schedule = await tx.contributionSchedule.findUnique({ where: { cycleId }, include: { members: true } });
    if (!schedule) throw new UnprocessableEntityException('This rotation has no contribution schedule');

    // Who contributes from now on (schedule members still in, plus joiners).
    const activeIds = new Set((await tx.membership.findMany({ where: { groupId, status: 'ACTIVE' }, select: { id: true } })).map((m) => m.id));
    const contributing = new Set(schedule.members.filter((m) => !m.untilDate && activeIds.has(m.membershipId)).map((m) => m.membershipId));
    left.forEach((m) => contributing.delete(m));
    joined.forEach((m) => contributing.add(m));
    const plan = rotationError(() => planRotation({ startDate: isoDate(c.startDate), frequency: c.frequency as Frequency, contributionCents: n(c.contributionCents), order: after, recipientsPerRound: c.recipientsPerRound, recipientContributes: c.recipientContributes, firstRound: state.firstMovableRound, contributorCount: contributing.size }));
    const slots = plan.flatMap((r) => r.recipients.map((m, i) => ({ round: r.round, slot: i + 1, membershipId: m, payoutDate: r.payoutDate, expected: r.expectedCollectionCents })));
    const rows = state.movableRows;
    const required = readSettings(c.group.settings).requiredFinancialApprovals;

    for (let i = 0; i < Math.max(rows.length, slots.length); i++) {
      const row = rows[i];
      const slot = slots[i];
      if (row && slot) {
        if (row.round !== slot.round || row.slot !== slot.slot) throw new UnprocessableEntityException('Schedule positions are inconsistent; propose the amendment again');
        if (row.membershipId !== slot.membershipId || n(row.expectedCents) !== slot.expected) {
          await tx.payoutRound.update({ where: { id: row.id }, data: { membershipId: slot.membershipId, expectedCents: big(slot.expected) } });
        }
      } else if (slot) {
        await tx.payoutRound.create({ data: { cycleId, round: slot.round, slot: slot.slot, membershipId: slot.membershipId, payoutDate: dbDate(slot.payoutDate), expectedCents: big(slot.expected), requiredApprovals: required } });
      } else if (row) {
        // The schedule got shorter: the last round is cancelled, never deleted.
        const paid = row.obligations.some((o) => n(o.paidCents) > 0);
        if (paid) throw new UnprocessableEntityException(`Round ${row.round} already has confirmed contributions; reverse or reallocate them before shortening the rotation`);
        const pending = row.obligations.length ? await tx.payment.count({ where: { status: 'PENDING', targetId: { in: row.obligations.map((o) => o.id) } } }) : 0;
        if (pending) throw new UnprocessableEntityException(`Round ${row.round} has payments awaiting verification; resolve them first`);
        await tx.payoutRound.update({ where: { id: row.id }, data: { status: 'CANCELLED', cancelledReason: `Amendment: ${change.reason}` } });
        await tx.contributionObligation.updateMany({ where: { roundId: row.id, waivedReason: null }, data: { waivedReason: `Round cancelled by amendment: ${change.reason}`, status: 'WAIVED' } });
      }
    }

    // Leavers stop owing rounds that have not entered payout and are not yet due.
    // What is already due, and contributions to rounds in payout, stay owed.
    const movableLeadIds = rows.filter((r) => r.slot === 1).map((r) => r.id);
    for (const m of left) {
      await tx.scheduleMember.update({ where: { scheduleId_membershipId: { scheduleId: schedule.id, membershipId: m } }, data: { untilDate: dbDate(t) } });
      const future = await tx.contributionObligation.findMany({ where: { scheduleId: schedule.id, membershipId: m, dueDate: { gt: dbDate(t) }, roundId: { in: movableLeadIds }, waivedReason: null } });
      for (const o of future) {
        if (n(o.paidCents) > 0) throw new UnprocessableEntityException('The leaving member has prepaid a future round; refund or reallocate it first');
        await tx.contributionObligation.update({ where: { id: o.id }, data: { waivedReason: `Left the rotation: ${change.reason}`, status: 'WAIVED' } });
      }
    }
    // Joiners owe rounds due from today on.
    for (const m of joined) {
      await tx.scheduleMember.upsert({ where: { scheduleId_membershipId: { scheduleId: schedule.id, membershipId: m } }, create: { scheduleId: schedule.id, membershipId: m, fromDate: dbDate(t) }, update: { fromDate: dbDate(t), untilDate: null } });
    }
    // Recipients who do not contribute in their own round: re-align obligations of the re-planned rounds.
    if (!c.recipientContributes) {
      for (const slot of slots) {
        const lead = await tx.payoutRound.findFirst({ where: { cycleId, round: slot.round, slot: 1 } });
        if (!lead) continue;
        const recips = slots.filter((s) => s.round === slot.round).map((s) => s.membershipId);
        const obls = await tx.contributionObligation.findMany({ where: { roundId: lead.id } });
        for (const o of obls) {
          const shouldOwe = !recips.includes(o.membershipId) && contributing.has(o.membershipId);
          if (!shouldOwe && !o.waivedReason) {
            if (n(o.paidCents) > 0) throw new UnprocessableEntityException('A new recipient has already contributed to their own round; reverse that payment first');
            await tx.contributionObligation.update({ where: { id: o.id }, data: { waivedReason: `Rotation amended: ${change.reason}`, status: 'WAIVED' } });
          } else if (shouldOwe && o.waivedReason?.startsWith('Rotation amended')) {
            await tx.contributionObligation.update({ where: { id: o.id }, data: { waivedReason: null, status: 'UPCOMING' } });
          }
        }
      }
    }
    const lastDate = slots.length ? slots[slots.length - 1].payoutDate : isoDate(c.rounds.filter((r) => r.status !== 'CANCELLED').at(-1)!.payoutDate);
    await tx.contributionSchedule.update({ where: { id: schedule.id }, data: { endDate: dbDate(lastDate) } });
    await tx.cycleChange.update({ where: { id: change.id }, data: { status: 'APPROVED', appliedAt: new Date() } });
  }

  async close(groupId: string, cycleId: string, actor: MembershipContext, meta: RequestMeta) {
    const cycle = await this.prisma.payoutCycle.findFirst({ where: { id: cycleId, groupId }, include: { rounds: true } });
    if (!cycle) throw new NotFoundException('Rotation not found');
    if (cycle.status !== 'ACTIVE') throw new UnprocessableEntityException('Rotation is not active');
    const open = [...new Set(cycle.rounds.filter((r) => !DONE.includes(r.status as PayoutStatus)).map((r) => r.round))];
    if (open.length) throw new UnprocessableEntityException(`Rounds ${open.join(', ')} are not complete. A cycle is never closed with unpaid rounds.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.payoutCycle.update({ where: { id: cycle.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await tx.contributionSchedule.updateMany({ where: { cycleId: cycle.id }, data: { active: false } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'rotation.closed', entityType: 'PayoutCycle', entityId: cycle.id, meta }, tx);
    });
    return this.detail(groupId, cycleId, actor);
  }
}
