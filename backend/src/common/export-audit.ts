import { applyDecorators, CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { AppRequest, metaFrom } from './request';

/** Downloads of group financial data a person may make per minute. */
export const EXPORT_LIMIT = { limit: 20, ttl: 60_000 };

/**
 * Marks a route that hands out a file of financial records (CSV, PDF). Each download is
 * rate-limited, never cached, and recorded in the group's append-only audit trail *before* the
 * file is produced (if the record cannot be written, nothing is sent). `when` limits auditing to
 * the file form of a route that also serves screen data.
 */
export function AuditedExport(kind: string, when?: (req: AppRequest) => boolean) {
  @Injectable()
  class ExportAuditInterceptor implements NestInterceptor {
    constructor(readonly audit: AuditService) {}

    async intercept(ctx: ExecutionContext, next: CallHandler) {
      const req = ctx.switchToHttp().getRequest<AppRequest>();
      if (!when || when(req)) {
        ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
        const q = req.query as Record<string, unknown>;
        const pick = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).slice(0, 64) : undefined);
        await this.audit.log({
          groupId: (req.params as Record<string, string>).groupId ?? null,
          actorUserId: req.user?.id ?? null,
          action: 'export.downloaded',
          entityType: 'Export',
          entityId: (req.params as Record<string, string>).id ?? (req.params as Record<string, string>).name ?? kind,
          after: { kind, from: pick('from'), to: pick('to'), memberId: pick('memberId') },
          meta: metaFrom(req),
        });
      }
      return next.handle();
    }
  }
  return applyDecorators(Throttle({ default: EXPORT_LIMIT }), UseInterceptors(ExportAuditInterceptor));
}
