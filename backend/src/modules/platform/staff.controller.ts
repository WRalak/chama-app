import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { inviteStaffSchema, paginationSchema, PlatformPermission, platformRoleUpsertSchema, staffAccessSchema, staffReasonSchema, updateStaffSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentStaff, PlatformApi, ReqMeta, RequirePlatform, RequireRecentAuth } from '../../common/decorators';
import { RequestMeta, StaffContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { StaffService } from './staff.service';

const PP = PlatformPermission;
const listQuery = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  role: z.string().trim().max(40).optional(),
  sort: z.enum(['name', 'created', 'lastLogin']).optional(),
});

/** Helpers and other staff: /platform/helpers in the portal. */
@PlatformApi()
@Controller('platform/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.staff.list(q);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @RequireRecentAuth()
  @Post()
  invite(@Body(new ZodPipe(inviteStaffSchema)) body: z.infer<typeof inviteStaffSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.invite(me, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.staff.get(id);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @Get(':id/activity')
  activity(@Param('id') id: string, @Query(new ZodPipe(paginationSchema)) q: z.infer<typeof paginationSchema>) {
    return this.staff.activity(id, q.page, q.pageSize);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @RequireRecentAuth()
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(updateStaffSchema)) body: z.infer<typeof updateStaffSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.update(me, id, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @RequireRecentAuth()
  @Put(':id/access')
  access(@Param('id') id: string, @Body(new ZodPipe(staffAccessSchema)) body: z.infer<typeof staffAccessSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.setAccess(me, id, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.setStatus(me, id, 'SUSPENDED', body.reason, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.setStatus(me, id, 'ACTIVE', body.reason, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.setStatus(me, id, 'DEACTIVATED', body.reason, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @Post(':id/revoke-sessions')
  revokeSessions(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.revokeSessions(me, id, body.reason, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/resend-invite')
  resend(@Param('id') id: string, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.resendInvite(me, id, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/reset-mfa')
  resetMfa(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.resetMfa(me, id, body.reason, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @HttpCode(200)
  @RequireRecentAuth()
  @Post(':id/password-reset')
  passwordReset(@Param('id') id: string, @Body(new ZodPipe(staffReasonSchema)) body: z.infer<typeof staffReasonSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.sendPasswordReset(me, id, body.reason, meta);
  }
}

@PlatformApi()
@Controller('platform/roles')
export class StaffRolesController {
  constructor(private readonly staff: StaffService) {}

  /** Anyone who manages helpers needs to see what each role grants. */
  @RequirePlatform(PP.PLATFORM_MANAGE_HELPERS)
  @Get()
  list() {
    return this.staff.roles();
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_ROLES)
  @RequireRecentAuth()
  @Put()
  upsert(@Body(new ZodPipe(platformRoleUpsertSchema)) body: z.infer<typeof platformRoleUpsertSchema>, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.upsertRole(me, body, meta);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_ROLES)
  @RequireRecentAuth()
  @Delete(':code')
  remove(@Param('code') code: string, @CurrentStaff() me: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.staff.deleteRole(me, code, meta);
  }
}
