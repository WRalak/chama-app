import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { createGroupSchema, GroupRole, Permission, rolePolicyUpdateSchema, updateGroupSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, CurrentUser, ReqMeta, RequirePermission } from '../../common/decorators';
import { AuthContext, MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { GroupsService } from './groups.service';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  async create(@CurrentUser() user: AuthContext, @Body(new ZodPipe(createGroupSchema)) body: z.infer<typeof createGroupSchema>, @ReqMeta() meta: RequestMeta) {
    const g = await this.groups.create(user.id, body, meta);
    return { id: g.id, name: g.name };
  }

  @Get()
  mine(@CurrentUser() user: AuthContext) {
    return this.groups.mine(user.id);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get(':groupId')
  detail(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.groups.detail(groupId, m);
  }

  @RequirePermission(Permission.GROUP_CONFIGURE)
  @Patch(':groupId')
  async update(
    @Param('groupId') groupId: string,
    @Body(new ZodPipe(updateGroupSchema)) body: z.infer<typeof updateGroupSchema>,
    @CurrentUser() user: AuthContext,
    @CurrentMembership() m: MembershipContext,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.groups.update(groupId, body, user.id, meta);
    return this.groups.detail(groupId, m);
  }

  @RequirePermission(Permission.PERMISSIONS_CONFIGURE)
  @Put(':groupId/role-policy')
  rolePolicy(@Param('groupId') groupId: string, @Body(new ZodPipe(rolePolicyUpdateSchema)) body: z.infer<typeof rolePolicyUpdateSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.groups.updateRolePolicy(groupId, body.role as GroupRole, body.permissions as never, body.reason, m, meta);
  }

  @RequirePermission(Permission.MEMBERS_INVITE)
  @Post(':groupId/invite-code')
  rotate(@Param('groupId') groupId: string, @Query('disable') disable: string | undefined, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.groups.rotateInviteCode(groupId, disable === 'true', user.id, meta);
  }

  @RequirePermission(Permission.REPORTS_VIEW)
  @Get(':groupId/overview')
  overview(@Param('groupId') groupId: string) {
    return this.groups.overview(groupId);
  }
}
