import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { aiChatSchema, AiChatInput, Permission } from '@chamahub/shared';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { AiService } from './ai.service';

const directSchema = z.object({ args: z.record(z.unknown()).default({}) });

/**
 * The assistant is scoped to the group in the URL, which the access guard
 * has already checked; tools never take a group or user id from the model.
 */
@Controller('groups/:groupId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('status')
  status(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.ai.status(groupId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post('chat')
  chat(@Param('groupId') groupId: string, @Body(new ZodPipe(aiChatSchema)) body: AiChatInput, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.ai.chat(groupId, body, m, meta);
  }

  /** Quick answers: one tool, straight from the records, no AI model. */
  @RequirePermission(Permission.GROUP_VIEW)
  @HttpCode(200)
  @Post('tools/:tool')
  tool(@Param('groupId') groupId: string, @Param('tool') tool: string, @Body(new ZodPipe(directSchema)) body: z.infer<typeof directSchema>, @CurrentMembership() m: MembershipContext) {
    return this.ai.runDirect(groupId, tool, body.args, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('conversations')
  conversations(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.ai.conversations(groupId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('conversations/:id')
  conversation(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext) {
    return this.ai.conversation(groupId, id, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Delete('conversations/:id')
  remove(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext) {
    return this.ai.deleteConversation(groupId, id, m);
  }

  /** Usage and errors for the group's officers who configure it or audit it. */
  @RequirePermission(Permission.GROUP_CONFIGURE)
  @Get('usage')
  usage(@Param('groupId') groupId: string) {
    return this.ai.usage(groupId);
  }
}
