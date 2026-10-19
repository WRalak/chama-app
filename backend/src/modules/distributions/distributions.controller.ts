import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { approvalDecisionSchema, createDistributionSchema, distributionPreviewSchema, markPaidSchema, Permission, reasonSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { DistributionsService } from './distributions.service';

const reasonBody = z.object({ reason: reasonSchema });

@Controller('groups/:groupId/distributions')
export class DistributionsController {
  constructor(private readonly svc: DistributionsService) {}

  @RequirePermission(Permission.REPORTS_VIEW)
  @Get()
  list(@Param('groupId') groupId: string) {
    return this.svc.list(groupId);
  }

  @RequirePermission(Permission.DISTRIBUTIONS_MANAGE)
  @HttpCode(200)
  @Post('preview')
  preview(@Param('groupId') groupId: string, @Body(new ZodPipe(distributionPreviewSchema)) body: z.infer<typeof distributionPreviewSchema>) {
    return this.svc.preview(groupId, body);
  }

  @RequirePermission(Permission.DISTRIBUTIONS_MANAGE)
  @Post()
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createDistributionSchema)) body: z.infer<typeof createDistributionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.create(groupId, body, m, meta);
  }

  @RequirePermission(Permission.REPORTS_VIEW)
  @Get(':id')
  detail(@Param('groupId') groupId: string, @Param('id') id: string) {
    return this.svc.detail(groupId, id);
  }

  @RequirePermission(Permission.DISTRIBUTIONS_APPROVE)
  @HttpCode(200)
  @Post(':id/decision')
  decide(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.decide(groupId, id, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.DISTRIBUTIONS_MANAGE)
  @HttpCode(200)
  @Post(':id/allocations/:allocationId/pay')
  pay(@Param('groupId') groupId: string, @Param('id') id: string, @Param('allocationId') allocationId: string, @Body(new ZodPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.payAllocation(groupId, id, allocationId, body, m, meta);
  }

  @RequirePermission(Permission.DISTRIBUTIONS_MANAGE)
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: z.infer<typeof reasonBody>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.cancel(groupId, id, body.reason, m, meta);
  }
}
