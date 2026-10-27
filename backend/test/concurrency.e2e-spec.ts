import { INestApplication } from '@nestjs/common';
import { addDays, todayInNairobi } from '@chamahub/shared';
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
  it('never over-applies a loan when two full repayments are confirmed at the same moment', async () => {
    const today = todayInNairobi();
    const g = `/v1/groups/${groupId}`;
    // Savings for eligibility, then a loan of KES 3,000 (KES 3,900 with interest), approved and disbursed.
    for (let i = 0; i < 2; i++) {
      const p = await as(app, treasurer).post(`${g}/payments`, { memberId: ids[member.id], amountCents: 100_000, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(201);
      await as(app, chair).post(`${g}/payments/${p.body.id}/verify`, { decision: 'CONFIRM' }).expect(200);
    }
    await as(app, chair).post(`${g}/ledger/adjustments`, { amountCents: 1_000_000, account: 'OPENING_BALANCE', reason: 'Cash box balance carried from paper books', effectiveDate: today }).expect(201);
    const loan = (await as(app, member).post(`${g}/loans`, { principalCents: 300_000, installments: 3, purpose: 'Race test loan' }).expect(201)).body;
    for (const officer of [treasurer, chair]) await as(app, officer).post(`${g}/loans/${loan.id}/decision`, { decision: 'APPROVE' });
    const disbursed = await as(app, treasurer).post(`${g}/loans/${loan.id}/disburse`, { method: 'MPESA', reference: 'RACEDISB01', disbursedAt: today, firstDueDate: addDays(today, 30), idempotencyKey: idem() }).expect(200);
    const owed = disbursed.body.outstandingCents as number;

    const recorded = await Promise.all([0, 1].map(() => as(app, treasurer).post(`${g}/payments`, { memberId: ids[member.id], amountCents: owed, method: 'CASH', paidAt: today, idempotencyKey: idem(), purpose: 'LOAN_REPAYMENT', targetId: loan.id })));
    const pending = recorded.filter((r) => r.status === 201).map((r) => r.body.id as string);
    const confirms = await Promise.all(pending.map((id) => as(app, chair).post(`${g}/payments/${id}/verify`, { decision: 'CONFIRM' })));
    expect(confirms.some((r) => r.status >= 500)).toBe(false);
    const after = (await as(app, member).get(`${g}/loans/${loan.id}`).expect(200)).body;
    expect(after.paidCents).toBe(owed);
    expect(after.status).toBe('REPAID');
    const posted = await prisma.journalEntry.count({ where: { paymentId: { in: pending } } });
    expect(posted).toBe(1);
  });
});
