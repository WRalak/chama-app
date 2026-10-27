import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';
import { configureApp } from './setup-app';

async function bootstrap() {
  const e = env();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
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
