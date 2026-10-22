import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  approvalDecisionSchema,
  confirmMatchesSchema,
  createDestinationSchema,
  CreateDestinationInput,
  Permission,
  resolveStatementLineSchema,
  ResolveStatementLineInput,
  retireDestinationSchema,
  statementFileSchema,
  StatementFileInput,
  uploadEvidenceSchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, ReqMeta, RequirePermission } from '../../common/decorators';
import { MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { DestinationsService } from './destinations.service';
import { EvidenceService } from './evidence.service';
import { StatementsService } from './statements.service';
import { SummariesService } from './summaries.service';

@Controller('groups/:groupId')
export class CollectionsController {
  constructor(
    private readonly destinations: DestinationsService,
    private readonly evidence: EvidenceService,
    private readonly statements: StatementsService,
    private readonly summaries: SummariesService,
  ) {}

  /* ---------- payment destinations ---------- */

  /** Every member can see where to pay; what else they see is decided by the service. */
  @RequirePermission(Permission.GROUP_VIEW)
  @Get('payment-destinations')
  listDestinations(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.destinations.list(groupId, m);
  }

  @RequirePermission(Permission.DESTINATIONS_MANAGE)
  @Post('payment-destinations')
  propose(@Param('groupId') groupId: string, @Body(new ZodPipe(createDestinationSchema)) body: CreateDestinationInput, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.destinations.propose(groupId, body, m, meta);
  }

  /** Destination managers and payout approvers; the service excludes the proposer. */
  @RequirePermission(Permission.GROUP_VIEW)
  @HttpCode(200)
  @Post('payment-destinations/:destinationId/decision')
  decideDestination(@Param('groupId') groupId: string, @Param('destinationId') id: string, @Body(new ZodPipe(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.destinations.decide(groupId, id, body.decision, body.comment, m, meta);
  }

  @RequirePermission(Permission.DESTINATIONS_MANAGE)
  @HttpCode(200)
  @Post('payment-destinations/:destinationId/retire')
  retire(@Param('groupId') groupId: string, @Param('destinationId') id: string, @Body(new ZodPipe(retireDestinationSchema)) body: { reason: string }, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.destinations.retire(groupId, id, body.reason, m, meta);
  }

  /* ---------- evidence & payment history ---------- */

  @RequirePermission(Permission.GROUP_VIEW)
  @Post('payments/:paymentId/evidence')
  upload(@Param('groupId') groupId: string, @Param('paymentId') paymentId: string, @Body(new ZodPipe(uploadEvidenceSchema)) body: z.infer<typeof uploadEvidenceSchema>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.evidence.upload(groupId, paymentId, body, m, meta);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('payments/:paymentId/history')
  history(@Param('groupId') groupId: string, @Param('paymentId') paymentId: string, @CurrentMembership() m: MembershipContext) {
    return this.evidence.history(groupId, paymentId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('payments/:paymentId/evidence/:evidenceId')
  async file(@Param('groupId') groupId: string, @Param('paymentId') paymentId: string, @Param('evidenceId') evidenceId: string, @CurrentMembership() m: MembershipContext, @Res({ passthrough: true }) res: Response) {
    const ev = await this.evidence.file(groupId, paymentId, evidenceId, m);
    res.setHeader('Content-Type', ev.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${ev.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(Buffer.from(ev.data));
  }

  /* ---------- statements ---------- */

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('statement-imports/preview')
  preview(@Param('groupId') groupId: string, @Body(new ZodPipe(statementFileSchema)) body: StatementFileInput, @CurrentMembership() m: MembershipContext) {
    return this.statements.preview(groupId, body, m);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @Post('statement-imports')
  importStatement(@Param('groupId') groupId: string, @Body(new ZodPipe(statementFileSchema)) body: StatementFileInput, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.statements.create(groupId, body, m, meta);
  }

  /** Reconciliation officers and auditors. */
  @RequirePermission(Permission.GROUP_VIEW)
  @Get('statement-imports')
  listStatements(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.statements.list(groupId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('statement-imports/review-queue')
  queue(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext) {
    return this.statements.reviewQueue(groupId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('statement-imports/:importId/lines')
  lines(@Param('groupId') groupId: string, @Param('importId') importId: string, @CurrentMembership() m: MembershipContext, @Query('state') state?: string, @Query('match') match?: string) {
    return this.statements.lines(groupId, importId, m, { state, match });
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('statement-lines/:lineId/resolve')
  resolve(@Param('groupId') groupId: string, @Param('lineId') lineId: string, @Body(new ZodPipe(resolveStatementLineSchema)) body: ResolveStatementLineInput, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.statements.resolve(groupId, lineId, body, m, meta);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('statement-lines/confirm-matches')
  confirmMatches(@Param('groupId') groupId: string, @Body(new ZodPipe(confirmMatchesSchema)) body: { lineIds: string[] }, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.statements.confirmMatches(groupId, body.lineIds, m, meta);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('statement-imports/:importId/close')
  close(@Param('groupId') groupId: string, @Param('importId') importId: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.statements.setStatus(groupId, importId, 'CLOSED', m, meta);
  }

  @RequirePermission(Permission.RECONCILIATION_MANAGE)
  @HttpCode(200)
  @Post('statement-imports/:importId/discard')
  discard(@Param('groupId') groupId: string, @Param('importId') importId: string, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.statements.setStatus(groupId, importId, 'DISCARDED', m, meta);
  }

  /* ---------- WhatsApp summaries ---------- */

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('share/collections')
  shareCollections(@Param('groupId') groupId: string, @CurrentMembership() m: MembershipContext, @Query('month') month?: string) {
    return this.summaries.collections(groupId, m, month);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('share/receipt/:paymentId')
  shareReceipt(@Param('groupId') groupId: string, @Param('paymentId') paymentId: string, @CurrentMembership() m: MembershipContext) {
    return this.summaries.receipt(groupId, paymentId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('share/payout/:roundId')
  sharePayout(@Param('groupId') groupId: string, @Param('roundId') roundId: string, @CurrentMembership() m: MembershipContext) {
    return this.summaries.payout(groupId, roundId, m);
  }

  @RequirePermission(Permission.GROUP_VIEW)
  @Get('share/how-to-pay')
  shareHowToPay(@Param('groupId') groupId: string) {
    return this.summaries.howToPay(groupId);
  }
}
