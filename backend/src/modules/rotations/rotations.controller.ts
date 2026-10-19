import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  approvalDecisionSchema,
  approvePayoutSchema,
  confirmPayoutSchema,
  createCycleSchema,
  disbursePayoutSchema,
  failPayoutSchema,
  payoutProblemSchema,
  Permission,
  preparePayoutSchema,
  reorderCycleSchema,
  rotationAmendmentSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { RotationsService } from './rotations.service';

const reasonBody = z.object({ reason: z.string().trim().min(5).max(500) });

/**
 * Merry-go-round rotations. Every route is scoped to the caller's membership
 * of :groupId; the service adds maker-checker rules (the drafter, preparer,
 * sender and recipient can never approve or confirm their own step).
 */
@Controller('groups/:groupId/rotations')
export class RotationsController {
  constructor(private readonly rotations: RotationsService) {}

  @RequirePermission(Permission.ROTATIONS_VIEW)
  @Get()
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.rotations.list(groupId, m);
  }

  /** Drafts a schedule. It generates no contributions until approved. */
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
  @Post(':cycleId/activation')
  activation(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.decideActivation(groupId, cycleId, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/cancel')
  cancel(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Body(new ZodPipe(reasonBody)) body: z.infer<typeof reasonBody>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.cancelDraft(groupId, cycleId, body.reason, m, meta);
  }

  /* ---------- payouts ---------- */

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/prepare')
  prepare(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(preparePayoutSchema)) body: z.infer<typeof preparePayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.prepare(groupId, cycleId, roundId, body, m, meta);
  }

  @RequirePermission(Permission.PAYOUTS_APPROVE)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/approve')
  approve(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(approvePayoutSchema)) body: z.infer<typeof approvePayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.decidePayout(groupId, cycleId, roundId, body, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/disburse')
  disburse(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(disbursePayoutSchema)) body: z.infer<typeof disbursePayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.disburse(groupId, cycleId, roundId, body, m, meta);
  }

  /** Recipient confirms receipt, or another officer verifies the reference. Checked in the service. */
  @RequirePermission(Permission.ROTATIONS_VIEW)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/confirm')
  confirm(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(confirmPayoutSchema)) body: z.infer<typeof confirmPayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.confirm(groupId, cycleId, roundId, body, m, meta);
  }

  /** Officers who send or approve payouts (checked in the service). */
  @RequirePermission(Permission.ROTATIONS_VIEW)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/fail')
  fail(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(failPayoutSchema)) body: z.infer<typeof failPayoutSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.fail(groupId, cycleId, roundId, body.reason, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_VIEW)
  @HttpCode(200)
  @Post(':cycleId/rounds/:roundId/problem')
  problem(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('roundId') roundId: string, @Body(new ZodPipe(payoutProblemSchema)) body: z.infer<typeof payoutProblemSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.reportProblem(groupId, cycleId, roundId, body.details, m, meta);
  }

  /* ---------- amendments ---------- */

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @Post(':cycleId/amendments')
  amend(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Body(new ZodPipe(rotationAmendmentSchema)) body: z.infer<typeof rotationAmendmentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.proposeAmendment(groupId, cycleId, body, m, meta);
  }

  /** Back-compat: a plain reorder proposal. */
  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @Post(':cycleId/reorder')
  reorder(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Body(new ZodPipe(reorderCycleSchema)) body: z.infer<typeof reorderCycleSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.proposeReorder(groupId, cycleId, body, m, meta);
  }

  @RequirePermission(Permission.PAYOUTS_APPROVE)
  @HttpCode(200)
  @Post(':cycleId/changes/:changeId/decision')
  decideChange(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @Param('changeId') changeId: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.decideAmendment(groupId, cycleId, changeId, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.ROTATIONS_MANAGE)
  @HttpCode(200)
  @Post(':cycleId/close')
  close(@Param('groupId') groupId: string, @Param('cycleId') cycleId: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.rotations.close(groupId, cycleId, m, meta);
  }
}
