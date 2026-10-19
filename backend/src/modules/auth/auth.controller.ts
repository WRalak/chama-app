import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  requestOtpSchema,
  resetPasswordSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { AllowUnverified, CurrentUser, Public, ReqMeta } from '../../common/decorators';
import { AuthContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';

const codeOnly = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.register(body, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(body, meta);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(body.refreshToken, meta);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('otp/request')
  requestOtp(@Body(new ZodPipe(requestOtpSchema)) body: z.infer<typeof requestOtpSchema>) {
    return this.auth.requestOtp(body.phone, body.purpose);
  }

  @AllowUnverified()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  @Post('otp/resend')
  resend(@CurrentUser() user: AuthContext) {
    return this.auth.requestOtpForUser(user.id);
  }

  @AllowUnverified()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('verify-phone')
  verifyPhone(@CurrentUser() user: AuthContext, @Body(new ZodPipe(codeOnly)) body: z.infer<typeof codeOnly>, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyPhone(user.id, body.code, meta);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('password/reset')
  reset(@Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.resetPassword(body.phone, body.code, body.newPassword, meta);
  }

  @HttpCode(200)
  @Post('password/change')
  change(@CurrentUser() user: AuthContext, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @ReqMeta() meta: RequestMeta) {
    return this.auth.changePassword(user.id, user.sessionId, body.currentPassword, body.newPassword, meta);
  }

  @AllowUnverified()
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: AuthContext) {
    await this.auth.logout(user.sessionId);
    return { ok: true };
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthContext) {
    return this.auth.sessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  revoke(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.auth.revokeSession(user.id, id);
  }

  @HttpCode(200)
  @Post('sessions/revoke-others')
  revokeOthers(@CurrentUser() user: AuthContext) {
    return this.auth.revokeOthers(user.id, user.sessionId);
  }
}
