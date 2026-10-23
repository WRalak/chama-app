import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { adjustmentSchema, AuditEventRow, formatKes, isoDateSchema, paginationSchema, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { paginate, skipTake } from '../../common/pagination';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

const auditQuery = paginationSchema.extend({ action: z.string().optional(), entityType: z.string().optional(), actorUserId: z.string().optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() });
const ledgerQuery = paginationSchema.extend({ from: isoDateSchema.optional(), to: isoDateSchema.optional(), type: z.string().optional() });

const FINANCE_ENTITIES = ['Payment', 'Loan', 'Expense', 'Fine', 'PayoutRound', 'PayoutCycle', 'CycleChange', 'Distribution', 'DistributionAllocation', 'JournalEntry', 'ContributionSchedule', 'ContributionObligation', 'ImportBatch', 'UnmatchedPayment', 'PublishedStatement', 'InvestmentHolding'];
const ADMIN_ENTITIES = ['Meeting', 'Resolution', 'ActionItem', 'Announcement', 'Membership', 'Invitation', 'Proposal'];

export function auditScope(m: MembershipContext): Prisma.AuditEventWhereInput {
  if (m.permissions.includes(Permission.AUDIT_VIEW)) return {};
  if (m.permissions.includes(Permission.AUDIT_VIEW_AREA)) {
    const finance = [Permission.CONTRIBUTIONS_RECORD, Permission.EXPENSES_RECORD, Permission.LOANS_DISBURSE, Permission.ROTATIONS_MANAGE, Permission.LEDGER_ADJUST].some((p) => m.permissions.includes(p));
    const admin = [Permission.MEETINGS_MANAGE, Permission.MEMBERS_MANAGE, Permission.MEMBERS_INVITE, Permission.ANNOUNCEMENTS_SEND].some((p) => m.permissions.includes(p));
    const types = [...(finance ? FINANCE_ENTITIES : []), ...(admin ? ADMIN_ENTITIES : [])];
    return { OR: [{ entityType: { in: types } }, { actorUserId: m.userId }] };
  }
  return { actorUserId: m.userId };
}

export function toAuditRow(a: Prisma.AuditEventGetPayload<{ include: { actor: { select: { fullName: true } } } }>): AuditEventRow {
  return { id: a.id, at: a.createdAt.toISOString(), actorName: a.actor?.fullName ?? (a.action.startsWith('platform.') || a.action === 'support.access' ? 'ChamaHub staff' : null), action: a.action, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after, reason: a.reason, reference: a.reference, ipAddress: a.ipAddress };
}

@Controller('groups/:groupId')
export class GroupAuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Full log for AUDIT_VIEW; records in the caller's working areas for
   * AUDIT_VIEW_AREA; and the caller's own activity for everyone else.
   */
  @RequirePermission(Permission.GROUP_VIEW)
  @Get('audit')
  async list(@Param('groupId') groupId: string, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>, @CurrentMembership() m: MembershipContext) {
    const where: Prisma.AuditEventWhereInput = {
      groupId,
      ...auditScope(m),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lt: new Date(dbDate(q.to).getTime() + 86_400_000) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return paginate(rows.map(toAuditRow), total, q.page, q.pageSize);
  }

  @RequirePermission(Permission.REPORTS_VIEW)
  @Get('ledger')
  async journal(@Param('groupId') groupId: string, @Query(new ZodPipe(ledgerQuery)) q: z.infer<typeof ledgerQuery>) {
    const where: Prisma.JournalEntryWhereInput = {
      groupId,
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: dbDate(q.from) } : {}), ...(q.to ? { lte: dbDate(q.to) } : {}) } } : {}),
    };
    const [rows, total, cash] = await Promise.all([
      this.prisma.journalEntry.findMany({ where, include: { lines: true, membership: { select: { user: { select: { fullName: true } } } }, reversedBy: { select: { id: true } } }, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], ...skipTake(q.page, q.pageSize) }),
      this.prisma.journalEntry.count({ where }),
      this.ledger.cashBalance(groupId),
    ]);
    return {
      ...paginate(
        rows.map((e) => ({
          id: e.id,
          date: isoDate(e.entryDate),
          type: e.type,
          description: e.description,
          reference: e.reference,
          memberName: e.membership?.user.fullName ?? null,
          reason: e.reason,
          reversesId: e.reversesId,
          reversedById: e.reversedBy?.id ?? null,
          lines: e.lines.map((l) => ({ account: l.account, amountCents: n(l.amountCents) })),
          createdAt: e.createdAt.toISOString(),
        })),
        total,
        q.page,
        q.pageSize,
      ),
      cashBalanceCents: cash,
    };
  }

  /** Traceable adjustment entry (never an overwrite). */
  @RequirePermission(Permission.LEDGER_ADJUST)
  @Post('ledger/adjustments')
  async adjust(@Param('groupId') groupId: string, @Body(new ZodPipe(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    if (body.effectiveDate > today()) throw new BadRequestException('Adjustment date cannot be in the future');
    const entry = await this.prisma.financial(async (tx) => {
      const e = await this.ledger.post(tx, {
        groupId,
        entryDate: body.effectiveDate,
        type: body.account === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'ADJUSTMENT',
        description: `Adjustment ${formatKes(body.amountCents)}: ${body.reason}`,
        reference: body.reference ?? null,
        reason: body.reason,
        createdById: m.userId,
        // Positive amount increases cash; the counter-entry goes to the chosen account.
        lines: [
          { account: 'CASH', amountCents: body.amountCents },
          { account: body.account, amountCents: -body.amountCents },
        ],
      });
      await this.audit.log({ groupId, actorUserId: m.userId, action: 'ledger.adjustment', entityType: 'JournalEntry', entityId: e.id, after: body, reason: body.reason, reference: body.reference, meta }, tx);
      return e;
    });
    return { id: entry.id };
  }
}
