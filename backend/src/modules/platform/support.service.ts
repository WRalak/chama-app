import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportCase, SupportCategory, SupportPriority, SupportStatus } from '@prisma/client';
import { maskPhone, MySupportCase, SupportCaseDetail, SupportCaseRow } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { paginate, skipTake } from '../../common/pagination';
import { RequestMeta, StaffContext } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformAuditService } from '../platform-auth/platform-audit.service';

const CLOSED: SupportStatus[] = ['RESOLVED', 'CLOSED'];
const MONEY_CATEGORIES: SupportCategory[] = ['CONTRIBUTIONS_PAYMENTS', 'PAYOUT_ROTATION', 'LOANS_REPAYMENTS'];

/** Shown to staff on money-related cases: support never edits a group's records. */
export const FINANCIAL_GUIDANCE =
  'Support cannot change contributions, loans, payouts or the ledger. Explain the steps to the group: an officer with the right role records a correction or reversal in the app, with its own approval and audit trail. If records look tampered with, escalate.';

export interface StaffCaseQuery {
  page: number;
  pageSize: number;
  status?: SupportStatus;
  priority?: SupportPriority;
  category?: SupportCategory;
  q?: string;
  /** "mine" = assigned to me; "unassigned"; "all" (managers only). */
  scope?: 'mine' | 'unassigned' | 'all';
}

