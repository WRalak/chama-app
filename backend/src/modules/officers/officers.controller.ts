import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { acknowledgeHandoverSchema, createHandoverSchema, Permission, sendRemindersSchema, Feature } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission, RequireFeature } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { OfficersService } from './officers.service';

@Controller('groups/:groupId')
export class OfficersController {
  constructor(private readonly officers: OfficersService) {}

  /** Officers and auditors see every handover; others only those they are part of. */
  @RequirePermission(Permission.GROUP_VIEW)
  @Get('handovers')
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.officers.list(groupId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Post('handovers')
  prepare(@Param('groupId') groupId: string, @Body(new ZodPipe(createHandoverSchema)) body: z.infer<typeof createHandoverSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.officers.prepare(groupId, body.role, body.notes, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @HttpCode(200)
  @Post('handovers/:id/acknowledge')
  acknowledge(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(acknowledgeHandoverSchema)) body: z.infer<typeof acknowledgeHandoverSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.officers.acknowledge(groupId, id, body.note, m, meta);
  }

  @RequirePermission(Permission.CONTRIBUTIONS_VIEW_ALL)
  @HttpCode(200)
  @RequireFeature(Feature.CONTRIBUTION_REMINDERS)
  @Post('reminders/contributions')
  remind(@Param('groupId') groupId: string, @Body(new ZodPipe(sendRemindersSchema)) body: z.infer<typeof sendRemindersSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.officers.sendContributionReminders(groupId, body.memberIds, m, meta);
  }
}
