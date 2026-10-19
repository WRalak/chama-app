import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FineRow, formatKes, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class FinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(groupId: string, viewer: MembershipContext, status?: string): Promise<FineRow[]> {
    const all = viewer.permissions.includes(Permission.FINES_VIEW_ALL);
    const rows = await this.prisma.fine.findMany({
      where: { groupId, ...(all ? {} : { membershipId: viewer.id }), ...(status ? { status: status as never } : {}) },
      include: { membership: { select: { user: { select: { fullName: true } } } } },
      orderBy: { issuedOn: 'desc' },
    });
    const issuers = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.issuedById))] } }, select: { id: true, fullName: true } });
    const name = new Map(issuers.map((u) => [u.id, u.fullName]));
    return rows.map((f) => ({
      id: f.id,
      membershipId: f.membershipId,
      memberName: f.membership.user.fullName,
      amountCents: n(f.amountCents),
      paidCents: n(f.paidCents),
      reason: f.reason,
      issuedOn: isoDate(f.issuedOn),
      status: f.status,
      issuedByName: name.get(f.issuedById) ?? 'System',
      waivedReason: f.waivedReason,
    }));
  }

  async issue(groupId: string, input: { memberId: string; amountCents: number; reason: string; issuedOn: string }, actor: MembershipContext, meta: RequestMeta) {
    const m = await this.prisma.membership.findFirst({ where: { id: input.memberId, groupId, status: { not: 'EXITED' } } });
    if (!m) throw new UnprocessableEntityException('Member not found in this group');
    if (input.issuedOn > today()) throw new UnprocessableEntityException('Fine date cannot be in the future');
    const fine = await this.prisma.$transaction(async (tx) => {
      const f = await tx.fine.create({ data: { groupId, membershipId: m.id, amountCents: big(input.amountCents), reason: input.reason, issuedOn: dbDate(input.issuedOn), issuedById: actor.userId } });
      await this.audit.log({ groupId, actorUserId: actor.userId, action: 'fine.issued', entityType: 'Fine', entityId: f.id, after: input, meta }, tx);
      return f;
    });
    await this.notifications.notify([m.userId], { groupId, type: 'ANNOUNCEMENT', title: 'Fine issued', body: `${formatKes(input.amountCents)}: ${input.reason}` });
    return { id: fine.id };
  }

  async waive(groupId: string, fineId: string, reason: string, actor: MembershipContext, meta: RequestMeta) {
    const f = await this.prisma.fine.findFirst({ where: { id: fineId, groupId } });
    if (!f) throw new NotFoundException('Fine not found');
    if (f.membershipId === actor.id) throw new UnprocessableEntityException('You cannot waive your own fine.');
    if (n(f.paidCents) > 0) throw new UnprocessableEntityException('Partly paid fines cannot be waived; reverse the payment first.');
    const r = await this.prisma.fine.updateMany({ where: { id: f.id, status: 'OUTSTANDING' }, data: { status: 'WAIVED', waivedById: actor.userId, waivedReason: reason } });
    if (r.count !== 1) throw new UnprocessableEntityException('Only outstanding fines can be waived');
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'fine.waived', entityType: 'Fine', entityId: f.id, reason, before: { status: f.status }, after: { status: 'WAIVED' }, meta });
    return { ok: true };
  }
}
