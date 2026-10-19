import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, UnprocessableEntityException } from '@nestjs/common';
import { disputeSchema, Permission, resolveDisputeSchema } from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { isoDate } from '../../common/dates';
import { big, n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const holdingSchema = z.object({ name: z.string().trim().min(2).max(120), kind: z.string().trim().min(2).max(60), costCents: z.number().int().min(0), currentValueCents: z.number().int().min(0), acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(1000).optional() });

@Controller('groups/:groupId')
export class DisputesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('disputes')
  async list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    const all = m.permissions.includes(Permission.CONTRIBUTIONS_VERIFY);
    const rows = await this.prisma.dispute.findMany({ where: { groupId, ...(all ? {} : { membershipId: m.id }) }, include: { membership: { select: { user: { select: { fullName: true } } } }, payment: { select: { amountCents: true, reference: true, status: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((d) => ({ id: d.id, memberName: d.membership.user.fullName, paymentId: d.paymentId, payment: d.payment ? { amountCents: n(d.payment.amountCents), reference: d.payment.reference, status: d.payment.status } : null, subject: d.subject, details: d.details, status: d.status, resolution: d.resolution, createdAt: d.createdAt.toISOString(), resolvedAt: d.resolvedAt?.toISOString() ?? null }));
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Post('disputes')
  async create(@Param('groupId') groupId: string, @Body(new ZodPipe(disputeSchema)) body: z.infer<typeof disputeSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    if (!m.id) throw new ForbiddenException('Only members can raise disputes');
    if (body.paymentId) {
      const p = await this.prisma.payment.findFirst({ where: { id: body.paymentId, groupId, membershipId: m.id } });
      if (!p) throw new NotFoundException('Payment not found');
      // A pending payment under dispute is frozen until officers resolve it.
      if (p.status === 'PENDING') await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'DISPUTED' } });
    }
    const d = await this.prisma.dispute.create({ data: { groupId, membershipId: m.id, paymentId: body.paymentId ?? null, subject: body.subject, details: body.details } });
    await this.audit.log({ groupId, actorUserId: m.userId, action: 'dispute.opened', entityType: 'Dispute', entityId: d.id, after: body, meta });
    const officers = (await this.notifications.groupUserIds(groupId, ['CHAIRPERSON', 'TREASURER'])).filter((u) => u !== m.userId);
    await this.notifications.notify(officers, { groupId, type: 'APPROVAL_REQUIRED', title: 'New dispute', body: body.subject });
    return { id: d.id };
  }

  @RequirePermission(Permission.CONTRIBUTIONS_VERIFY)
  @HttpCode(200)
  @Post('disputes/:id/resolve')
  async resolve(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(resolveDisputeSchema)) body: z.infer<typeof resolveDisputeSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    const d = await this.prisma.dispute.findFirst({ where: { id, groupId, status: 'OPEN' } });
    if (!d) throw new NotFoundException('Open dispute not found');
    if (d.membershipId === m.id) throw new ForbiddenException('You cannot resolve your own dispute');
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({ where: { id }, data: { status: body.status, resolution: body.resolution, resolvedById: m.userId, resolvedAt: new Date() } });
      // Unfreeze a disputed pending payment so it can be verified or failed normally.
      if (d.paymentId) await tx.payment.updateMany({ where: { id: d.paymentId, status: 'DISPUTED' }, data: { status: 'PENDING' } });
      await this.audit.log({ groupId, actorUserId: m.userId, action: 'dispute.resolved', entityType: 'Dispute', entityId: id, reason: body.resolution, after: { status: body.status }, meta }, tx);
    });
    const member = await this.prisma.membership.findUniqueOrThrow({ where: { id: d.membershipId }, select: { userId: true } });
    await this.notifications.notify([member.userId], { groupId, type: 'ANNOUNCEMENT', title: 'Dispute updated', body: `${d.subject}: ${body.resolution}` });
    return { ok: true };
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('holdings')
  async holdings(@Param('groupId') groupId: string) {
    const rows = await this.prisma.investmentHolding.findMany({ where: { groupId }, orderBy: { acquiredOn: 'desc' } });
    return rows.map((h) => ({ id: h.id, name: h.name, kind: h.kind, costCents: n(h.costCents), currentValueCents: n(h.currentValueCents), acquiredOn: isoDate(h.acquiredOn), notes: h.notes }));
  }

  @RequirePermission(Permission.DISTRIBUTIONS_MANAGE)
  @Post('holdings')
  async addHolding(@Param('groupId') groupId: string, @Body(new ZodPipe(holdingSchema)) body: z.infer<typeof holdingSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    if (body.acquiredOn > new Date().toISOString().slice(0, 10)) throw new UnprocessableEntityException('Acquisition date cannot be in the future');
    const h = await this.prisma.investmentHolding.create({ data: { groupId, name: body.name, kind: body.kind, costCents: big(body.costCents), currentValueCents: big(body.currentValueCents), acquiredOn: new Date(`${body.acquiredOn}T00:00:00Z`), notes: body.notes ?? null } });
    await this.audit.log({ groupId, actorUserId: m.userId, action: 'holding.added', entityType: 'InvestmentHolding', entityId: h.id, after: body, meta });
    return { id: h.id };
  }
}
