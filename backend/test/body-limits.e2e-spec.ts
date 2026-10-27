import { INestApplication } from '@nestjs/common';
import { BODY_LIMITS } from '../src/setup-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, registerUser, resetDatabase } from './helpers';

/** Small request bodies everywhere except the upload routes, with a clean JSON error when exceeded. */
describe('Request body limits', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
  });
  afterAll(() => app.close());

  it(`refuses bodies over ${BODY_LIMITS.default} on ordinary routes, with a JSON error and no internals`, async () => {
    const u = await registerUser(app, 'Big Body');
    const huge = { fullName: 'x', memberIds: Array.from({ length: 60_000 }, () => 'abcdef') }; // ~540 KB
    const res = await as(app, u).patch('/v1/me', huge);
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.text).not.toMatch(/at \w+ \(|node_modules|PayloadTooLargeError:/);
  });

  it('answers malformed JSON with 400, not a server error', async () => {
    const u = await registerUser(app, 'Bad Json');
    const res = await as(app, u).patch('/v1/me').set('Content-Type', 'application/json').send('{"fullName": ');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid JSON/);
  });

  it(`accepts up to ${BODY_LIMITS.large} on upload routes (rejected later only by validation)`, async () => {
    const chair = await registerUser(app, 'Import Chair');
    const { groupId } = await createGroupWith(app, chair, []);
    const csv = `full_name,phone,shares\n${Array.from({ length: 70_000 }, (_, i) => `Person ${i},07${String(10000000 + i)},1`).join('\n')}\n`; // ~2.3 MB
    const res = await as(app, chair).post(`/v1/groups/${groupId}/imports`, { kind: 'MEMBERS', fileName: 'big.csv', csv });
    expect(res.status).not.toBe(413);
  });
});