const caseInclude = {
  requester: { select: { id: true, fullName: true } },
  group: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.SupportCaseInclude;

/**
 * Support cases. Members open and follow their own cases; staff work them. Internal notes live in
 * their own table and no member-facing query reads it. Support never edits financial records.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAudit: PlatformAuditService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ================= member side ================= */

  async open(userId: string, input: { subject: string; category: SupportCategory; description: string; groupId?: string }, meta: RequestMeta): Promise<MySupportCase> {
    if (input.groupId) {
      // A member can only attach a group they belong to.
      const m = await this.prisma.membership.findUnique({ where: { groupId_userId: { groupId: input.groupId, userId } }, select: { status: true } });
      if (!m || m.status === 'EXITED') throw new NotFoundException('Group not found');
    }
    const c = await this.prisma.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('support_case_seq') AS n`;
      const created = await tx.supportCase.create({
        data: {
          number: `CH-${n.toString().padStart(6, '0')}`,
          requesterUserId: userId,
          groupId: input.groupId ?? null,
          subject: input.subject,
          category: input.category,
          description: input.description,
          // Security concerns go to the top of the queue.
          priority: input.category === 'SECURITY' ? 'HIGH' : 'NORMAL',
        },
      });
      await tx.supportMessage.create({ data: { caseId: created.id, authorUserId: userId, body: input.description } });
      return created;
    });
    await this.audit.log({ groupId: c.groupId, actorUserId: userId, action: 'support.case_opened', entityType: 'SupportCase', entityId: c.id, after: { number: c.number, category: c.category }, meta });
    return this.mine(userId, c.id);
  }

  async myCases(userId: string): Promise<MySupportCase[]> {
    const rows = await this.prisma.supportCase.findMany({ where: { requesterUserId: userId }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true } });
    return Promise.all(rows.map((r) => this.mine(userId, r.id)));
  }

  /** The member's view: the conversation only. Notes, assignment history and staff identities are not included. */
  async mine(userId: string, id: string): Promise<MySupportCase> {
    const c = await this.prisma.supportCase.findFirst({
      where: { id, requesterUserId: userId },
      select: { id: true, number: true, subject: true, category: true, status: true, resolution: true, createdAt: true, updatedAt: true, group: { select: { name: true } }, messages: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, createdAt: true, authorUserId: true } } },
    });
    if (!c) throw new NotFoundException('Support case not found');
    return {
      id: c.id,
      number: c.number,
      subject: c.subject,
      category: c.category,
      status: c.status,
      groupName: c.group?.name ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      resolution: c.resolution,
      messages: c.messages.map((m) => ({ id: m.id, from: m.authorUserId ? 'YOU' : 'CHAMAHUB', authorName: m.authorUserId ? 'You' : 'ChamaHub Support', body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  }

  async memberReply(userId: string, id: string, body: string): Promise<MySupportCase> {
    const c = await this.prisma.supportCase.findFirst({ where: { id, requesterUserId: userId } });
    if (!c) throw new NotFoundException('Support case not found');
    if (c.status === 'CLOSED') throw new BadRequestException('This case is closed. Open a new one if you still need help.');
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { caseId: id, authorUserId: userId, body } }),
      // A reply reopens a resolved case and hands a waiting case back to staff.
      this.prisma.supportCase.update({ where: { id }, data: { status: c.status === 'ESCALATED' ? 'ESCALATED' : c.assignedToId ? 'IN_PROGRESS' : 'OPEN', resolvedAt: c.status === 'RESOLVED' ? null : undefined } }),
    ]);
    return this.mine(userId, id);
  }

  async memberClose(userId: string, id: string): Promise<MySupportCase> {
    const r = await this.prisma.supportCase.updateMany({ where: { id, requesterUserId: userId, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Open support case not found');
    return this.mine(userId, id);
  }

  /* ================= staff side ================= */

  private canSeeAll(staff: StaffContext) {
    return staff.permissions.includes('platform.support_manage');
  }

  async list(staff: StaffContext, q: StaffCaseQuery) {
    const all = this.canSeeAll(staff);
    const scope = all ? (q.scope ?? 'all') : 'mine';
    const where: Prisma.SupportCaseWhereInput = {
      ...(scope === 'mine' ? { assignedToId: staff.accountId } : scope === 'unassigned' ? { assignedToId: null } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q.toUpperCase() } }, { subject: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supportCase.findMany({ where, include: caseInclude, orderBy: [{ status: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }], ...skipTake(q.page, q.pageSize) }),
      this.prisma.supportCase.count({ where }),
    ]);
    return paginate(rows.map(toRow), total, q.page, q.pageSize);
  }

  /** Loads a case the staff member may work on: assigned to them, or any case for support managers. */
  private async workable(staff: StaffContext, id: string) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    // Same answer whether the case does not exist or is someone else's.
    if (!c || (!this.canSeeAll(staff) && c.assignedToId !== staff.accountId)) throw new NotFoundException('Support case not found');
    return c;
  }

  async detail(staff: StaffContext, id: string, meta: RequestMeta): Promise<SupportCaseDetail> {
    await this.workable(staff, id);
    const c = await this.prisma.supportCase.findUniqueOrThrow({
      where: { id },
      include: {
        ...caseInclude,
        requester: { select: { id: true, fullName: true, phone: true, email: true, disabledAt: true, lockedUntil: true, createdAt: true, _count: { select: { memberships: { where: { status: { not: 'EXITED' } } } } } } },
        group: { select: { id: true, name: true, countryCode: true, status: true, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }, subscription: { select: { status: true, plan: { select: { name: true } } } } } },
        messages: { orderBy: { createdAt: 'asc' } },
        notes: { orderBy: { createdAt: 'asc' } },
        assignments: { orderBy: { createdAt: 'asc' } },
      },
    });
    const staffIds = [c.assignedToId, ...c.messages.map((m) => m.authorAccountId), ...c.notes.map((n) => n.authorAccountId), ...c.assignments.flatMap((a) => [a.assignedToId, a.assignedById])];
    const names = await this.staffNames(staffIds);
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: 'platform.support_case_viewed', targetType: 'SupportCase', targetId: id, meta });
    const r = c.requester;
    return {
      ...toRow(c),
      description: c.description,
      resolution: c.resolution,
      escalationReason: c.escalationReason,
      requester: { id: r.id, name: r.fullName, phoneMasked: maskPhone(r.phone), email: r.email ? r.email.replace(/^(.).*(@.*)$/, '$1•••$2') : null, accountStatus: r.disabledAt ? 'DISABLED' : r.lockedUntil && r.lockedUntil > new Date() ? 'LOCKED' : 'ACTIVE', memberSince: r.createdAt.toISOString(), groups: r._count.memberships },
      group: c.group ? { id: c.group.id, name: c.group.name, countryCode: c.group.countryCode, members: c.group._count.memberships, plan: c.group.subscription?.plan.name ?? 'Free', status: c.group.status } : null,
      messages: c.messages.map((m) => ({ id: m.id, from: m.authorUserId ? 'USER' : 'STAFF', authorName: m.authorUserId ? r.fullName : (names.get(m.authorAccountId ?? '') ?? 'Staff'), body: m.body, createdAt: m.createdAt.toISOString() })),
      notes: c.notes.map((n) => ({ id: n.id, authorName: names.get(n.authorAccountId) ?? 'Staff', body: n.body, createdAt: n.createdAt.toISOString() })),
      assignments: c.assignments.map((a) => ({ to: a.assignedToId ? (names.get(a.assignedToId) ?? 'Staff') : null, by: a.assignedById ? (names.get(a.assignedById) ?? 'Staff') : 'System', at: a.createdAt.toISOString() })),
      canWork: c.status !== 'CLOSED',
      canAssign: this.canSeeAll(staff),
      financialGuidance: MONEY_CATEGORIES.includes(c.category) ? FINANCIAL_GUIDANCE : null,
    };
  }

  async reply(staff: StaffContext, id: string, input: { body: string; requestClarification: boolean }, meta: RequestMeta) {
    const c = await this.workable(staff, id);
    if (c.status === 'CLOSED') throw new BadRequestException('This case is closed.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({ data: { caseId: id, authorAccountId: staff.accountId, body: input.body } }),
      this.prisma.supportCase.update({ where: { id }, data: { status: input.requestClarification ? 'WAITING_FOR_USER' : c.status === 'ESCALATED' ? 'ESCALATED' : 'IN_PROGRESS', firstResponseAt: c.firstResponseAt ?? now } }),
    ]);
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: input.requestClarification ? 'platform.support_clarification_requested' : 'platform.support_replied', targetType: 'SupportCase', targetId: id, meta });
    await this.notifications.notify([c.requesterUserId], { groupId: c.groupId, type: 'SUPPORT', title: `Reply on ${c.number}`, body: input.requestClarification ? 'ChamaHub Support needs a little more information from you.' : 'ChamaHub Support replied to your request.', data: { supportCaseId: id } });
    return this.detail(staff, id, meta);
  }

  async note(staff: StaffContext, id: string, body: string, meta: RequestMeta) {
    await this.workable(staff, id);
    await this.prisma.supportInternalNote.create({ data: { caseId: id, authorAccountId: staff.accountId, body } });
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: 'platform.support_note_added', targetType: 'SupportCase', targetId: id, meta });
    return this.detail(staff, id, meta);
  }

  async assign(staff: StaffContext, id: string, accountId: string | null, meta: RequestMeta) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Support case not found');
    if (accountId) {
      const target = await this.prisma.platformAccount.findUnique({ where: { id: accountId }, select: { status: true, roles: { select: { role: { select: { permissions: { select: { permission: true } } } } } }, permissions: { select: { permission: true } } } });
      const supports = target && [...target.roles.flatMap((r) => r.role.permissions), ...target.permissions].some((p) => p.permission === 'platform.support');
      if (!target || target.status !== 'ACTIVE' || !supports) throw new BadRequestException('Cases can only be assigned to active staff with support access.');
    }
    await this.prisma.$transaction([
      this.prisma.supportCase.update({ where: { id }, data: { assignedToId: accountId, status: accountId ? (c.status === 'OPEN' ? 'ASSIGNED' : c.status) : c.status === 'ASSIGNED' ? 'OPEN' : c.status } }),
      this.prisma.supportAssignment.create({ data: { caseId: id, assignedToId: accountId, assignedById: staff.accountId } }),
    ]);
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: 'platform.support_assigned', targetType: 'SupportCase', targetId: id, before: { assignedToId: c.assignedToId }, after: { assignedToId: accountId }, meta });
    return this.detail(staff, id, meta);
  }

  async setStatus(staff: StaffContext, id: string, input: { status: 'IN_PROGRESS' | 'WAITING_FOR_USER' | 'RESOLVED' | 'CLOSED'; resolution?: string }, meta: RequestMeta) {
    const c = await this.workable(staff, id);
    if (c.status === 'CLOSED') throw new BadRequestException('This case is closed.');
    const resolution = input.resolution?.trim() || c.resolution;
    if ((input.status === 'RESOLVED' || input.status === 'CLOSED') && !resolution) throw new BadRequestException('Write a short resolution summary first.');
    const now = new Date();
    await this.prisma.supportCase.update({
      where: { id },
      data: { status: input.status, resolution, resolvedAt: input.status === 'RESOLVED' || input.status === 'CLOSED' ? (c.resolvedAt ?? now) : null, closedAt: input.status === 'CLOSED' ? now : null },
    });
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: `platform.support_${input.status.toLowerCase()}`, targetType: 'SupportCase', targetId: id, before: { status: c.status }, after: { status: input.status, resolution }, meta });
    if (input.status === 'RESOLVED') {
      await this.notifications.notify([c.requesterUserId], { groupId: c.groupId, type: 'SUPPORT', title: `${c.number} resolved`, body: 'ChamaHub Support marked your request as resolved. Reply if you still need help.', data: { supportCaseId: id } });
    }
    return this.detail(staff, id, meta);
  }

  async escalate(staff: StaffContext, id: string, input: { reason: string; priority?: SupportPriority }, meta: RequestMeta) {
    const c = await this.workable(staff, id);
    if (CLOSED.includes(c.status)) throw new BadRequestException('Reopen the case before escalating it.');
    await this.prisma.supportCase.update({ where: { id }, data: { status: 'ESCALATED', escalationReason: input.reason, escalatedAt: new Date(), priority: input.priority ?? (c.priority === 'URGENT' ? 'URGENT' : 'HIGH') } });
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: 'platform.support_escalated', targetType: 'SupportCase', targetId: id, reason: input.reason, before: { status: c.status, priority: c.priority }, after: { status: 'ESCALATED', priority: input.priority ?? null }, meta });
    return this.detail(staff, id, meta);
  }

  async setPriority(staff: StaffContext, id: string, priority: SupportPriority, meta: RequestMeta) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Support case not found');
    await this.prisma.supportCase.update({ where: { id }, data: { priority } });
    await this.staffAudit.log({ actorAccountId: staff.accountId, action: 'platform.support_priority_changed', targetType: 'SupportCase', targetId: id, before: { priority: c.priority }, after: { priority }, meta });
    return this.detail(staff, id, meta);
  }

  /** Staff who can take cases, with their current open workload (for the assign menu). */
  async assignees() {
    const rows = await this.prisma.platformAccount.findMany({
      where: { status: 'ACTIVE', OR: [{ roles: { some: { role: { permissions: { some: { permission: 'platform.support' } } } } } }, { permissions: { some: { permission: 'platform.support' } } }] },
      select: { id: true, fullName: true, _count: { select: { assignedCases: { where: { status: { notIn: CLOSED } } } } } },
      orderBy: { fullName: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.fullName, openCases: r._count.assignedCases }));
  }

  private async staffNames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = unique.length ? await this.prisma.platformAccount.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } }) : [];
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

function toRow(c: SupportCase & { requester: { fullName: string }; group: { name: string } | null; assignedTo: { id: string; fullName: string } | null }): SupportCaseRow {
  return {
    id: c.id,
    number: c.number,
    subject: c.subject,
    category: c.category,
    priority: c.priority,
    status: c.status,
    requesterName: c.requester.fullName,
    groupName: c.group?.name ?? null,
    assignedTo: c.assignedTo ? { id: c.assignedTo.id, name: c.assignedTo.fullName } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    firstResponseAt: c.firstResponseAt?.toISOString() ?? null,
  };
}
