import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { addMonths, isoDateSchema, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { toCsv } from '../../common/csv';
import { CurrentMembership, RequirePermission } from '../../common/decorators';
import { today } from '../../common/dates';
import { MembershipContext } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { ReportName, REPORTS, ReportsService } from './reports.service';
import { AuditedExport } from '../../common/export-audit';

const query = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional(), memberId: z.string().optional(), format: z.enum(['json', 'csv']).default('json') });

@Controller('groups/:groupId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission(Permission.REPORTS_VIEW)
  @Get()
  list() {
    return REPORTS;
  }

  @RequirePermission(Permission.REPORTS_VIEW)
  @AuditedExport('report', (req) => (req.query as { format?: string }).format === 'csv')
  @Get(':name')
  async get(@Param('groupId') groupId: string, @Param('name') name: string, @Query(new ZodPipe(query)) q: z.infer<typeof query>, @CurrentMembership() m: MembershipContext, @Res() res: Response) {
    if (!REPORTS.includes(name as ReportName)) throw new NotFoundException('Unknown report');
    const to = q.to ?? today();
    const range = { from: q.from ?? addMonths(to, -12), to, memberId: q.memberId };
    const report = await this.reports.build(groupId, name as ReportName, range, m);
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}-${range.from}-${range.to}.csv"`);
      res.send(toCsv(report.headers, report.rows));
      return;
    }
    res.json({ ...report, from: range.from, to: range.to });
  }
}
