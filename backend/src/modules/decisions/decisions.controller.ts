import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { castVoteSchema, createFindingSchema, createProposalSchema, Permission, respondFindingSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { DecisionsService } from './decisions.service';

const closeSchema = z.object({ cancel: z.boolean().default(false) });

@Controller('groups/:groupId')
export class DecisionsController {
  constructor(private readonly svc: DecisionsService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('votes')
  votes(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.svc.proposals(groupId, m);
  }

  @RequirePermission(Permission.VOTES_CREATE)
  @Post('votes')
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createProposalSchema)) body: z.infer<typeof createProposalSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.createProposal(groupId, body, m, meta);
  }

  @RequirePermission(Permission.VOTES_CAST)
  @HttpCode(200)
  @Post('votes/:id/ballot')
  cast(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(castVoteSchema)) body: z.infer<typeof castVoteSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.cast(groupId, id, body.choice, m, meta);
  }

  @RequirePermission(Permission.VOTES_CREATE)
  @HttpCode(200)
  @Post('votes/:id/close')
  close(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(closeSchema)) body: z.infer<typeof closeSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.close(groupId, id, body.cancel, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('findings')
  findings(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.svc.findings(groupId, m);
  }

  @RequirePermission(Permission.FINDINGS_RAISE)
  @Post('findings')
  raise(@Param('groupId') groupId: string, @Body(new ZodPipe(createFindingSchema)) body: z.infer<typeof createFindingSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.raiseFinding(groupId, body, m, meta);
  }

  @RequirePermission(Permission.FINDINGS_RESOLVE)
  @HttpCode(200)
  @Post('findings/:id/respond')
  respond(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(respondFindingSchema)) body: z.infer<typeof respondFindingSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.respondFinding(groupId, id, body.status, body.response, m, meta);
  }
}
