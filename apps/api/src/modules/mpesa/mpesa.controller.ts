import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IntegrationStatus, mpesaStkSchema, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, Public, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { emailConfigured, env, mpesaConfigured, smsConfigured, whatsappConfigured } from '../../config/env';
import { callbackTokenValid, MpesaService } from './mpesa.service';

@Controller()
export class MpesaController {
  constructor(private readonly mpesa: MpesaService) {}

  @Public()
  @Get('integrations/status')
  status(): IntegrationStatus {
    return {
      mpesa: { configured: mpesaConfigured(), environment: mpesaConfigured() ? env().MPESA_ENV : null },
      sms: { configured: smsConfigured(), provider: smsConfigured() ? "Africa's Talking" : 'none' },
      email: { configured: emailConfigured() },
      whatsapp: { configured: whatsappConfigured() },
    };
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Post('groups/:groupId/payments/mpesa/stk')
  stk(@Param('groupId') groupId: string, @Body(new ZodPipe(mpesaStkSchema)) body: z.infer<typeof mpesaStkSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.mpesa.initiate(groupId, body, m, meta);
  }

  /** Safaricom does not sign callbacks: a secret URL token plus IP allow-listing at the edge is required. */
  @Public()
  @HttpCode(200)
  @Post('integrations/mpesa/stk-callback')
  stkCallback(@Query('token') token: string | undefined, @Body() body: unknown) {
    if (!callbackTokenValid(token)) throw new ForbiddenException();
    return this.mpesa.handleStkCallback(body as never);
  }

  @Public()
  @HttpCode(200)
  @Post('integrations/mpesa/c2b/validation')
  c2bValidation(@Query('token') token: string | undefined) {
    if (!callbackTokenValid(token)) throw new ForbiddenException();
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  @Public()
  @HttpCode(200)
  @Post('integrations/mpesa/c2b/confirmation')
  c2bConfirmation(@Query('token') token: string | undefined, @Body() body: unknown) {
    if (!callbackTokenValid(token)) throw new ForbiddenException();
    return this.mpesa.handleC2bConfirmation(body as never);
  }
}
