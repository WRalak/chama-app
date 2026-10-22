import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { MoneyError } from '@chamahub/shared';
import { env } from '../config/env';
import { AppRequest } from './request';

/** Converts every error into the shared ApiErrorBody shape without leaking internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const b = body as { message?: string | string[]; details?: unknown };
        message = Array.isArray(b.message) ? b.message.join('; ') : (b.message ?? exception.message);
        details = b.details;
      }
    } else if (exception instanceof MoneyError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = exception.message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'This record already exists.';
        details = exception.meta?.target;
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Record not found.';
      } else if (exception.code === 'P2034') {
        status = HttpStatus.CONFLICT;
        message = 'Another update happened at the same time. Please retry.';
      } else {
        this.logger.error(`${exception.code} ${exception.message}`);
      }
    } else if (exception instanceof Error && /append-only|unbalanced|violates check constraint/.test(exception.message)) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = 'This change violates a financial integrity rule and was rejected.';
      this.logger.error(exception.message);
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    if (status >= 500) this.report(exception, req, status);

    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      details,
      requestId: req.requestId,
    });
  }

  /**
   * Fire-and-forget alert for server errors. Sends only what is needed to find the log line:
   * no request body, query string, headers, user or financial data.
   */
  private report(exception: unknown, req: AppRequest, status: number) {
    const url = env().ERROR_WEBHOOK_URL;
    if (!url) return;
    const code = exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : undefined;
    const kind = exception instanceof Error ? exception.constructor.name : typeof exception;
    const report = { service: 'chamahub-api', environment: env().NODE_ENV, status, kind, code, method: req.method, path: (req.originalUrl ?? req.url ?? '').split('?')[0], requestId: req.requestId, at: new Date().toISOString() };
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `ChamaHub API ${status} ${kind}${code ? ` ${code}` : ''} on ${report.method} ${report.path} (request ${report.requestId})`, ...report }), signal: AbortSignal.timeout(3000) }).catch((e) => this.logger.warn(`Error webhook failed: ${e instanceof Error ? e.message : e}`));
  }
}
