import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { addDays, addMonths, dateRangeSchema, isoDateSchema, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { CurrentMembership, CurrentUser, ReqMeta, RequirePermission } from '../../common/decorators';
import { today } from '../../common/dates';
import { AuthContext, MembershipContext, RequestMeta } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { PdfService } from './pdf.service';
import { StatementsService } from './statements.service';
import { AuditedExport } from '../../common/export-audit';

const required = z.object({ from: isoDateSchema, to: isoDateSchema });
function range(q: { from?: string; to?: string }) {
  const to = q.to ?? today();
  return { from: q.from ?? addMonths(addDays(to, 1), -12), to };
}

@Controller('groups/:groupId/statements')
export class GroupStatementsController {
  constructor(
    private readonly svc: StatementsService,
    private readonly pdf: PdfService,
  ) {}

  /** Live statement from the ledger — officers only. Members read published statements. */
  @RequirePermission(Permission.REPORTS_VIEW)
  @Get('live')
  live(@Param('groupId') groupId: string, @Query(new ZodPipe(dateRangeSchema)) q: z.infer<typeof dateRangeSchema>) {
    const r = range(q);
    return this.svc.groupStatement(groupId, r.from, r.to, { showMemberNames: true });
  }

  @RequirePermission(Permission.REPORTS_VIEW)
  @AuditedExport('live-statement')
  @Get('live.pdf')
  async livePdf(@Param('groupId') groupId: string, @Query(new ZodPipe(dateRangeSchema)) q: z.infer<typeof dateRangeSchema>, @Res() res: Response) {
    const r = range(q);
    const s = await this.svc.groupStatement(groupId, r.from, r.to, { showMemberNames: true });
    this.sendPdf(res, await this.pdf.groupStatement(s), `statement-${r.from}-${r.to}.pdf`);
  }

  @RequirePermission(Permission.STATEMENTS_PUBLISH)
  @Post('publish')
  publish(@Param('groupId') groupId: string, @Body(new ZodPipe(required)) body: z.infer<typeof required>, @CurrentMembership() m: MembershipContext, @ReqMeta() meta: RequestMeta) {
    return this.svc.publish(groupId, body.from, body.to, m, meta);
  }

  @RequirePermission(Permission.STATEMENTS_VIEW)
  @Get()
  published(@Param('groupId') groupId: string) {
    return this.svc.published(groupId);
  }

  @RequirePermission(Permission.STATEMENTS_VIEW)
  @Get(':id')
  one(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext) {
    return this.svc.publishedOne(groupId, id, m);
  }

  @RequirePermission(Permission.STATEMENTS_VIEW)
  @AuditedExport('published-statement')
  @Get(':id/pdf')
  async onePdf(@Param('groupId') groupId: string, @Param('id') id: string, @CurrentMembership() m: MembershipContext, @Res() res: Response) {
    const s = await this.svc.publishedOne(groupId, id, m);
    this.sendPdf(res, await this.pdf.groupStatement(s), `statement-${s.from}-${s.to}.pdf`);
  }

  private sendPdf(res: Response, buf: Buffer, name: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }
}

@Controller('me/statement')
export class PersonalStatementController {
  constructor(
    private readonly svc: StatementsService,
    private readonly pdf: PdfService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthContext, @Query(new ZodPipe(dateRangeSchema)) q: z.infer<typeof dateRangeSchema>) {
    const r = range(q);
    return this.svc.personal(user.id, r.from, r.to);
  }

  @AuditedExport('personal-statement')
  @Get('pdf')
  async pdfOut(@CurrentUser() user: AuthContext, @Query(new ZodPipe(dateRangeSchema)) q: z.infer<typeof dateRangeSchema>, @Res() res: Response) {
    const r = range(q);
    const s = await this.svc.personal(user.id, r.from, r.to);
    const buf = await this.pdf.personalStatement(s);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="chamahub-statement-${r.from}-${r.to}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }
}
