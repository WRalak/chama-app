import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  mfaCodeSchema,
  mfaDisableSchema,
  platformChangePasswordSchema,
  platformForgotSchema,
  platformLoginSchema,
  platformMfaLoginSchema,
  platformReauthSchema,
  platformTokenPasswordSchema,
  refreshSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AllowBeforeMfa, CurrentStaff, PlatformApi, Public, ReqMeta } from '../../common/decorators';
import { RequestMeta, StaffContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PlatformAuthService } from './platform-auth.service';

const tokenQuery = z.object({ token: z.string().min(32).max(200) });

/** Staff sign-in for the platform portal. Every route here is rate limited and audited. */
@PlatformApi()
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(platformLoginSchema)) body: z.infer<typeof platformLoginSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(body.email, body.password, meta);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login/mfa')
  loginMfa(@Body(new ZodPipe(platformMfaLoginSchema)) body: z.infer<typeof platformMfaLoginSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.loginMfa(body.mfaToken, body.code, meta);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @HttpCode(200)
  @AllowBeforeMfa()
  @Post('logout')
  logout(@CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.logout(staff, meta);
  }

  @AllowBeforeMfa()
  @Get('me')
  me(@CurrentStaff() staff: StaffContext) {
    return this.auth.me(staff.accountId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('invitation')
  invitation(@Query(new ZodPipe(tokenQuery)) q: z.infer<typeof tokenQuery>) {
    return this.auth.invitation(q.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('accept-invitation')
  accept(@Body(new ZodPipe(platformTokenPasswordSchema)) body: z.infer<typeof platformTokenPasswordSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.acceptInvitation(body.token, body.password, meta);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgot(@Body(new ZodPipe(platformForgotSchema)) body: z.infer<typeof platformForgotSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.forgotPassword(body.email, meta);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  reset(@Body(new ZodPipe(platformTokenPasswordSchema)) body: z.infer<typeof platformTokenPasswordSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.resetPassword(body.token, body.password, meta);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @AllowBeforeMfa()
  @Post('change-password')
  changePassword(@Body(new ZodPipe(platformChangePasswordSchema)) body: z.infer<typeof platformChangePasswordSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.changePassword(staff, body.currentPassword, body.newPassword, meta);
  }

  @HttpCode(200)
  @AllowBeforeMfa()
  @Post('mfa/setup')
  mfaSetup(@CurrentStaff() staff: StaffContext) {
    return this.auth.mfaSetup(staff);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @AllowBeforeMfa()
  @Post('mfa/enable')
  mfaEnable(@Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.mfaEnable(staff, body.code, meta);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/disable')
  mfaDisable(@Body(new ZodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.mfaDisable(staff, body.password, body.code, meta);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/recovery-codes')
  regenerate(@Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.regenerateRecoveryCodes(staff, body.code, meta);
  }

  @AllowBeforeMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reauth')
  reauth(@Body(new ZodPipe(platformReauthSchema)) body: z.infer<typeof platformReauthSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.reauthenticate(staff, body.password, body.code, meta);
  }

  @Get('sessions')
  sessions(@CurrentStaff() staff: StaffContext) {
    return this.auth.sessions(staff);
  }

  @AllowBeforeMfa()
  @Delete('sessions/:id')
  revoke(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.auth.revokeOwnSession(staff, id, meta);
  }
}
