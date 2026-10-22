import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers';

/** Launch safeguards that sit outside any one feature: database exposure, headers, CORS and error output. */
describe('Platform security baseline', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(() => app.close());

  it('has row level security on every table, so a hosted Data API (e.g. Supabase anon key) cannot read them', async () => {
    const open = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    // A new migration that adds a table must also run: ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
    expect(open.map((t) => t.relname)).toEqual([]);
  });

  it('sends security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('only allows configured origins to call the API from a browser', async () => {
    const bad = await request(app.getHttpServer()).options('/v1/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const good = await request(app.getHttpServer()).options('/v1/me').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('returns errors without stack traces or internals', async () => {
    const res = await request(app.getHttpServer()).get('/v1/groups/not-a-real-id').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    for (const key of Object.keys(res.body)) expect(['statusCode', 'error', 'message', 'details', 'requestId']).toContain(key);
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+|prisma/i);
  });
});
