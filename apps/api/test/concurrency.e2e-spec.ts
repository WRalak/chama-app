import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

/** Races that would double-count money if idempotency or status guards were missing. */
describe('Payment idempotency under concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chair: TestUser, treasurer: TestUser, member: TestUser;
  let groupId: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Race Chair');
    treasurer = await registerUser(app, 'Race Treasurer');
    member = await registerUser(app, 'Race Member');
    ({ groupId, membershipIds: ids } = await createGroupWith(app, chair, [{ user: treasurer, role: 'TREASURER' }, { user: member, role: 'MEMBER' }]));
  });
  afterAll(async () => app.close());

  it('records one payment when the same key is submitted 10 times at once', async () => {
    const body = { memberId: ids[member.id], amountCents: 50_000, method: 'CASH', paidAt: todayInNairobi(), idempotencyKey: idem() };
    const results = await Promise.all(Array.from({ length: 10 }, () => as(app, treasurer).post(`/v1/groups/${groupId}/payments`, body)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.payment.count({ where: { groupId, idempotencyKey: body.idempotencyKey } })).toBe(1);
  });

  it('posts to the ledger once when two officers confirm simultaneously', async () => {
    const rec = await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { memberId: ids[member.id], amountCents: 70_000, method: 'CASH', paidAt: todayInNairobi(), idempotencyKey: idem() }).expect(201);
    const [a, b] = await Promise.all([
      as(app, chair).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }),
      as(app, chair).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { paymentId: rec.body.id } })).toBe(1);
  });
});
