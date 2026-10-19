import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { approvalDecisionSchema, createExpenseSchema, markPaidSchema, Permission, reversePaymentSchema } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { ExpensesService } from './expenses.service';

@Controller('groups/:groupId/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @RequirePermission(Permission.EXPENSES_VIEW)
  @Get()
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query('status') status?: string) {
    return this.expenses.list(groupId, m, status);
  }

  @RequirePermission(Permission.EXPENSES_RECORD)
  @Post()
  create(@Param('groupId') groupId: string, @Body(new ZodPipe(createExpenseSchema)) body: z.infer<typeof createExpenseSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.expenses.create(groupId, body, m, meta);
  }

  @RequirePermission(Permission.EXPENSES_APPROVE)
  @HttpCode(200)
  @Post(':expenseId/decision')
  decide(@Param('groupId') groupId: string, @Param('expenseId') id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.expenses.decide(groupId, id, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.EXPENSES_RECORD)
  @HttpCode(200)
  @Post(':expenseId/pay')
  pay(@Param('groupId') groupId: string, @Param('expenseId') id: string, @Body(new ZodPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.expenses.pay(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.LEDGER_ADJUST)
  @HttpCode(200)
  @Post(':expenseId/reverse')
  reverse(@Param('groupId') groupId: string, @Param('expenseId') id: string, @Body(new ZodPipe(reversePaymentSchema)) body: z.infer<typeof reversePaymentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.expenses.reverse(groupId, id, body.reason, m, meta);
  }
}
