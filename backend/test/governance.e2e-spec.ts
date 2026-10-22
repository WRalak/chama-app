import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();

/**
 * Governance rules that protect the group's money: a Joint Signatory when the
 * group requires one, reminders that tell each member only their own debt,
 * and permanent handover records when officers change.
 */
describe('Group governance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chair: TestUser, vice: TestUser, treasurer: TestUser, signatory: TestUser, auditor: TestUser, alice: TestUser, bob: TestUser;
  let groupId: string;
  let ids: Record<string, string>;
  const g = (p: string) => `/v1/groups/${groupId}/${p}`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    vice = await registerUser(app, 'Victor Vice');
    treasurer = await registerUser(app, 'Tom Treasurer');
    signatory = await registerUser(app, 'Sara Signatory');
    auditor = await registerUser(app, 'Aud Auditor');
    alice = await registerUser(app, 'Alice Member');
    bob = await registerUser(app, 'Bob Member');
    const grp = await createGroupWith(app, chair, [
      { user: vice, role: 'VICE_CHAIRPERSON' },
      { user: treasurer, role: 'TREASURER' },
      { user: signatory, role: 'MEMBER' },
      { user: auditor, role: 'AUDITOR' },
      { user: alice, role: 'MEMBER' },
      { user: bob, role: 'MEMBER' },
    ]);
    groupId = grp.groupId;
    ids = grp.membershipIds;
    await as(app, treasurer).post(g('schedules'), { name: 'Monthly', amountCents: 100_000, frequency: 'MONTHLY', startDate: today }).expect(201);
    // Bob pays; the group has cash for an expense.
    const p = await as(app, treasurer).post(g('payments'), { memberId: ids[bob.id], amountCents: 100_000, method: 'CASH', paidAt: today, idempotencyKey: idem(), notes: 'Paid at meeting' }).expect(201);
    await as(app, chair).post(g(`payments/${p.body.id}/verify`), { decision: 'CONFIRM' }).expect(200);
  });
  afterAll(async () => app.close());

  describe('joint signatory', () => {
    it('cannot be required until someone holds the role', async () => {
      const r = await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { requireJointSignatory: true } }).expect(422);
      expect(r.body.message).toMatch(/Joint Signatory/);
      await as(app, chair).put(g(`members/${ids[signatory.id]}/special-roles`), { specialRoles: ['JOINT_SIGNATORY'], reason: 'Elected as joint signatory' }).expect(200);
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { requireJointSignatory: true } }).expect(200);
    });

    it('an expense with enough officer approvals still waits for the signatory', async () => {
      const e = await as(app, treasurer).post(g('expenses'), { category: 'Stationery', description: 'Receipt books', amountCents: 20_000, incurredOn: today }).expect(201);
      await as(app, chair).post(g(`expenses/${e.body.id}/decision`), { decision: 'APPROVE' }).expect(200);
      await as(app, vice).post(g(`expenses/${e.body.id}/decision`), { decision: 'APPROVE' }).expect(200);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: e.body.id } })).status).toBe('PENDING_APPROVAL');
      // The treasurer cannot pay it yet.
      await as(app, treasurer).post(g(`expenses/${e.body.id}/pay`), { method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(422);
      await as(app, signatory).post(g(`expenses/${e.body.id}/decision`), { decision: 'APPROVE' }).expect(200);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: e.body.id } })).status).toBe('APPROVED');
    });

    it('the group cannot lose its only signatory while the rule is on', async () => {
      await as(app, chair).put(g(`members/${ids[signatory.id]}/special-roles`), { specialRoles: [], reason: 'Stepping down now' }).expect(422);
      await as(app, chair).patch(g(`members/${ids[signatory.id]}/status`), { status: 'SUSPENDED', reason: 'Testing the safeguard' }).expect(422);
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { requireJointSignatory: false } }).expect(200);
    });
  });

  describe('contribution reminders', () => {
    it('only treasury officers can send them; auditors and members cannot', async () => {
      await as(app, alice).post(g('reminders/contributions'), {}).expect(403);
      await as(app, auditor).post(g('reminders/contributions'), {}).expect(403);
    });

    it('each owing member is told only their own amount, once per 12 hours', async () => {
      const r = (await as(app, treasurer).post(g('reminders/contributions'), {}).expect(200)).body;
      expect(r.sent).toBeGreaterThanOrEqual(5); // everyone except Bob, who paid
      const aliceNotes = await prisma.notification.findMany({ where: { userId: alice.id, type: 'CONTRIBUTION_OVERDUE' } });
      expect(aliceNotes).toHaveLength(1);
      expect(aliceNotes[0].body).toContain('KSh 1,000.00');
      expect(aliceNotes[0].body).not.toMatch(/Bob|Signatory|Treasurer/);
      expect(await prisma.notification.count({ where: { userId: bob.id, type: 'CONTRIBUTION_OVERDUE' } })).toBe(0);
      const again = await as(app, treasurer).post(g('reminders/contributions'), {}).expect(429);
      expect(again.body.message).toMatch(/12 hours/);
    });
  });

  describe('officer handovers', () => {
    let handoverIds: string[];

    it('a treasurer change records what the outgoing officer hands over, from the ledger', async () => {
      await as(app, chair).patch(g(`members/${ids[treasurer.id]}/role`), { role: 'MEMBER', reason: 'Term ended at the AGM' }).expect(200);
      await as(app, chair).patch(g(`members/${ids[alice.id]}/role`), { role: 'TREASURER', reason: 'Elected at the AGM' }).expect(200);
      const list = (await as(app, chair).get(g('handovers')).expect(200)).body;
      const treasurerRows = list.filter((h: { role: string }) => h.role === 'TREASURER');
      expect(treasurerRows).toHaveLength(2);
      const out = treasurerRows.find((h: { outgoingName: string | null }) => h.outgoingName === 'Tom Treasurer');
      const inn = treasurerRows.find((h: { incomingName: string | null }) => h.incomingName === 'Alice Member');
      expect(out.snapshot).toMatchObject({ confirmedContributionsCents: 100_000, pendingVerification: { count: 0, cents: 0 }, membersOwing: 6 });
      // The approved expense was never paid, so all KSh 1,000 received is still cash.
      expect(out.snapshot.cashBalanceCents).toBe(100_000);
      expect(out.snapshot.pendingApprovals).toEqual({ expenses: 0, payouts: 0, loans: 0, destinations: 0 });
      handoverIds = [out.id, inn.id];
    });

    it('only the incoming officer acknowledges, once; the record cannot be edited', async () => {
      const [outId, inId] = handoverIds;
      await as(app, treasurer).post(g(`handovers/${inId}/acknowledge`), {}).expect(403);
      await as(app, alice).post(g(`handovers/${inId}/acknowledge`), { note: 'Cash box and receipt books received' }).expect(200);
      await as(app, alice).post(g(`handovers/${inId}/acknowledge`), {}).expect(422);
      // The outgoing record is acknowledged by the person now holding the role.
      await as(app, treasurer).post(g(`handovers/${outId}/acknowledge`), {}).expect(403);
      await as(app, alice).post(g(`handovers/${outId}/acknowledge`), {}).expect(200);
      await expect(prisma.officerHandover.update({ where: { id: inId }, data: { notes: 'edited' } })).rejects.toThrow(/cannot be changed/);
      await expect(prisma.officerHandover.delete({ where: { id: inId } })).rejects.toThrow(/never deleted/);
    });

    it('members see only handovers they are part of; auditors see all', async () => {
      expect((await as(app, bob).get(g('handovers')).expect(200)).body).toEqual([]);
      expect((await as(app, auditor).get(g('handovers')).expect(200)).body.length).toBeGreaterThanOrEqual(2);
      const mine = (await as(app, treasurer).get(g('handovers')).expect(200)).body;
      expect(mine.every((h: { outgoingName: string | null; incomingName: string | null }) => h.outgoingName === 'Tom Treasurer' || h.incomingName === 'Tom Treasurer')).toBe(true);
    });

    it('an officer can prepare a handover before leaving; others cannot', async () => {
      await as(app, bob).post(g('handovers'), { role: 'TREASURER', notes: 'not mine' }).expect(403);
      const r = await as(app, alice).post(g('handovers'), { role: 'TREASURER', notes: 'Bank passbook with the chair' }).expect(201);
      const row = (await as(app, chair).get(g('handovers')).expect(200)).body.find((h: { id: string }) => h.id === r.body.id);
      expect(row).toMatchObject({ trigger: 'manual', outgoingName: 'Alice Member', notes: 'Bank passbook with the chair' });
    });
  });

  describe('auditor is read-only', () => {
    it('can read the ledger and audit log but cannot change records', async () => {
      await as(app, auditor).get(g('audit')).expect(200);
      await as(app, auditor).get(g('reports/cashbook?format=csv')).expect(200);
      await as(app, auditor).post(g('payments'), { memberId: ids[bob.id], amountCents: 100, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(403);
      await as(app, auditor).post(g('expenses'), { category: 'X', description: 'Not allowed', amountCents: 100, incurredOn: today }).expect(403);
      await as(app, auditor).patch(g(`members/${ids[bob.id]}/role`), { role: 'SECRETARY', reason: 'Not allowed' }).expect(403);
    });
  });
});
