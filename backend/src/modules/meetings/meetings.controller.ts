import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { actionItemSchema, announcementSchema, attendanceRegisterSchema, createMeetingSchema, minutesSchema, Permission, resolutionSchema, rsvpSchema, updateActionItemSchema, updateMeetingSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, CurrentUser, ReqMeta, RequirePermission } from '../../common/decorators';
import { AuthContext, MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { MeetingsService } from './meetings.service';

@Controller('groups/:groupId')
export class MeetingsController {
  constructor(private readonly svc: MeetingsService) {}

  @RequirePermission(Permission.MEETINGS_VIEW)
  @Get('meetings')
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query('scope') scope?: 'upcoming' | 'past' | 'all') {
    return this.svc.list(groupId, m, scope ?? 'all');
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Post('meetings')
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createMeetingSchema)) body: z.infer<typeof createMeetingSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.create(groupId, body, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_VIEW)
  @Get('meetings/:id')
  detail(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext) {
    return this.svc.detail(groupId, id, m);
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Patch('meetings/:id')
  update(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(updateMeetingSchema)) body: z.infer<typeof updateMeetingSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.update(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_VIEW)
  @Put('meetings/:id/rsvp')
  rsvp(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(rsvpSchema)) body: z.infer<typeof rsvpSchema>, @CurrentMembership() m: MembershipContext) {
    return this.svc.rsvp(groupId, id, body.status, m);
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Put('meetings/:id/attendance')
  register(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(attendanceRegisterSchema)) body: z.infer<typeof attendanceRegisterSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.register(groupId, id, body.entries, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Put('meetings/:id/minutes')
  minutes(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(minutesSchema)) body: z.infer<typeof minutesSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.saveMinutes(groupId, id, body.body, m, meta);
  }

  @RequirePermission(Permission.MINUTES_APPROVE)
  @Post('meetings/:id/minutes/approve')
  approve(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.approveMinutes(groupId, id, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Post('meetings/:id/resolutions')
  resolution(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(resolutionSchema)) body: z.infer<typeof resolutionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.addResolution(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_MANAGE)
  @Post('meetings/:id/actions')
  action(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(actionItemSchema)) body: z.infer<typeof actionItemSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.addAction(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.MEETINGS_VIEW)
  @Patch('meetings/:id/actions/:actionId')
  toggle(@Param('groupId') groupId: string, @Param('id') id: string, @Param('actionId') actionId: string, @Body(new ZodPipe(updateActionItemSchema)) body: z.infer<typeof updateActionItemSchema>, @CurrentMembership() m: MembershipContext) {
    return this.svc.toggleAction(groupId, id, actionId, body.done, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('announcements')
  announcements(@Param('groupId') groupId: string) {
    return this.svc.announcements(groupId);
  }

  @RequirePermission(Permission.ANNOUNCEMENTS_SEND)
  @Post('announcements')
  announce(@Param('groupId') groupId: string, @Body(new ZodPipe(announcementSchema)) body: z.infer<typeof announcementSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.announce(groupId, body, m, meta);
  }
}

@Controller('me')
export class MyMeetingsController {
  constructor(private readonly svc: MeetingsService) {}

  @Get('meetings')
  mine(@CurrentUser() user: AuthContext) {
    return this.svc.mine(user.id);
  }

  @Get('actions')
  actions(@CurrentUser() user: AuthContext) {
    return this.svc.myActions(user.id);
  }
}
