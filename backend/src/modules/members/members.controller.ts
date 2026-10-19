import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  acceptInviteCodeSchema,
  changeMemberStatusSchema,
  changeRoleSchema,
  createInvitationSchema,
  Permission,
  reasonSchema,
  respondInvitationSchema,
  specialRolesSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, CurrentUser, ReqMeta, RequirePermission } from '../../common/decorators';
import { AuthContext, MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { MembersService } from './members.service';

const sharesSchema = z.object({ shares: z.number().int().min(0).max(1_000_000), reason: reasonSchema });

@Controller('groups/:groupId')
export class GroupMembersController {
  constructor(private readonly members: MembersService) {}

  @RequirePermission(Permission.MEMBERS_VIEW)
  @Get('members')
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query('status') status?: string, @Query('q') q?: string) {
    return this.members.list(groupId, m, { status, q });
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('members/:membershipId')
  profile(@Param('groupId') groupId: string, @Param('membershipId') id: string, @CurrentMembership() m: MembershipContext) {
    return this.members.profile(groupId, id === 'me' ? m.id : id, m);
  }

  @RequirePermission(Permission.ROLES_ASSIGN)
  @Patch('members/:membershipId/role')
  role(@Param('groupId') groupId: string, @Param('membershipId') id: string, @Body(new ZodPipe(changeRoleSchema)) body: z.infer<typeof changeRoleSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.changeRole(groupId, id, body.role, body.reason, m, meta);
  }

  @RequirePermission(Permission.MEMBERS_MANAGE)
  @Patch('members/:membershipId/status')
  status(@Param('groupId') groupId: string, @Param('membershipId') id: string, @Body(new ZodPipe(changeMemberStatusSchema)) body: z.infer<typeof changeMemberStatusSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.changeStatus(groupId, id, body.status, body.reason, m, meta);
  }

  @RequirePermission(Permission.ROLES_ASSIGN)
  @Put('members/:membershipId/special-roles')
  specialRoles(@Param('groupId') groupId: string, @Param('membershipId') id: string, @Body(new ZodPipe(specialRolesSchema)) body: z.infer<typeof specialRolesSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.setSpecialRoles(groupId, id, body.specialRoles, body.reason, m, meta);
  }

  @RequirePermission(Permission.MEMBERS_MANAGE)
  @Put('members/:membershipId/shares')
  shares(@Param('groupId') groupId: string, @Param('membershipId') id: string, @Body(new ZodPipe(sharesSchema)) body: z.infer<typeof sharesSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.setShares(groupId, id, body.shares, body.reason, m, meta);
  }

  @RequirePermission(Permission.MEMBERS_INVITE)
  @Get('invitations')
  invitations(@Param('groupId') groupId: string) {
    return this.members.groupInvitations(groupId);
  }

  @RequirePermission(Permission.MEMBERS_INVITE)
  @Post('invitations')
  invite(@Param('groupId') groupId: string, @Body(new ZodPipe(createInvitationSchema)) body: z.infer<typeof createInvitationSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.invite(groupId, body, m, meta);
  }

  @RequirePermission(Permission.MEMBERS_INVITE)
  @Delete('invitations/:id')
  revoke(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.members.revokeInvitation(groupId, id, m, meta);
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Get()
  mine(@CurrentUser() user: AuthContext) {
    return this.members.myInvitations(user.id);
  }

  @HttpCode(200)
  @Post(':id/respond')
  respond(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body(new ZodPipe(respondInvitationSchema)) body: z.infer<typeof respondInvitationSchema>, @ReqMeta() meta: RequestMeta) {
    return this.members.respond(user.id, id, body.accept, meta);
  }

  @HttpCode(200)
  @Post('join-code')
  join(@CurrentUser() user: AuthContext, @Body(new ZodPipe(acceptInviteCodeSchema)) body: z.infer<typeof acceptInviteCodeSchema>, @ReqMeta() meta: RequestMeta) {
    return this.members.joinByCode(user.id, body.code, meta);
  }
}
