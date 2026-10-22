import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { GroupRole, Prisma } from '@prisma/client';
import { formatKes, HandoverRow, HandoverSnapshot, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';

export const HANDOVER_ROLES: GroupRole[] = ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY'];
const REMINDER_GAP_HOURS = 12;

/**
 * Officer handovers and contribution reminders.
 *
 * A handover records what an incoming officer takes over: figures read from
 * the ledger and the open work at the moment of the change. The record is
 * permanent (enforced by the database) and the incoming officer acknowledges
 * it once.
 */
@Injectable()
export class OfficersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly finance: MemberFinanceService,
    private readonly notifications: NotificationsService,
  ) {}

  async snapshot(groupId: string, tx?: Tx): Promise<HandoverSnapshot> {
    const db = tx ?? this.prisma;
    const [cash, contributions, owing, pending, unmatched, lines, disputes, loans, expenses, payouts, loanApps, destinations, active, next, actions] = await Promise.all([
      this.ledger.cashBalance(groupId, {}, tx),
      db.journalLine.aggregate({ where: { account: 'MEMBER_CONTRIBUTIONS', entry: { groupId } }, _sum: { amountCents: true } }),
      this.finance.outstandingObligations(groupId, undefined, tx),
      db.payment.aggregate({ where: { groupId, status: 'PENDING' }, _sum: { amountCents: true }, _count: true }),
      db.unmatchedPayment.count({ where: { groupId, status: 'UNMATCHED' } }),
      db.statementLine.count({ where: { groupId, state: 'OPEN', match: { notIn: ['DUPLICATE', 'OUTGOING'] }, statementImport: { status: 'REVIEWING' } } }),
      db.dispute.count({ where: { groupId, status: 'OPEN' } }),
      this.finance.loanBalances(groupId, undefined, tx),
      db.expense.count({ where: { groupId, status: 'PENDING_APPROVAL' } }),
      db.payoutRound.count({ where: { cycle: { groupId }, status: 'AWAITING_APPROVAL' } }),
      db.loan.count({ where: { groupId, status: 'PENDING_APPROVAL' } }),
      db.paymentDestination.count({ where: { groupId, status: 'PENDING_APPROVAL' } }),
      db.paymentDestination.findMany({ where: { groupId, status: 'ACTIVE' }, select: { displayName: true }, orderBy: { effectiveFrom: 'asc' } }),
      db.payoutRound.findFirst({ where: { cycle: { groupId, status: 'ACTIVE' }, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, orderBy: [{ payoutDate: 'asc' }, { slot: 'asc' }], include: { membership: { select: { user: { select: { fullName: true } } } } } }),
      db.actionItem.count({ where: { done: false, meeting: { groupId } } }),
    ]);
    const owed = [...owing.values()].filter((c) => c > 0);
    const loanBalances = [...loans.values()].filter((c) => c > 0);
    return {
      asOf: new Date().toISOString(),
      cashBalanceCents: Number(cash),
      confirmedContributionsCents: -n(contributions._sum.amountCents),
      outstandingContributionsCents: owed.reduce((a, b) => a + b, 0),
      membersOwing: owed.length,
      pendingVerification: { count: pending._count, cents: n(pending._sum.amountCents) },
      unmatchedPayments: unmatched,
      openStatementLines: lines,
      openDisputes: disputes,
      loansOutstanding: { count: loanBalances.length, cents: loanBalances.reduce((a, b) => a + b, 0) },
      pendingApprovals: { expenses, payouts, loans: loanApps, destinations },
      activeDestinations: active.map((d) => d.displayName),
      nextPayout: next ? { round: next.round, recipientName: next.membership.user.fullName, payoutDate: isoDate(next.payoutDate)!, status: next.status } : null,
      openActionItems: actions,
    };
  }

  /** Called inside the role-change transaction, so the record and the change commit together. */
  async recordRoleChange(tx: Tx, groupId: string, membershipId: string, from: GroupRole, to: GroupRole, actorUserId: string) {
    if (from === to) return;
    const snap = (await this.snapshot(groupId, tx)) as unknown as Prisma.InputJsonValue;
    if (HANDOVER_ROLES.includes(from)) {
      await tx.officerHandover.create({ data: { groupId, role: from, outgoingMembershipId: membershipId, trigger: 'role_change', snapshot: snap, createdById: actorUserId } });
    }
    if (HANDOVER_ROLES.includes(to)) {
      await tx.officerHandover.create({ data: { groupId, role: to, incomingMembershipId: membershipId, trigger: 'role_change', snapshot: snap, createdById: actorUserId } });
    }
  }

  /** An officer prepares a handover before leaving office (e.g. ahead of elections). */
  async prepare(groupId: string, role: GroupRole, notes: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const holds = actor.role === role;
    if (!holds && !actor.permissions.includes(Permission.GROUP_CONFIGURE)) throw new ForbiddenException('Only the current office holder or the chairperson can prepare this handover.');
    const h = await this.prisma.$transaction(async (tx) => {
      const created = await tx.officerHandover.create({
        data: { groupId, role, outgoingMembershipId: holds ? actor.id : null, trigger: 'manual', snapshot: (await this.snapshot(groupId, tx)) as unknown as Prisma.InputJsonValue, notes: notes ?? null, createdById: actor.userId },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'handover.prepared', entityType: 'OfficerHandover', entityId: created.id, after: { role }, meta }, tx);
      return created;
    });
    return { id: h.id };
  }

  async list(groupId: string, viewer: MembershipContext): Promise<HandoverRow[]> {
    const all = viewer.permissions.includes(Permission.GROUP_CONFIGURE) || viewer.permissions.includes(Permission.AUDIT_VIEW);
    const rows = await this.prisma.officerHandover.findMany({
      where: { groupId, ...(all ? {} : { OR: [{ outgoingMembershipId: viewer.id }, { incomingMembershipId: viewer.id }, { role: viewer.role as GroupRole }] }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const memberIds = [...new Set(rows.flatMap((r) => [r.outgoingMembershipId, r.incomingMembershipId]).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.acknowledgedById]).filter((x): x is string => !!x))];
    const [members, users] = await Promise.all([
      this.prisma.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, user: { select: { fullName: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    ]);
    const mName = new Map(members.map((m) => [m.id, m.user.fullName]));
    const uName = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      outgoingName: r.outgoingMembershipId ? (mName.get(r.outgoingMembershipId) ?? null) : null,
      incomingName: r.incomingMembershipId ? (mName.get(r.incomingMembershipId) ?? null) : null,
      trigger: r.trigger as HandoverRow['trigger'],
      snapshot: r.snapshot as unknown as HandoverSnapshot,
      notes: r.notes,
      createdByName: uName.get(r.createdById) ?? '',
      createdAt: r.createdAt.toISOString(),
      acknowledgedByName: r.acknowledgedById ? (uName.get(r.acknowledgedById) ?? null) : null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      acknowledgementNote: r.acknowledgementNote,
      can: { acknowledge: !r.acknowledgedAt && this.mayAcknowledge(r, viewer) },
    }));
  }

  private mayAcknowledge(r: { role: GroupRole; incomingMembershipId: string | null; outgoingMembershipId: string | null }, viewer: MembershipContext) {
    if (r.outgoingMembershipId === viewer.id) return false;
    return r.incomingMembershipId ? r.incomingMembershipId === viewer.id : viewer.role === r.role;
  }

  /** The incoming officer confirms they received the records as shown. */
  async acknowledge(groupId: string, id: string, note: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const h = await this.prisma.officerHandover.findFirst({ where: { id, groupId } });
    if (!h) throw new NotFoundException('Handover not found');
    if (h.acknowledgedAt) throw new UnprocessableEntityException('This handover was already acknowledged');
    if (!this.mayAcknowledge(h, actor)) throw new ForbiddenException('Only the incoming office holder can acknowledge this handover.');
    await this.prisma.$transaction(async (tx) => {
      await tx.officerHandover.update({ where: { id: h.id }, data: { acknowledgedById: actor.userId, acknowledgedAt: new Date(), acknowledgementNote: note ?? null } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'handover.acknowledged', entityType: 'OfficerHandover', entityId: h.id, reason: note, meta }, tx);
    });
    return { ok: true };
  }

  /**
   * Reminds members who owe contributions that are already due. Each member is
   * told only their own amount. At most once every 12 hours per group.
   */
  async sendContributionReminders(groupId: string, memberIds: string[] | undefined, actor: MembershipContext, meta: RequestMeta) {
    if (![Permission.CONTRIBUTIONS_RECORD, Permission.RECONCILIATION_MANAGE].some((p) => actor.permissions.includes(p))) {
      throw new ForbiddenException('Only the treasurer (or an officer who records or reconciles contributions) can send reminders.');
    }
    const last = await this.prisma.auditEvent.findFirst({ where: { groupId, action: 'contributions.reminders_sent' }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < REMINDER_GAP_HOURS * 3600_000) {
      throw new HttpException(`Reminders were already sent at ${last.createdAt.toISOString().slice(11, 16)} UTC. Members can be reminded again ${REMINDER_GAP_HOURS} hours after the last reminder.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
    const owed = await this.finance.outstandingObligations(groupId, memberIds);
    const ids = [...owed.entries()].filter(([, c]) => c > 0).map(([id]) => id);
    const members = await this.prisma.membership.findMany({ where: { id: { in: ids }, groupId, status: 'ACTIVE' }, select: { id: true, userId: true } });
    for (const m of members) {
      await this.notifications.notify([m.userId], {
        groupId,
        type: 'CONTRIBUTION_OVERDUE',
        title: `${group.name}: contribution reminder`,
        body: `You owe ${formatKes(owed.get(m.id)!)} in contributions that are already due. If you have paid, report it in the app so the treasurer can confirm it.`,
      });
    }
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'contributions.reminders_sent', entityType: 'Group', entityId: groupId, after: { members: members.length, date: today() }, meta });
    return { sent: members.length };
  }
}

