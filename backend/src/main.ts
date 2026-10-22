import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { env } from './config/env';
import { configureApp } from './setup-app';

async function bootstrap() {
  const e = env();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Imports carry CSV text, so allow larger bodies than the default 100kb.
  // Keep the raw bytes as well: payment webhooks are verified by signing the exact body.
  app.use(json({ limit: '6mb', verify: (req, _res, buf) => ((req as typeof req & { rawBody?: Buffer }).rawBody = buf) }));
  configureApp(app);
  await app.listen(e.PORT);
  Logger.log(`ChamaHub API listening on :${e.PORT} (${e.NODE_ENV})`, 'Bootstrap');
}

void bootstrap();
