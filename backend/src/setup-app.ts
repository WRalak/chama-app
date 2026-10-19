import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { env } from './config/env';

/** Shared HTTP configuration for main.ts and the e2e test harness. */
export function configureApp(app: INestApplication) {
  const e = env();
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
