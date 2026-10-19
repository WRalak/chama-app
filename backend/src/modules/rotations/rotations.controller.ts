import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { approvalDecisionSchema, approvePayoutSchema, createCycleSchema, markPaidSchema, Permission, reorderCycleSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { RotationsService } from './rotations.service';

@Controller('groups/:groupId/rotations')
export class RotationsController {
  constructor(private readonly rotations: RotationsService) {}

  @RequirePermission(Permission.ROTATIONS_VIEW)
  @Get()
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.rotations.list(groupId, m);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @Post()
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createCycleSchema)) body: z.infer<typeof createCycleSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.create(groupId, body, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_VIEW)
  @Get(':cycleId')
  detail(@Param('groupId') groupId: string, @Param('cycleId') id: string, @CurrentMembership() m: MembershipContext) {
    return this.rotations.detail(groupId, id, m);
  }

  @RequirePermission(Permission.PAYOUTS_APPROVE)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/approve')
  approve(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(approvePayoutSchema)) body: z.infer<typeof approvePayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.approvePayout(groupId, cycleId, roundId, body, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/complete')
  complete(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.completePayout(groupId, cycleId, roundId, body, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @Post(':cycleId/reorder')
  reorder(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Body(new ZodPipe(reorderCycleSchema)) body: z.infer<typeof reorderCycleSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.proposeReorder(groupId, cycleId, body, m, meta);
  }

  @RequirePermission(Permission.PAYOUTS_APPROVE)
  @HttpCode(200)
  @Post(':cycleId/changes/:changeId/decision')
  decideChange(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('changeId') changeId: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.decideReorder(groupId, cycleId, changeId, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/close')
  close(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.close(groupId, cycleId, m, meta);
  }
}
