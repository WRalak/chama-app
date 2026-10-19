import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ExpenseRow, formatKes, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalsService } from '../finance/approvals.service';
import { readSettings } from '../finance/policies';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(groupId: string, viewer: MembershipContext, status?: string): Promise<ExpenseRow[]> {
    const rows = await this.prisma.expense.findMany({ where: { groupId, ...(status ? { status: status as never } : {}) }, orderBy: { incurredOn: 'desc' } });
    const approvals = await this.approvals.records('EXPENSE', rows.map((r) => r.id));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    const mine = await this.prisma.approval.findMany({ where: { entityType: 'EXPENSE', approverMembershipId: viewer.id || '-', entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true } });
    const decided = new Set(mine.map((d) => d.entityId));
    return rows.map((e) => ({
      id: e.id,
      category: e.category,
      description: e.description,
      amountCents: n(e.amountCents),
      incurredOn: isoDate(e.incurredOn),
      payee: e.payee,
      status: e.status,
      recordedByName: name.get(e.recordedById) ?? '',
      approvals: approvals.get(e.id) ?? [],
      approvalsRequired: e.requiredApprovals,
      paymentReference: e.paymentReference,
      paidAt: isoDate(e.paidAt),
      canApprove: e.status === 'PENDING_APPROVAL' && viewer.permissions.includes(Permission.EXPENSES_APPROVE) && e.recordedById !== viewer.userId && !decided.has(e.id),
    }));
  }

  async create(groupId: string, input: { category: string; description: string; amountCents: number; incurredOn: string; payee?: string }, actor: MembershipContext, meta: RequestMeta) {
    if (input.incurredOn > today()) throw new UnprocessableEntityException('Expense date cannot be in the future');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    const e = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: { groupId, category: input.category, description: input.description, amountCents: big(input.amountCents), incurredOn: dbDate(input.incurredOn), payee: input.payee ?? null, recordedById: actor.userId, requiredApprovals: readSettings(group.settings).requiredFinancialApprovals },
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'expense.recorded', entityType: 'Expense', entityId: created.id, after: input, approvalStatus: 'PENDING', meta }, tx);
      return created;
    });
    const approvers = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'VICE_CHAIRPERSON'])).filter((u) => u !== actor.userId);
    await this.notifications.notify(approvers, { groupId, type: 'APPROVAL_REQUIRED', title: 'Expense to approve', body: `${formatKes(input.amountCents)} — ${input.description}` });
    return { id: e.id };
  }

  async decide(groupId: string, expenseId: string, decision: 'APPROVE' | 'REJECT', comment: string | undefined, actor: MembershipContext, meta: RequestMeta) {
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, groupId } });
    if (!e) throw new NotFoundException('Expense not found');
    if (e.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException('This expense is not awaiting approval');
    if (e.recordedById === actor.userId) throw new ForbiddenException('Another officer must approve an expense you recorded.');
    await this.prisma.financial(async (tx) => {
      const r = await this.approvals.decide(tx, { groupId, entityType: 'EXPENSE', entityId: e.id, approverMembershipId: actor.id, decision, comment, excludedMembershipIds: [], required: e.requiredApprovals });
      if (r.rejected) await tx.expense.update({ where: { id: e.id }, data: { status: 'REJECTED' } });
      else if (r.reached) await tx.expense.update({ where: { id: e.id }, data: { status: 'APPROVED' } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: `expense.${decision.toLowerCase()}`, entityType: 'Expense', entityId: e.id, reason: comment, approvalStatus: r.rejected ? 'REJECTED' : r.reached ? 'APPROVED' : 'PENDING', meta }, tx);
    });
    return { ok: true };
  }

  async pay(groupId: string, expenseId: string, input: { method: string; reference?: string; paidAt: string; idempotencyKey: string }, actor: MembershipContext, meta: RequestMeta) {
    const replay = await this.prisma.expense.findUnique({ where: { paymentKey: input.idempotencyKey } });
    if (replay) {
      if (replay.id !== expenseId) throw new UnprocessableEntityException('This idempotency key was used for another expense');
      return { ok: true, replayed: true };
    }
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, groupId } });
    if (!e) throw new NotFoundException('Expense not found');
    if (e.status !== 'APPROVED') throw new UnprocessableEntityException('Only approved expenses can be paid');
    if (input.paidAt > today()) throw new UnprocessableEntityException('Payment date cannot be in the future');
    await this.prisma.financial(async (tx) => {
      const cash = await this.ledger.cashBalance(groupId, {}, tx);
      if (cash < n(e.amountCents)) throw new UnprocessableEntityException(`Insufficient group funds: available ${formatKes(cash)}`);
      const claimed = await tx.expense.updateMany({ where: { id: e.id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: dbDate(input.paidAt), paymentMethod: input.method as never, paymentReference: input.reference ?? null, paymentKey: input.idempotencyKey } });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Expense already paid');
      await this.ledger.post(tx, {
        groupId,
        entryDate: input.paidAt,
        type: 'EXPENSE',
        description: `${e.category}: ${e.description}`,
        reference: input.reference ?? null,
        expenseId: e.id,
        createdById: actor.userId,
        lines: [
          { account: 'EXPENSES', amountCents: n(e.amountCents) },
          { account: 'CASH', amountCents: -n(e.amountCents) },
        ],
      });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'expense.paid', entityType: 'Expense', entityId: e.id, after: input, reference: input.reference, meta }, tx);
    });
    return { ok: true };
  }

  async reverse(groupId: string, expenseId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, groupId } });
    if (!e) throw new NotFoundException('Expense not found');
    await this.prisma.financial(async (tx) => {
      const claimed = await tx.expense.updateMany({ where: { id: e.id, status: 'PAID' }, data: { status: 'REVERSED' } });
      if (claimed.count !== 1) throw new UnprocessableEntityException('Only paid expenses can be reversed');
      await this.ledger.reverseWhere(tx, { expenseId: e.id }, { reason, date: today(), createdById: actor.userId });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'expense.reversed', entityType: 'Expense', entityId: e.id, reason, meta }, tx);
    });
    return { ok: true };
  }
}
