import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentDestination } from '@prisma/client';
import { CreateDestinationInput, DESTINATION_LABELS, formatKenyanPhone, normalizeKenyanPhone, PaymentDestinationRow, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { ApprovalsService } from '../finance/approvals.service';
import { readSettings } from '../finance/policies';
import { NotificationsService } from '../notifications/notifications.service';

const MOBILE_TYPES = ['PERSONAL_MPESA', 'OTHER_MOBILE_MONEY'];

/** Officers who may see every destination in full, including retired and proposed ones. */
export function seesAllDestinations(viewer: MembershipContext) {
  return [Permission.DESTINATIONS_MANAGE, Permission.CONTRIBUTIONS_VIEW_ALL, Permission.AUDIT_VIEW].some((p) => viewer.permissions.includes(p));
}

/** Who may approve a destination: a different officer who manages destinations or approves payouts. */
function canApproveDestinations(viewer: MembershipContext) {
  return viewer.permissions.includes(Permission.DESTINATIONS_MANAGE) || viewer.permissions.includes(Permission.PAYOUTS_APPROVE);
}

/** "0712345678" → "******5678": enough for a member to recognise an old number, not to pay into it. */
function maskAccount(value: string | null) {
  if (!value) return value;
  return value.length <= 4 ? '****' : `${'*'.repeat(Math.min(6, value.length - 4))}${value.slice(-4)}`;
}

/**
 * Where members send money. A destination is proposed by one officer and
 * becomes active only when another approves; changing a number or account
 * means proposing a replacement, and the old one stays on record as no
 * longer valid. ChamaHub never gets access to these accounts: money paid in
 * is confirmed by an officer, an imported statement or a provider callback.
 */
@Injectable()
export class DestinationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async rows(groupId: string, viewer: MembershipContext): Promise<PaymentDestinationRow[]> {
    const full = seesAllDestinations(viewer);
    const rows = await this.prisma.paymentDestination.findMany({
      where: { groupId, ...(full ? {} : { status: { in: ['ACTIVE', 'RETIRED'] } }) },
      orderBy: [{ status: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: { replacedBy: { where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL'] } }, select: { displayName: true, status: true } } },
    });
    const memberIds = [...new Set(rows.flatMap((r) => [r.responsibleMembershipId, r.proposedByMembershipId]).filter((x): x is string => !!x))];
    const members = await this.prisma.membership.findMany({ where: { id: { in: memberIds } }, select: { id: true, user: { select: { fullName: true } } } });
    const name = new Map(members.map((m) => [m.id, m.user.fullName]));
    const approvals = await this.approvals.records('DESTINATION', rows.map((r) => r.id));
    const todayIso = today();
    return rows.map((d) => {
      const validNow = d.status === 'ACTIVE' && isoDate(d.effectiveFrom)! <= todayIso && (!d.effectiveTo || isoDate(d.effectiveTo)! > todayIso);
      const masked = !full && d.status !== 'ACTIVE';
      return {
        id: d.id,
        type: d.type,
        displayName: d.displayName,
        provider: d.provider,
        accountNumber: masked ? maskAccount(d.accountNumber) : MOBILE_TYPES.includes(d.type) && d.accountNumber ? formatKenyanPhone(d.accountNumber) : d.accountNumber,
        accountReference: masked ? null : d.accountReference,
        accountName: d.accountName,
        branch: masked ? null : d.branch,
        instructions: masked ? null : d.instructions,
        intendedUse: d.intendedUse as PaymentDestinationRow['intendedUse'],
        responsibleName: d.responsibleMembershipId ? (name.get(d.responsibleMembershipId) ?? null) : null,
        verification: d.verification,
        status: d.status,
        validNow,
        effectiveFrom: isoDate(d.effectiveFrom)!,
        effectiveTo: isoDate(d.effectiveTo),
        replacesId: d.replacesId,
        replacedByName: d.replacedBy[0]?.displayName ?? null,
        proposedByName: name.get(d.proposedByMembershipId) ?? '',
        proposalReason: full ? d.proposalReason : null,
        approvals: full ? (approvals.get(d.id) ?? []) : [],
        approvalsRequired: d.requiredApprovals,
        rejectionReason: full ? d.rejectionReason : null,
        can: {
          approve: false,
          retire: d.status === 'ACTIVE' && viewer.permissions.includes(Permission.DESTINATIONS_MANAGE),
          replace: d.status === 'ACTIVE' && viewer.permissions.includes(Permission.DESTINATIONS_MANAGE),
        },
      };
    });
  }

  /** Members see what is valid now and, masked, what no longer is; officers see everything. */
  async list(groupId: string, viewer: MembershipContext): Promise<PaymentDestinationRow[]> {
    const rows = await this.rows(groupId, viewer);
    const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => r.id);
    if (!pending.length || !canApproveDestinations(viewer)) return rows;
    const [mine, proposals] = await Promise.all([
      this.prisma.approval.findMany({ where: { entityType: 'DESTINATION', entityId: { in: pending }, approverMembershipId: viewer.id }, select: { entityId: true } }),
      this.prisma.paymentDestination.findMany({ where: { id: { in: pending } }, select: { id: true, proposedByMembershipId: true } }),
    ]);
    const decided = new Set(mine.map((m) => m.entityId));
    const proposer = new Map(proposals.map((p) => [p.id, p.proposedByMembershipId]));
    return rows.map((r) => (r.status === 'PENDING_APPROVAL' && !decided.has(r.id) && proposer.get(r.id) !== viewer.id ? { ...r, can: { ...r.can, approve: true } } : r));
  }

  async propose(groupId: string, input: CreateDestinationInput, actor: MembershipContext, meta: RequestMeta) {
    const effectiveFrom = input.effectiveFrom ?? today();
    if (input.responsibleMemberId) {
      const m = await this.prisma.membership.findFirst({ where: { id: input.responsibleMemberId, groupId, status: 'ACTIVE' } });
      if (!m) throw new UnprocessableEntityException('The responsible officer must be an active member of this group');
    }
    let replaces: PaymentDestination | null = null;
    if (input.replacesId) {
      replaces = await this.prisma.paymentDestination.findFirst({ where: { id: input.replacesId, groupId } });
      if (!replaces || replaces.status !== 'ACTIVE') throw new UnprocessableEntityException('Only an active destination can be replaced');
      const open = await this.prisma.paymentDestination.findFirst({ where: { replacesId: replaces.id, status: 'PENDING_APPROVAL' } });
      if (open) throw new ConflictException('A replacement for this destination is already waiting for approval');
    }
    const accountNumber = input.accountNumber ? (MOBILE_TYPES.includes(input.type) ? normalizeKenyanPhone(input.accountNumber) : input.accountNumber.replace(/\s+/g, '')) : null;
    const clash = accountNumber
      ? await this.prisma.paymentDestination.findFirst({ where: { groupId, type: input.type as never, accountNumber, accountReference: input.accountReference ?? null, status: { in: ['ACTIVE', 'PENDING_APPROVAL'] }, ...(replaces ? { id: { not: replaces.id } } : {}) } })
      : null;
    if (clash) throw new ConflictException(`"${clash.displayName}" already uses these details`);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const required = readSettings(group.settings).requiredFinancialApprovals;
    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paymentDestination.create({
        data: {
          groupId,
          type: input.type as never,
          displayName: input.displayName,
          provider: input.provider ?? (MOBILE_TYPES.includes(input.type) || ['PAYBILL', 'TILL'].includes(input.type) ? 'M-Pesa' : null),
          accountNumber,
          accountReference: input.accountReference ?? null,
          accountName: input.accountName ?? null,
          branch: input.branch ?? null,
          instructions: input.instructions ?? null,
          intendedUse: input.intendedUse,
          responsibleMembershipId: input.responsibleMemberId ?? (MOBILE_TYPES.includes(input.type) || input.type === 'CASH' ? actor.id : null),
          verification: input.verification as never,
          effectiveFrom: dbDate(effectiveFrom),
          replacesId: replaces?.id ?? null,
          proposedByMembershipId: actor.id,
          proposalReason: input.reason,
          requiredApprovals: required,
        },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: replaces ? 'destination.replacement_proposed' : 'destination.proposed', entityType: 'PaymentDestination', entityId: created.id, before: replaces ? this.snapshot(replaces) : undefined, after: this.snapshot(created), reason: input.reason, approvalStatus: 'PENDING', meta }, tx);
      return created;
    });
    const approvers = await this.approverUserIds(groupId, actor.userId);
    await this.notifications.notify(approvers, {
      groupId,
      type: 'APPROVAL_REQUIRED',
      title: replaces ? 'Payment details change to approve' : 'New payment destination to approve',
      body: replaces ? `${replaces.displayName} → ${d.displayName}. Check the new details before approving.` : `${d.displayName} (${DESTINATION_LABELS.type[d.type]}). Check the details before approving.`,
      data: { destinationId: d.id },
    });
    return { id: d.id, status: d.status };
  }

  async decide(groupId: string, destinationId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    if (!canApproveDestinations(actor)) throw new ForbiddenException('Your role in this group cannot approve payment destinations.');
    const d = await this.prisma.paymentDestination.findFirst({ where: { id: destinationId, groupId } });
    if (!d) throw new NotFoundException('Payment destination not found');
    if (d.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException('This destination is not waiting for approval');
    if (decision === 'REJECT' && !comment) throw new UnprocessableEntityException('Say why you are rejecting it');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const r = await this.approvals.decide(tx, {
        groupId, entityType: 'DESTINATION', entityId: d.id, approverMembershipId: actor.id, decision, comment,
        excludedMembershipIds: [d.proposedByMembershipId], excludedMessage: 'Another officer must approve payment details you proposed.', required: d.requiredApprovals,
      });
      let replaced: PaymentDestination | null = null;
      if (r.rejected) {
        await tx.paymentDestination.update({ where: { id: d.id }, data: { status: 'REJECTED', decidedAt: new Date(), rejectionReason: comment ?? null } });
      } else if (r.reached) {
        const startsOn = isoDate(d.effectiveFrom)! < today() ? today() : isoDate(d.effectiveFrom)!;
        if (d.replacesId) {
          const claimed = await tx.paymentDestination.updateMany({ where: { id: d.replacesId, status: 'ACTIVE' }, data: { status: 'RETIRED', effectiveTo: dbDate(startsOn), retiredReason: `Replaced by ${d.displayName}` } });
          if (claimed.count !== 1) throw new ConflictException('The destination this replaces is no longer active; propose the change again');
          replaced = await tx.paymentDestination.findUnique({ where: { id: d.replacesId } });
        }
        await tx.paymentDestination.update({ where: { id: d.id }, data: { status: 'ACTIVE', decidedAt: new Date(), effectiveFrom: dbDate(startsOn) } });
      }
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `destination.${decision.toLowerCase()}`, entityType: 'PaymentDestination', entityId: d.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
      return { ...r, replaced };
    });
    if (outcome.reached) await this.announce(groupId, d, outcome.replaced);
    else if (outcome.rejected) {
      const proposer = await this.prisma.membership.findUniqueOrThrow({ where: { id: d.proposedByMembershipId }, select: { userId: true } });
      await this.notifications.notify([proposer.userId], { groupId, type: 'DESTINATION_CHANGED', title: 'Payment destination rejected', body: `${d.displayName}: ${comment}`, data: { destinationId: d.id } });
    }
    return { ok: true, status: outcome.rejected ? 'REJECTED' : outcome.reached ? 'ACTIVE' : 'PENDING_APPROVAL' };
  }

  /** Stops members paying to a destination (e.g. the treasurer changed). One officer may do this; everyone is told at once. */
  async retire(groupId: string, destinationId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const d = await this.prisma.paymentDestination.findFirst({ where: { id: destinationId, groupId } });
    if (!d) throw new NotFoundException('Payment destination not found');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.paymentDestination.updateMany({ where: { id: d.id, status: 'ACTIVE' }, data: { status: 'RETIRED', effectiveTo: dbDate(today()), retiredReason: reason } });
      if (r.count !== 1) throw new UnprocessableEntityException('Only an active destination can be retired');
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'destination.retired', entityType: 'PaymentDestination', entityId: d.id, before: { status: 'ACTIVE' }, after: { status: 'RETIRED' }, reason, meta }, tx);
    });
    const members = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(members, {
      groupId, type: 'DESTINATION_CHANGED', title: 'Stop paying to this destination',
      body: `${d.displayName} is no longer valid for payments to the group. Open “How to pay” for current details.`, data: { destinationId: d.id },
    });
    return { ok: true };
  }

  /** Throws unless the member may still pay to this destination today. */
  async assertPayable(tx: Tx | PrismaService, groupId: string, destinationId: string, paidAt: string) {
    const d = await tx.paymentDestination.findFirst({ where: { id: destinationId, groupId } });
    if (!d) throw new UnprocessableEntityException('Unknown payment destination');
    if (d.status === 'PENDING_APPROVAL' || d.status === 'REJECTED') throw new UnprocessableEntityException('That destination has not been approved for payments');
    const from = isoDate(d.effectiveFrom)!;
    const to = isoDate(d.effectiveTo);
    // A payment made while the destination was valid is still accepted after it retires.
    if (paidAt < from || (to && paidAt >= to)) throw new UnprocessableEntityException(`${d.displayName} was not valid for payments on ${paidAt}`);
    return d;
  }

  private async announce(groupId: string, d: PaymentDestination, replaced: PaymentDestination | null) {
    const members = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(members, replaced
      ? { groupId, type: 'DESTINATION_CHANGED', title: 'The group’s payment details have changed', body: `Pay to ${d.displayName} from now on. ${replaced.displayName} is no longer valid. Open “How to pay” to see the details.`, data: { destinationId: d.id } }
      : { groupId, type: 'DESTINATION_CHANGED', title: 'New way to pay the group', body: `${d.displayName} is now approved for payments. Open “How to pay” to see the details.`, data: { destinationId: d.id } });
  }

  private async approverUserIds(groupId: string, exceptUserId: string) {
    const ids = await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER']);
    return ids.filter((id) => id !== exceptUserId);
  }

  private snapshot(d: PaymentDestination) {
    return { type: d.type, displayName: d.displayName, provider: d.provider, accountNumber: d.accountNumber, accountReference: d.accountReference, accountName: d.accountName, branch: d.branch, effectiveFrom: isoDate(d.effectiveFrom) };
  }
}
