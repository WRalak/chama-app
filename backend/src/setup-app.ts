import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
import helmet from 'helmet';
import { env } from './config/env';

/** The only routes that accept large bodies: spreadsheet imports and payment evidence files. */
export const LARGE_BODY_ROUTE = /^\/v1\/groups\/[^/]+\/(imports|statement-imports(\/preview)?|payments\/[^/]+\/evidence)\/?$/;
export const BODY_LIMITS = { default: '256kb', large: '8mb' };

/** Keeps the exact bytes too: payment webhooks are verified against the raw body. */
const keepRaw = (req: Request, _res: Response, buf: Buffer) => ((req as Request & { rawBody?: Buffer }).rawBody = buf);

/**
 * Shared HTTP configuration for main.ts and the e2e test harness (both create the app with
 * `bodyParser: false`). Small bodies everywhere keep validation cheap: a large JSON array costs
 * real CPU and memory to parse and validate before any limit in a schema can reject it.
 */
export function configureApp(app: INestApplication) {
  const e = env();
  const small = json({ limit: BODY_LIMITS.default, verify: keepRaw });
  const large = json({ limit: BODY_LIMITS.large, verify: keepRaw });
  app.use((req: Request, res: Response, next: NextFunction) => (req.method === 'POST' && LARGE_BODY_ROUTE.test(req.path) ? large : small)(req, res, next));
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.use(helmet());
  app.enableCors({
    origin: e.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Idempotency-Key'],
  });
  app.enableShutdownHooks();
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
}
