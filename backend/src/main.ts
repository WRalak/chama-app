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
  // Slow-client limits: a connection that dribbles headers or a body cannot hold a worker open.
  const server = app.getHttpServer() as import('node:http').Server;
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  Logger.log(`ChamaHub API listening on :${e.PORT} (${e.NODE_ENV})`, 'Bootstrap');
}

void bootstrap();
