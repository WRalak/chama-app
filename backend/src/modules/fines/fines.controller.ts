import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { issueFineSchema, Permission, waiveFineSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { FinesService } from './fines.service';

@Controller('groups/:groupId/fines')
export class FinesController {
  constructor(private readonly fines: FinesService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get()
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query('status') status?: string) {
    return this.fines.list(groupId, m, status);
  }

  @RequirePermission(Permission.FINES_MANAGE)
  @Post()
  issue(@Param('groupId') groupId: string, @Body(new ZodPipe(issueFineSchema)) body: z.infer<typeof issueFineSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.fines.issue(groupId, body, m, meta);
  }

  @RequirePermission(Permission.FINES_MANAGE)
  @HttpCode(200)
  @Post(':fineId/waive')
  waive(@Param('groupId') groupId: string, @Param('fineId') id: string, @Body(new ZodPipe(waiveFineSchema)) body: z.infer<typeof waiveFineSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.fines.waive(groupId, id, body.reason, m, meta);
  }
}
