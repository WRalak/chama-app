import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import {
  accountDeletionSchema,
  MeResponse,
  notificationPreferencesSchema,
  updateProfileSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { AllowUnverified, CurrentUser, ReqMeta } from '../../common/decorators';
import { AuthContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuthUser } from '../auth/auth.service';
import { readPreferences } from '../notifications/notifications.service';

@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      ...toAuthUser(user),
      preferences: readPreferences(user.preferences),
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    };
  }

  @AllowUnverified()
  @Get()
  get(@CurrentUser() user: AuthContext) {
    return this.me(user.id);
  }

  @AllowUnverified()
  @Patch()
  async update(@CurrentUser() user: AuthContext, @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, email: true } });
    if (body.email) {
      const taken = await this.prisma.user.findFirst({ where: { email: body.email.toLowerCase(), id: { not: user.id } } });
      if (taken) throw new ConflictException('This email is already in use.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { fullName: body.fullName, email: body.email === undefined ? undefined : (body.email?.toLowerCase() ?? null), nationalIdLast4: body.nationalIdLast4 },
    });
    await this.audit.log({ actorUserId: user.id, action: 'user.profile_updated', entityType: 'User', entityId: user.id, before, after: body, meta });
    return this.me(user.id);
  }

  @Put('preferences')
  async preferences(@CurrentUser() user: AuthContext, @Body(new ZodPipe(notificationPreferencesSchema)) body: z.infer<typeof notificationPreferencesSchema>) {
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: body } });
    return this.me(user.id);
  }

  /**
   * Account deletion is a request, not an immediate erase: group financial
   * records must be preserved, so officers settle obligations and personal
   * data is anonymised after review.
   */
  @HttpCode(200)
  @Post('deletion-request')
  async requestDeletion(@CurrentUser() user: AuthContext, @Body(new ZodPipe(accountDeletionSchema)) body: z.infer<typeof accountDeletionSchema>, @ReqMeta() meta: RequestMeta) {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date(), deletionReason: body.reason ?? null } });
    await this.prisma.supportTicket.create({
      data: { userId: user.id, subject: 'Account deletion request', body: body.reason ?? 'No reason given' },
    });
    await this.audit.log({ actorUserId: user.id, action: 'user.deletion_requested', entityType: 'User', entityId: user.id, reason: body.reason, meta });
    return this.me(user.id);
  }

  @Delete('deletion-request')
  async cancelDeletion(@CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    await this.prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null, deletionReason: null } });
    await this.audit.log({ actorUserId: user.id, action: 'user.deletion_cancelled', entityType: 'User', entityId: user.id, meta });
    return this.me(user.id);
  }

  @Post('support')
  async support(@CurrentUser() user: AuthContext, @Body(new ZodPipe(z.object({ subject: z.string().trim().min(3).max(200), body: z.string().trim().min(5).max(4000), groupId: z.string().optional() }))) body: { subject: string; body: string; groupId?: string }) {
    const t = await this.prisma.supportTicket.create({ data: { userId: user.id, groupId: body.groupId ?? null, subject: body.subject, body: body.body } });
    return { id: t.id, status: t.status };
  }
}
