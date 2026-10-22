import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { testOtpOutbox } from '../src/modules/auth/otp.service';

export interface TestUser {
  id: string;
  phone: string;
  token: string;
  refreshToken: string;
  fullName: string;
}

let phoneCounter = 0;

export function uniquePhone() {
  phoneCounter++;
  const n = (Date.now() % 1_000_000) * 100 + (phoneCounter % 100) + Math.floor(Math.random() * 50) * 0;
  return `07${String(n).padStart(8, '0').slice(-8)}`;
}

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Wipes all data. Journal/audit tables are append-only, so triggers are bypassed for the test DB only. */
export async function resetDatabase(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'plans', 'plan_prices', 'regions', 'billing_provider_availability')`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
    prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`),
  ]);
}

export const api = (app: INestApplication) => request(app.getHttpServer());

export async function registerUser(app: INestApplication, fullName = 'Test User', opts: { verify?: boolean } = {}): Promise<TestUser> {
  const phone = uniquePhone();
  const res = await api(app).post('/v1/auth/register').send({ fullName, phone, password: 'Passw0rd!' }).expect(201);
  const user: TestUser = { id: res.body.user.id, phone: res.body.user.phone, token: res.body.tokens.accessToken, refreshToken: res.body.tokens.refreshToken, fullName };
  if (opts.verify !== false) {
    const code = testOtpOutbox.get(`${user.phone}:VERIFY_PHONE`);
    await api(app).post('/v1/auth/verify-phone').set('Authorization', `Bearer ${user.token}`).send({ code }).expect(200);
  }
  return user;
}

export function as(app: INestApplication, user: TestUser) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (url: string) => auth(api(app).get(url)),
    post: (url: string, body?: object) => auth(api(app).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(api(app).patch(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(api(app).put(url)).send(body ?? {}),
    delete: (url: string) => auth(api(app).delete(url)),
  };
}

/** Creates a group owned by `chair` and adds the given users with roles via invitations. */
export async function createGroupWith(
  app: INestApplication,
  chair: TestUser,
  members: { user: TestUser; role: string }[],
  body: Record<string, unknown> = {},
) {
  const g = await as(app, chair).post('/v1/groups', { name: 'Test Chama', type: 'TABLE_BANKING', ...body }).expect(201);
  const groupId = g.body.id as string;
  const membershipIds: Record<string, string> = {};
  for (const m of members) {
    const inv = await as(app, chair).post(`/v1/groups/${groupId}/invitations`, { phone: m.user.phone, role: m.role }).expect(201);
    await as(app, m.user).post(`/v1/invitations/${inv.body.id}/respond`, { accept: true }).expect(200);
  }
  const list = await as(app, chair).get(`/v1/groups/${groupId}/members`).expect(200);
  for (const row of list.body) membershipIds[row.userId] = row.membershipId;
  return { groupId, membershipIds };
}

let keyCounter = 0;
export const idem = () => `test-key-${Date.now()}-${++keyCounter}`;
