import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { isoDateSchema, loanApplicationSchema, loanDecisionSchema, loanDisburseSchema, Permission, prepareLoanSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { LoansService } from './loans.service';

const quoteQuery = z.object({
  principalCents: z.coerce.number().int().positive(),
  installments: z.coerce.number().int().min(1).max(120),
  firstDueDate: isoDateSchema.optional(),
});
const listQuery = z.object({ status: z.string().optional(), memberId: z.string().optional(), overdue: z.enum(['true', 'false']).optional() });

@Controller('groups/:groupId/loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('quote')
  quote(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query(new ZodPipe(quoteQuery)) q: z.infer<typeof quoteQuery>) {
    return this.loans.quote(groupId, m, q);
  }

  @RequirePermission(Permission.LOANS_APPLY)
  @Post()
  apply(@Param('groupId') groupId: string, @Body(new ZodPipe(loanApplicationSchema)) body: z.infer<typeof loanApplicationSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.loans.apply(groupId, body, m, meta);
  }

  @RequirePermission(Permission.LOANS_PREPARE)
  @Post('prepare')
  prepare(@Param('groupId') groupId: string, @Body(new ZodPipe(prepareLoanSchema)) body: z.infer<typeof prepareLoanSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.loans.prepare(groupId, body, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get()
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.loans.list(groupId, m, { ...q, overdue: q.overdue === 'true' });
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get(':loanId')
  detail(@Param('groupId') groupId: string, @Param('loanId') id: string, @CurrentMembership() m: MembershipContext) {
    return this.loans.detail(groupId, id, m);
  }

  @RequirePermission(Permission.LOANS_APPROVE)
  @HttpCode(200)
  @Post(':loanId/decision')
  decide(@Param('groupId') groupId: string, @Param('loanId') id: string, @Body(new ZodPipe(loanDecisionSchema)) body: z.infer<typeof loanDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.loans.decide(groupId, id, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.LOANS_DISBURSE)
  @HttpCode(200)
  @Post(':loanId/disburse')
  disburse(@Param('groupId') groupId: string, @Param('loanId') id: string, @Body(new ZodPipe(loanDisburseSchema)) body: z.infer<typeof loanDisburseSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.loans.disburse(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @HttpCode(200)
  @Post(':loanId/cancel')
  cancel(@Param('groupId') groupId: string, @Param('loanId') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.loans.cancel(groupId, id, m, meta);
  }
}
