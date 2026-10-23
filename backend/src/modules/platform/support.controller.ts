import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  createSupportCaseSchema,
  paginationSchema,
  PlatformPermission,
  staffReplySchema,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportAssignSchema,
  supportEscalateSchema,
  supportMessageSchema,
  supportNoteSchema,
  supportPrioritySchema,
  supportStatusSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AllowUnverified, CurrentStaff, CurrentUser, PlatformApi, ReqMeta, RequirePlatform } from '../../common/decorators';
import { AuthContext, RequestMeta, StaffContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { SupportService } from './support.service';

const PP = PlatformPermission;

/** The member side: anyone signed in to ChamaHub can ask for help and follow their own cases (even before verifying their phone). */
@AllowUnverified()
@Controller('me/support-cases')
export class MySupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.support.myCases(user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  open(@Body(new ZodPipe(createSupportCaseSchema)) body: z.infer<typeof createSupportCaseSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.support.open(user.id, body, meta);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.support.mine(user.id, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/messages')
  reply(@Param('id') id: string, @Body(new ZodPipe(supportMessageSchema)) body: z.infer<typeof supportMessageSchema>, @CurrentUser() user: AuthContext) {
    return this.support.memberReply(user.id, id, body.body);
  }

  @HttpCode(200)
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.support.memberClose(user.id, id);
  }
}

const caseQuery = paginationSchema.extend({
  status: z.enum(SUPPORT_STATUSES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  q: z.string().trim().max(80).optional(),
  scope: z.enum(['mine', 'unassigned', 'all']).optional(),
});

/** The staff side. Helpers work the cases assigned to them; support managers see and route all of them. */
@PlatformApi()
@Controller('platform/support')
export class StaffSupportController {
  constructor(private readonly support: SupportService) {}

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @Get('cases')
  list(@Query(new ZodPipe(caseQuery)) q: z.infer<typeof caseQuery>, @CurrentStaff() staff: StaffContext) {
    return this.support.list(staff, q);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT_MANAGE)
  @Get('assignees')
  assignees() {
    return this.support.assignees();
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @Get('cases/:id')
  get(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.detail(staff, id, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @Post('cases/:id/reply')
  reply(@Param('id') id: string, @Body(new ZodPipe(staffReplySchema)) body: z.infer<typeof staffReplySchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.reply(staff, id, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @Post('cases/:id/notes')
  note(@Param('id') id: string, @Body(new ZodPipe(supportNoteSchema)) body: z.infer<typeof supportNoteSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.note(staff, id, body.body, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @HttpCode(200)
  @Post('cases/:id/status')
  status(@Param('id') id: string, @Body(new ZodPipe(supportStatusSchema)) body: z.infer<typeof supportStatusSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.setStatus(staff, id, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT)
  @HttpCode(200)
  @Post('cases/:id/escalate')
  escalate(@Param('id') id: string, @Body(new ZodPipe(supportEscalateSchema)) body: z.infer<typeof supportEscalateSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.escalate(staff, id, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT_MANAGE)
  @HttpCode(200)
  @Post('cases/:id/assign')
  assign(@Param('id') id: string, @Body(new ZodPipe(supportAssignSchema)) body: z.infer<typeof supportAssignSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.assign(staff, id, body.accountId, meta);
  }

  @RequirePlatform(PP.PLATFORM_SUPPORT_MANAGE)
  @HttpCode(200)
  @Post('cases/:id/priority')
  priority(@Param('id') id: string, @Body(new ZodPipe(supportPrioritySchema)) body: z.infer<typeof supportPrioritySchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.support.setPriority(staff, id, body.priority, meta);
  }
}
