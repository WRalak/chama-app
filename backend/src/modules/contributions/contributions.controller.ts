import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  centsToDecimalString,
  createScheduleSchema,
  matchUnmatchedSchema,
  paginationSchema,
  paymentFilterSchema,
  Permission,
  reasonSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  verifyPaymentSchema,
  isoDateSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { toCsv } from '../../common/csv';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { ContributionsService } from './contributions.service';

const ledgerQuery = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  memberId: z.string().optional(),
  scheduleId: z.string().optional(),
  status: z.enum(['UPCOMING', 'DUE', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED', 'OUTSTANDING']).optional(),
});
const rangeQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
const reasonBody = z.object({ reason: reasonSchema });

@Controller('groups/:groupId')
export class ContributionsController {
  constructor(private readonly svc: ContributionsService) {}

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('schedules')
  schedules(@Param('groupId') groupId: string) {
    return this.svc.schedules(groupId);
  }

  @RequirePermission(Permission.SCHEDULES_MANAGE)
  @Post('schedules')
  createSchedule(@Param('groupId') groupId: string, @Body(new ZodPipe(createScheduleSchema)) body: z.infer<typeof createScheduleSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.createSchedule(groupId, body, m, meta);
  }

  @RequirePermission(Permission.SCHEDULES_MANAGE)
  @HttpCode(200)
  @Post('schedules/:scheduleId/deactivate')
  deactivate(@Param('groupId') groupId: string, @Param('scheduleId') id: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.deactivateSchedule(groupId, id, m, meta);
  }

  /** Recording requires an officer permission; the exact one is checked per purpose. */
  @RequirePermission(Permission.GROUP_VIEW)
  @Post('payments')
  record(@Param('groupId') groupId: string, @Body(new ZodPipe(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.record(groupId, body, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('payments')
  list(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query(new ZodPipe(paymentFilterSchema)) q: z.infer<typeof paymentFilterSchema>) {
    return this.svc.list(groupId, m, q);
  }

  @RequirePermission(Permission.CONTRIBUTIONS_VERIFY)
  @HttpCode(200)
  @Post('payments/:paymentId/verify')
  verify(@Param('groupId') groupId: string, @Param('paymentId') id: string, @Body(new ZodPipe(verifyPaymentSchema)) body: z.infer<typeof verifyPaymentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.verify(groupId, id, body.decision, body.note, m, meta);
  }

  @RequirePermission(Permission.LEDGER_ADJUST)
  @HttpCode(200)
  @Post('payments/:paymentId/reverse')
  reverse(@Param('groupId') groupId: string, @Param('paymentId') id: string, @Body(new ZodPipe(reversePaymentSchema)) body: z.infer<typeof reversePaymentSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.reverse(groupId, id, body.reason, m, meta);
  }

  @RequirePermission(Permission.LEDGER_ADJUST)
  @HttpCode(200)
  @Post('obligations/:obligationId/waive')
  waive(@Param('groupId') groupId: string, @Param('obligationId') id: string, @Body(new ZodPipe(reasonBody)) body: z.infer<typeof reasonBody>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.waive(groupId, id, body.reason, m, meta);
  }

  @RequirePermission(Permission.CONTRIBUTIONS_VIEW_ALL)
  @Get('contributions/ledger')
  ledger(@Param('groupId') groupId: string, @Query(new ZodPipe(ledgerQuery)) q: z.infer<typeof ledgerQuery>) {
    return this.svc.ledger(groupId, q);
  }

  @RequirePermission(Permission.CONTRIBUTIONS_VIEW_ALL)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contributions-ledger.csv"')
  @Get('contributions/ledger.csv')
  async ledgerCsv(@Param('groupId') groupId: string, @Query(new ZodPipe(ledgerQuery)) q: z.infer<typeof ledgerQuery>) {
    const page = await this.svc.ledger(groupId, { ...q, page: 1, pageSize: 100000 });
    return toCsv(
      ['Due date', 'Member', 'Period', 'Expected (KSh)', 'Received (KSh)', 'Pending (KSh)', 'Outstanding (KSh)', 'Status', 'Methods', 'References', 'Recorded by'],
      page.items.map((r) => [
        r.dueDate,
        r.memberName,
        r.period,
        centsToDecimalString(r.expectedCents),
        centsToDecimalString(r.receivedCents),
        centsToDecimalString(r.pendingCents),
        centsToDecimalString(r.outstandingCents),
        r.status,
        [...new Set(r.payments.map((p) => p.method))].join(' / '),
        r.payments.map((p) => p.reference).filter(Boolean).join(' / '),
        [...new Set(r.payments.map((p) => p.recordedByName).filter(Boolean))].join(' / '),
      ]),
    );
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @Get('reconciliation')
  reconciliation(@Param('groupId') groupId: string, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.svc.reconciliation(groupId, q);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('unmatched/:id/match')
  match(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(matchUnmatchedSchema)) body: z.infer<typeof matchUnmatchedSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.matchUnmatched(groupId, id, body, m, meta);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('unmatched/:id/ignore')
  ignore(@Param('groupId') groupId: string, @Param('id') id: string, @Body(new ZodPipe(reasonBody)) body: z.infer<typeof reasonBody>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.ignoreUnmatched(groupId, id, body.reason, m, meta);
  }
}
