import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();

/**
 * What the mobile app relies on: a management dashboard that shows each role
 * only what it may see, task counts that respect maker-checker rules,
 * escalation of payment discrepancies, push device registration, and strict
 * isolation between groups whatever ids a client sends.
 */
describe('Mobile management API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otherTreasurer: TestUser;
  let chair: TestUser, treasurer: TestUser, secretary: TestUser, auditor: TestUser, alice: TestUser, bob: TestUser, outsider: TestUser;
  let groupId: string;
  let otherGroupId: string;
  let ids: Record<string, string>;
  let alicePaymentId: string;
  const dash = (u: TestUser, g = groupId) => as(app, u).get(`/v1/groups/${g}/dashboard`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    treasurer = await registerUser(app, 'Tom Treasurer');
    secretary = await registerUser(app, 'Sam Secretary');
    auditor = await registerUser(app, 'Aud Auditor');
    alice = await registerUser(app, 'Alice Member');
    bob = await registerUser(app, 'Bob Member');
    outsider = await registerUser(app, 'Olive Outsider');
    const g = await createGroupWith(app, chair, [
      { user: treasurer, role: 'TREASURER' },
      { user: secretary, role: 'SECRETARY' },
      { user: auditor, role: 'AUDITOR' },
      { user: alice, role: 'MEMBER' },
      { user: bob, role: 'MEMBER' },
    ]);
    groupId = g.groupId;
    ids = g.membershipIds;
    otherTreasurer = await registerUser(app, 'Otto OtherTreasurer');
    otherGroupId = (await createGroupWith(app, outsider, [{ user: otherTreasurer, role: 'TREASURER' }])).groupId;
    await as(app, treasurer).post(`/v1/groups/${groupId}/schedules`, { name: 'Monthly', amountCents: 100_000, frequency: 'MONTHLY', startDate: today }).expect(201);
    // Treasurer records Alice's cash; it waits for a second officer.
    const rec = await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { memberId: ids[alice.id], amountCents: 100_000, method: 'CASH', paidAt: today, idempotencyKey: idem(), notes: 'Paid at the meeting' }).expect(201);
    alicePaymentId = rec.body.id;
  });
  afterAll(async () => app.close());

  it('an ordinary member sees only their own picture', async () => {
    const d = (await dash(alice).expect(200)).body;
    expect(d).toMatchObject({ collections: null, cashBalanceCents: null, reconciliation: null, loans: null, recentActivity: null, tasks: [] });
    expect(d.upcoming.every((u: { label: string }) => !u.label.includes('all members'))).toBe(true);
  });

  it('the chairperson sees collections and the payment waiting for a second officer', async () => {
    const d = (await dash(chair).expect(200)).body;
    expect(d.collections).toMatchObject({ expectedCents: expect.any(Number), pendingVerificationCount: 1, pendingVerificationCents: 100_000 });
    expect(d.collections.expectedCents).toBeGreaterThanOrEqual(600_000);
    expect(d.tasks).toContainEqual(expect.objectContaining({ key: 'VERIFY_PAYMENTS', count: 1, section: 'contributions' }));
  });

  it('the treasurer who recorded the payment is not asked to verify it', async () => {
    const d = (await dash(treasurer).expect(200)).body;
    expect(d.reconciliation).toMatchObject({ pendingVerification: 1 });
    expect(d.tasks.find((t: { key: string }) => t.key === 'VERIFY_PAYMENTS')).toBeUndefined();
  });

  it('the secretary gets no financial figures; the auditor reads them but has no approval tasks', async () => {
    expect((await dash(secretary).expect(200)).body).toMatchObject({ collections: null, cashBalanceCents: null, reconciliation: null });
    const a = (await dash(auditor).expect(200)).body;
    expect(a.collections).not.toBeNull();
    expect(a.recentActivity).not.toBeNull();
    expect(a.tasks).toEqual([]);
    await as(app, auditor).post(`/v1/groups/${groupId}/payments/${alicePaymentId}/verify`, { decision: 'CONFIRM' }).expect(403);
  });

  it('payments can be searched by member name, reference and amount', async () => {
    const byName = await as(app, chair).get(`/v1/groups/${groupId}/payments?q=alice`).expect(200);
    expect(byName.body.items.map((p: { id: string }) => p.id)).toEqual([alicePaymentId]);
    expect(byName.body.items[0]).toMatchObject({ source: 'MANUAL', status: 'PENDING', recordedByName: 'Tom Treasurer' });
    expect((await as(app, chair).get(`/v1/groups/${groupId}/payments?amountCents=100000`).expect(200)).body.total).toBe(1);
    expect((await as(app, chair).get(`/v1/groups/${groupId}/payments?amountCents=99999`).expect(200)).body.total).toBe(0);
    // Members only ever see their own payments, whatever they search for.
    expect((await as(app, bob).get(`/v1/groups/${groupId}/payments?q=alice`).expect(200)).body.total).toBe(0);
  });

  it('officers can escalate a discrepancy on any payment; members only on their own', async () => {
    await as(app, bob).post(`/v1/groups/${groupId}/disputes`, { paymentId: alicePaymentId, subject: 'Not mine', details: 'Trying to dispute someone else' }).expect(404);
    const d = await as(app, treasurer).post(`/v1/groups/${groupId}/disputes`, { paymentId: alicePaymentId, subject: 'Amount mismatch', details: 'Receipt book shows KES 900, not 1,000' }).expect(201);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: alicePaymentId } })).status).toBe('DISPUTED');
    await as(app, treasurer).post(`/v1/groups/${groupId}/disputes/${d.body.id}/resolve`, { status: 'RESOLVED', resolution: 'Checked receipt' }).expect(403); // not their own escalation
    await as(app, chair).post(`/v1/groups/${groupId}/disputes/${d.body.id}/resolve`, { status: 'RESOLVED', resolution: 'Receipt confirms KES 1,000' }).expect(200);
    expect((await dash(chair).expect(200)).body.reconciliation.openDisputes).toBe(0);
  });

  it('push devices register per user and receive queued pushes', async () => {
    await as(app, chair).post('/v1/notifications/devices', { token: 'not-a-token', platform: 'android' }).expect(400);
    await as(app, chair).post('/v1/notifications/devices', { token: 'ExponentPushToken[test-chair-device]', platform: 'android' }).expect(200);
    // A new payment needing verification notifies the chair.
    await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { memberId: ids[bob.id], amountCents: 100_000, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(201);
    const pushes = await prisma.notificationDelivery.count({ where: { channel: 'PUSH', notification: { userId: chair.id } } });
    expect(pushes).toBeGreaterThan(0);
    // The same phone signing in as someone else moves the token to them.
    await as(app, bob).post('/v1/notifications/devices', { token: 'ExponentPushToken[test-chair-device]', platform: 'android' }).expect(200);
    expect((await prisma.pushDevice.findUniqueOrThrow({ where: { token: 'ExponentPushToken[test-chair-device]' } })).userId).toBe(bob.id);
    await as(app, bob).post('/v1/notifications/devices/remove', { token: 'ExponentPushToken[test-chair-device]' }).expect(200);
    expect(await prisma.pushDevice.count()).toBe(0);
  });

  describe('group isolation', () => {
    it('a user cannot read another group by changing the group id', async () => {
      for (const path of ['dashboard', 'payments', 'members', 'rotations', 'loans', 'expenses', 'audit', 'reconciliation', 'meetings', `payments?q=alice`]) {
        await as(app, outsider).get(`/v1/groups/${groupId}/${path}`).expect(404);
      }
    });

    it('ids from one group never resolve inside another group', async () => {
      // The outsider is chair of their own group, so they hold verify permissions there.
      await as(app, outsider).post(`/v1/groups/${otherGroupId}/payments/${alicePaymentId}/verify`, { decision: 'CONFIRM' }).expect(404);
      await as(app, outsider).post(`/v1/groups/${otherGroupId}/payments/${alicePaymentId}/reverse`, { reason: 'Cross-group tampering attempt' }).expect((r) => expect([404, 422]).toContain(r.status));
      await as(app, outsider).post(`/v1/groups/${otherGroupId}/disputes`, { paymentId: alicePaymentId, subject: 'Tamper', details: 'Cross-group dispute' }).expect(404);
      // Recording for a member of another group is refused (a chairperson may not record at all; a treasurer would get "member not found").
      await as(app, outsider).post(`/v1/groups/${otherGroupId}/payments`, { memberId: ids[alice.id], amountCents: 100, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect((r) => expect([403, 404, 422]).toContain(r.status));
      // A treasurer of the other group holds record/verify/reverse there, and still cannot touch this group's data.
      await as(app, otherTreasurer).post(`/v1/groups/${otherGroupId}/payments`, { memberId: ids[alice.id], amountCents: 100, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect((r) => expect([404, 422]).toContain(r.status));
      await as(app, otherTreasurer).post(`/v1/groups/${otherGroupId}/payments/${alicePaymentId}/verify`, { decision: 'CONFIRM' }).expect(404);
      await as(app, otherTreasurer).post(`/v1/groups/${otherGroupId}/payments/${alicePaymentId}/reverse`, { reason: 'Cross-group tampering attempt' }).expect((r) => expect([404, 422]).toContain(r.status));
      await as(app, otherTreasurer).post(`/v1/groups/${groupId}/payments/${alicePaymentId}/verify`, { decision: 'CONFIRM' }).expect(404);
      expect(await prisma.payment.count({ where: { groupId: otherGroupId } })).toBe(0);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: alicePaymentId } })).groupId).toBe(groupId);
    });
  });
});
