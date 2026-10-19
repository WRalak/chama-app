import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { approvalDecisionSchema, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';

/** The group side of support access: only the group's leadership can grant it. */
@Controller('groups/:groupId/support-access')
export class GroupSupportGrantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission(Permission.GROUP_CONFIGURE)
  @Get()
  async list(@Param('groupId') groupId: string) {
    const rows = await this.prisma.supportAccessGrant.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.requestedByUserId) } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((g) => ({ id: g.id, requestedBy: name.get(g.requestedByUserId) ?? 'ChamaHub support', purpose: g.purpose, hours: g.hours, status: g.status, expiresAt: g.expiresAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString() }));
  }

  @RequirePermission(Permission.GROUP_CONFIGURE)
  @HttpCode(200)
  @Post(':id/decision')
  async decide(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    const g = await this.prisma.supportAccessGrant.findFirst({ where: { id, groupId, status: 'PENDING' } });
    if (!g) throw new NotFoundException('Pending request not found');
    const approve = body.decision === 'APPROVE';
    await this.prisma.supportAccessGrant.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedByMembershipId: m.id, decidedAt: new Date(), expiresAt: approve ? new Date(Date.now() + g.hours * 3600_000) : null } });
    await this.audit.log({ groupId, actorUserId: m.userId, action: approve ? 'support_access.approved' : 'support_access.rejected', entityType: 'SupportAccessGrant', entityId: id, reason: body.comment, approvalStatus: approve ? 'APPROVED' : 'REJECTED', meta });
    return { ok: true };
  }

  @RequirePermission(Permission.GROUP_CONFIGURE)
  @HttpCode(200)
  @Post(':id/revoke')
  async revoke(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    const r = await this.prisma.supportAccessGrant.updateMany({ where: { id, groupId, status: 'APPROVED' }, data: { status: 'REVOKED', expiresAt: new Date() } });
    if (r.count !== 1) throw new NotFoundException('Active grant not found');
    await this.audit.log({ groupId, actorUserId: m.userId, action: 'support_access.revoked', entityType: 'SupportAccessGrant', entityId: id, meta });
    return { ok: true };
  }
}
