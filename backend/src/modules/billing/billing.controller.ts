import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { cancelSubscriptionSchema, changePlanSchema, checkoutSchema, normalizeKenyanPhone, Permission } from '@chamahub/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentMembership, CurrentUser, Public, ReqMeta, RequirePermission } from '../../common/decorators';
import { AuthContext, MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { BillingService } from './billing.service';

/**
 * A group's ChamaHub plan. Every member can see which plan the group is on and what it includes;
 * choosing, paying for and cancelling it, and billing history, need billing.manage
 * (chairperson and treasurer by default). This never touches the group's own money.
 */
@Controller('groups/:groupId/billing')
export class GroupBillingController {
  constructor(private readonly billing: BillingService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get()
  summary(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.billing.summary(groupId, m.permissions.includes(Permission.BILLING_MANAGE) && !m.supportGrantId);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('plans')
  plans(@Param('groupId') groupId: string) {
    return this.billing.catalogue(groupId);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('checkout')
  checkout(@Param('groupId') groupId: string, @Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.billing.checkout(groupId, { ...body, phone: body.phone ? (normalizeKenyanPhone(body.phone) ?? body.phone) : undefined }, user.id, meta);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @Get('payments')
  payments(@Param('groupId') groupId: string) {
    return this.billing.payments(groupId);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @Get('payments/:paymentId')
  payment(@Param('groupId') groupId: string, @Param('paymentId') id: string) {
    return this.billing.payment(groupId, id);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @Get('payments/:paymentId/receipt')
  receipt(@Param('groupId') groupId: string, @Param('paymentId') id: string) {
    return this.billing.receipt(groupId, id);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @HttpCode(200)
  @Post('change-plan')
  change(@Param('groupId') groupId: string, @Body(new ZodPipe(changePlanSchema)) body: z.infer<typeof changePlanSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.billing.changePlan(groupId, body, user.id, meta);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @HttpCode(200)
  @Post('cancel')
  cancel(@Param('groupId') groupId: string, @Body(new ZodPipe(cancelSubscriptionSchema)) body: z.infer<typeof cancelSubscriptionSchema>, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.billing.cancel(groupId, body, user.id, meta);
  }

  @RequirePermission(Permission.BILLING_MANAGE)
  @HttpCode(200)
  @Post('resume')
  resume(@Param('groupId') groupId: string, @CurrentUser() user: AuthContext, @ReqMeta() meta: RequestMeta) {
    return this.billing.resume(groupId, user.id, meta);
  }

  /** Development and test only (404 in production): completes a sandbox payment through its signed webhook. */
  @RequirePermission(Permission.BILLING_MANAGE)
  @HttpCode(200)
  @Post('payments/:paymentId/simulate')
  simulate(@Param('groupId') groupId: string, @Param('paymentId') id: string, @Body(new ZodPipe(z.object({ outcome: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']) }))) body: { outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' }) {
    return this.billing.simulateSandbox(groupId, id, body.outcome);
  }
}

/** Provider callbacks. Public, but each provider proves authenticity (signature or secret token). */
@Controller('billing/webhooks')
export class BillingWebhooksController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':provider')
  receive(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.billing.handleWebhook(provider.toUpperCase(), { rawBody, headers: req.headers, query: req.query as Record<string, unknown> });
  }
}
