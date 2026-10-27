import { INestApplication } from '@nestjs/common';
import { addDays, drawOrder, todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();

/**
 * Merry-go-round engine end to end: approval before activation, order
 * methods, readiness checks, maker-checker on every payout step, evidence
 * before completion, failures and retries, amendments, and isolation.
 */
describe('Rotation engine', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chair: TestUser, treasurer: TestUser, pat: TestUser, alice: TestUser, bob: TestUser, carol: TestUser, dan: TestUser, outsider: TestUser;
  let groupId: string;
  let ids: Record<string, string>;
  const rot = (path = '') => `/v1/groups/${groupId}/rotations${path}`;
  const cash = async () => (await prisma.journalLine.aggregate({ where: { account: 'CASH', entry: { groupId } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n;

  async function payObligation(obligationId: string, member: TestUser, amountCents: number, verify = true) {
    const rec = await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { memberId: ids[member.id], amountCents, method: 'CASH', paidAt: today, idempotencyKey: idem(), targetId: obligationId }).expect(201);
    if (verify) await as(app, chair).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }).expect(200);
    return rec.body.id as string;
  }

  async function payRound(roundId: string, skip: TestUser[] = [], verify = true) {
    const all = [chair, treasurer, pat, alice, bob, carol, dan];
    const obligations = await prisma.contributionObligation.findMany({ where: { roundId, waivedReason: null } });
    const out: string[] = [];
    for (const o of obligations) {
      const member = all.find((u) => ids[u.id] === o.membershipId)!;
      if (skip.includes(member)) continue;
      out.push(await payObligation(o.id, member, Number(o.amountCents), verify));
    }
    return out;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    treasurer = await registerUser(app, 'Tom Treasurer');
    pat = await registerUser(app, 'Pat Approver');
    alice = await registerUser(app, 'Alice Member');
    bob = await registerUser(app, 'Bob Member');
    carol = await registerUser(app, 'Carol Member');
    dan = await registerUser(app, 'Dan Member');
    outsider = await registerUser(app, 'Olive Outsider');
    const g = await createGroupWith(app, chair, [
      { user: treasurer, role: 'TREASURER' },
      { user: pat, role: 'MEMBER' },
      { user: alice, role: 'MEMBER' },
      { user: bob, role: 'MEMBER' },
      { user: carol, role: 'MEMBER' },
      { user: dan, role: 'MEMBER' },
    ], { type: 'MERRY_GO_ROUND' });
    groupId = g.groupId;
    ids = g.membershipIds;
    await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { requiredFinancialApprovals: 1 } }).expect(200);
    await as(app, chair).put(`/v1/groups/${groupId}/members/${ids[pat.id]}/special-roles`, { specialRoles: ['PAYOUT_APPROVER'], reason: 'Second signatory for payouts' }).expect(200);
    await createGroupWith(app, outsider, []);
  });
  afterAll(async () => app.close());

  describe('drafting and approval', () => {
    it('a random draw is published with its seed and can be re-verified; a cancelled draft binds nobody', async () => {
      const members = [alice, bob, carol, dan].map((u) => ids[u.id]);
      const d = await as(app, treasurer).post(rot(), { name: 'Draw test', contributionCents: 50_000, frequency: 'MONTHLY', startDate: today, orderMethod: 'RANDOM_DRAW', memberIds: members }).expect(201);
      expect(d.body.drawSeed).toMatch(/^[0-9a-f]{32}$/);
      expect(d.body.rounds.map((r: { recipientMembershipId: string }) => r.recipientMembershipId)).toEqual(drawOrder(d.body.drawParticipants, d.body.drawSeed));
      await as(app, treasurer).post(rot(), { name: 'Second', contributionCents: 50_000, frequency: 'MONTHLY', startDate: today, memberIds: members }).expect(409);
      await as(app, alice).post(rot(`/${d.body.id}/cancel`), { reason: 'Not mine to cancel' }).expect(403);
      const c = await as(app, treasurer).post(rot(`/${d.body.id}/cancel`), { reason: 'Members want an agreed order instead' }).expect(200);
      expect(c.body.status).toBe('CANCELLED');
      expect(c.body.rounds.every((r: { status: string }) => r.status === 'CANCELLED')).toBe(true);
      expect(await prisma.contributionObligation.count({ where: { groupId } })).toBe(0);
    });

    it('validates rotations: active members only, even rounds, carry-over needs history', async () => {
      const base = { name: 'Bad', contributionCents: 50_000, frequency: 'WEEKLY', startDate: today };
      await as(app, treasurer).post(rot(), { ...base, memberIds: [ids[alice.id], 'not-a-member'] }).expect(422);
      await as(app, treasurer).post(rot(), { ...base, memberIds: [ids[alice.id], ids[bob.id], ids[carol.id]], recipientsPerRound: 2 }).expect(400);
      await as(app, treasurer).post(rot(), { ...base, memberIds: [ids[alice.id], ids[alice.id]] }).expect(400);
      await as(app, treasurer).post(rot(), { ...base, orderMethod: 'CARRY_OVER', memberIds: [ids[alice.id], ids[bob.id]] }).expect(422);
    });

    it('members can approve a schedule by vote; it activates only when the vote passes', async () => {
      const g = await createGroupWith(app, carol, [
        { user: alice, role: 'TREASURER' },
        { user: bob, role: 'MEMBER' },
        { user: dan, role: 'MEMBER' },
      ], { type: 'MERRY_GO_ROUND' });
      const v = (path = '') => `/v1/groups/${g.groupId}/rotations${path}`;
      const members = [alice, bob, dan].map((u) => g.membershipIds[u.id]);
      const closesAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      await as(app, alice).post(v(), { name: 'Voted cycle', contributionCents: 50_000, frequency: 'MONTHLY', startDate: today, memberIds: members, approvalMode: 'MEMBER_VOTE' }).expect(400); // needs vote settings
      const d = await as(app, alice).post(v(), { name: 'Voted cycle', contributionCents: 50_000, frequency: 'MONTHLY', startDate: today, memberIds: members, approvalMode: 'MEMBER_VOTE', vote: { closesAt, quorumPercent: 50, passPercent: 50 } }).expect(201);
      expect(d.body.proposalId).toBeTruthy();
      await as(app, carol).post(v(`/${d.body.id}/activation`), { decision: 'APPROVE' }).expect(422); // members decide, not officers
      for (const u of [alice, bob, dan]) await as(app, u).post(`/v1/groups/${g.groupId}/votes/${d.body.proposalId}/ballot`, { choice: 'YES' }).expect(200);
      expect((await as(app, carol).get(v(`/${d.body.id}`))).body.status).toBe('DRAFT');
      await as(app, carol).post(`/v1/groups/${g.groupId}/votes/${d.body.proposalId}/close`, {}).expect(200);
      const after = await as(app, carol).get(v(`/${d.body.id}`)).expect(200);
      expect(after.body.status).toBe('ACTIVE');
      expect(await prisma.contributionObligation.count({ where: { round: { cycleId: d.body.id, round: 1 } } })).toBe(3);

      // A failed vote cancels the draft instead.
      const g2 = await createGroupWith(app, carol, [{ user: alice, role: 'TREASURER' }, { user: bob, role: 'MEMBER' }], { type: 'MERRY_GO_ROUND' });
      const d2 = await as(app, alice).post(`/v1/groups/${g2.groupId}/rotations`, { name: 'Rejected cycle', contributionCents: 50_000, frequency: 'MONTHLY', startDate: today, memberIds: [g2.membershipIds[alice.id], g2.membershipIds[bob.id]], approvalMode: 'MEMBER_VOTE', vote: { closesAt, quorumPercent: 50, passPercent: 50 } }).expect(201);
      for (const u of [alice, bob, carol]) await as(app, u).post(`/v1/groups/${g2.groupId}/votes/${d2.body.proposalId}/ballot`, { choice: 'NO' }).expect(200);
      await as(app, carol).post(`/v1/groups/${g2.groupId}/votes/${d2.body.proposalId}/close`, {}).expect(200);
      expect((await as(app, carol).get(`/v1/groups/${g2.groupId}/rotations/${d2.body.id}`)).body.status).toBe('CANCELLED');
    });
  });

  describe('payouts', () => {
    let cycleId: string;
    let rounds: { id: string; round: number; recipientMembershipId: string }[];
    const step = (r: { id: string }, s: string) => rot(`/${cycleId}/rounds/${r.id}/${s}`);

    beforeAll(async () => {
      const order = [alice, bob, carol, dan].map((u) => ids[u.id]);
      const d = await as(app, treasurer).post(rot(), { name: 'Main cycle', contributionCents: 100_000, frequency: 'WEEKLY', startDate: today, memberIds: order, recipientContributes: true }).expect(201);
      cycleId = d.body.id;
      await as(app, treasurer).post(rot(`/${cycleId}/activation`), { decision: 'APPROVE' }).expect(403);
      const a = await as(app, pat).post(rot(`/${cycleId}/activation`), { decision: 'APPROVE', comment: 'Order agreed' }).expect(200);
      expect(a.body.status).toBe('ACTIVE');
      rounds = a.body.rounds;
    });

    it('does not pay out on unverified payments or open disputes', async () => {
      const r1 = rounds[0];
      await payRound(r1.id, [], false); // recorded, not verified
      const blocked = await as(app, treasurer).post(step(r1, 'prepare'), {}).expect(422);
      expect(blocked.body.details.checks.find((c: { key: string }) => c.key === 'RECONCILIATION').status).toBe('FAIL');
      for (const p of await prisma.payment.findMany({ where: { groupId, status: 'PENDING' } })) await as(app, chair).post(`/v1/groups/${groupId}/payments/${p.id}/verify`, { decision: 'CONFIRM' }).expect(200);
      const alicePayment = await prisma.payment.findFirstOrThrow({ where: { groupId, membershipId: ids[alice.id], status: 'CONFIRMED' } });
      const dispute = await as(app, alice).post(`/v1/groups/${groupId}/disputes`, { paymentId: alicePayment.id, subject: 'Wrong amount', details: 'I think this was recorded twice' }).expect(201);
      const disputed = await as(app, treasurer).post(step(r1, 'prepare'), {}).expect(422);
      expect(disputed.body.details.checks.find((c: { key: string }) => c.key === 'DISPUTES').status).toBe('FAIL');
      await as(app, chair).post(`/v1/groups/${groupId}/disputes/${dispute.body.id}/resolve`, { status: 'RESOLVED', resolution: 'Checked the receipt book; recorded once' }).expect(200);
      const view = await as(app, alice).get(rot(`/${cycleId}`)).expect(200);
      expect(view.body.rounds[0].readiness.ready).toBe(true); // the recipient sees why
      expect(view.body.rounds[0].can.prepare).toBe(false);
    });

    it('the preparer and the recipient cannot approve; approvals bind to the prepared amount', async () => {
      const r1 = rounds[0];
      await as(app, alice).post(step(r1, 'prepare'), {}).expect(403);
      const p = await as(app, chair).post(step(r1, 'prepare'), {}).expect(200);
      expect(p.body.rounds[0]).toMatchObject({ status: 'AWAITING_APPROVAL', preparedAmountCents: 400_000, preparedByName: 'Grace Chair' });
      await as(app, chair).post(step(r1, 'approve'), {}).expect(403); // preparer
      await as(app, treasurer).post(step(r1, 'approve'), {}).expect(403); // no payouts.approve
      await as(app, pat).post(step(r1, 'approve'), { decision: 'REJECT' }).expect(422); // a rejection needs a reason
      const a = await as(app, pat).post(step(r1, 'approve'), { comment: 'Matches the collection sheet' }).expect(200);
      expect(a.body.rounds[0].status).toBe('APPROVED');
      await as(app, pat).post(step(r1, 'approve'), {}).expect(422);
    });

    it('a sent payout is completed only with independent confirmation, and posts to the ledger once', async () => {
      const r1 = rounds[0];
      const before = await cash();
      await as(app, alice).post(step(r1, 'disburse'), { method: 'MPESA', reference: 'SELF', sentAt: today, idempotencyKey: idem() }).expect(403);
      await as(app, treasurer).post(step(r1, 'disburse'), { method: 'CASH', sentAt: today, idempotencyKey: idem() }).expect(400); // cash needs a handover note
      const key = idem();
      const body = { method: 'MPESA', reference: 'RKT1ABC234', destination: 'M-Pesa 0712 *** 678', sentAt: today, idempotencyKey: key };
      const sent = await as(app, treasurer).post(step(r1, 'disburse'), body).expect(200);
      expect(sent.body.rounds[0].status).toBe('PROCESSING');
      await as(app, treasurer).post(step(r1, 'disburse'), body).expect(200); // idempotent replay
      expect(await prisma.payoutDisbursement.count({ where: { roundId: r1.id } })).toBe(1);
      expect(await cash()).toBe(before);
      await as(app, treasurer).post(step(r1, 'confirm'), {}).expect(403); // sender
      await as(app, bob).post(step(r1, 'confirm'), {}).expect(403); // unrelated member
      const done = await as(app, pat).post(step(r1, 'confirm'), { note: 'Matched on the M-Pesa statement' }).expect(200);
      expect(done.body.rounds[0]).toMatchObject({ status: 'COMPLETED', payoutAmountCents: 400_000, payoutReference: 'RKT1ABC234', confirmation: { kind: 'OFFICER_VERIFIED', byName: 'Pat Approver' } });
      expect(await cash()).toBe(before - 400_000n);
      await as(app, alice).post(step(r1, 'confirm'), {}).expect(422);
      expect(await cash()).toBe(before - 400_000n);
      // A reference is never reused for another payout.
      await payRound(rounds[1].id);
      // Round 2 is due next week; early payouts need the group's explicit permission.
      const early = await as(app, chair).post(step(rounds[1], 'prepare'), {}).expect(422);
      expect(early.body.details.checks.find((c: { key: string }) => c.key === 'DATE').status).toBe('FAIL');
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { allowEarlyPayout: true } }).expect(200);
      await as(app, chair).post(step(rounds[1], 'prepare'), {}).expect(200);
      // Five simultaneous approvals by the same approver count once.
      const approvals = await Promise.all(Array.from({ length: 5 }, () => as(app, pat).post(step(rounds[1], 'approve'), {})));
      expect(approvals.filter((r) => r.status === 200)).toHaveLength(1);
      expect(approvals.every((r) => r.status === 200 || (r.status >= 400 && r.status < 500))).toBe(true);
      await as(app, treasurer).post(step(rounds[1], 'disburse'), { ...body, idempotencyKey: idem() }).expect(409);
    });

    it('a failed payout keeps its history and can be retried; the recipient can dispute it', async () => {
      const r2 = rounds[1];
      const before = await cash();
      await as(app, treasurer).post(step(r2, 'disburse'), { method: 'MPESA', reference: 'RKT2FAIL01', sentAt: today, idempotencyKey: idem() }).expect(200);
      await as(app, bob).post(step(r2, 'fail'), { reason: 'Not mine to fail' }).expect(403);
      const failed = await as(app, chair).post(step(r2, 'fail'), { reason: 'M-Pesa reversed the transfer: wrong number' }).expect(200);
      expect(failed.body.rounds[1]).toMatchObject({ status: 'FAILED', failureReason: 'M-Pesa reversed the transfer: wrong number', attempts: 1 });
      expect(await cash()).toBe(before);
      // Five different disbursement requests at once (different keys): only one attempt is recorded.
      const sends = await Promise.all(Array.from({ length: 5 }, (_, i) => as(app, treasurer).post(step(r2, 'disburse'), { method: 'MPESA', reference: `RKT2OK000${i}`, sentAt: today, idempotencyKey: idem() })));
      expect(sends.filter((r) => r.status === 200)).toHaveLength(1);
      expect(sends.some((r) => r.status >= 500)).toBe(false);
      expect(await prisma.payoutDisbursement.count({ where: { roundId: r2.id, status: { not: 'FAILED' } } })).toBe(1);
      await as(app, bob).post(step(r2, 'problem'), { details: 'Nothing has arrived on my line yet' }).expect(200);
      await as(app, pat).post(step(r2, 'confirm'), {}).expect(422); // disputed: officers cannot confirm over the recipient
      const confirms = await Promise.all(Array.from({ length: 5 }, () => as(app, bob).post(step(r2, 'confirm'), { note: 'Arrived late, all good' })));
      expect(confirms.filter((r) => r.status === 200)).toHaveLength(1);
      expect(confirms.some((r) => r.status >= 500)).toBe(false);
      const done = confirms.find((r) => r.status === 200)!;
      expect(done.body.rounds[1]).toMatchObject({ status: 'COMPLETED', attempts: 2, confirmation: { kind: 'RECIPIENT' } });
      expect(await cash()).toBe(before - 400_000n);
      const attempts = await prisma.payoutDisbursement.findMany({ where: { roundId: r2.id }, orderBy: { attempt: 'asc' } });
      expect(attempts.map((a) => a.status)).toEqual(['FAILED', 'CONFIRMED']);
    });

    it('re-preparation is required when the collection changes after preparation', async () => {
      const r3 = rounds[2];
      await payRound(r3.id, [dan]);
      await as(app, treasurer).post(step(r3, 'prepare'), {}).expect(422); // shortfall needs a reason
      await as(app, treasurer).post(step(r3, 'prepare'), { shortfallReason: 'Dan is travelling; agreed to pay what is collected' }).expect(200);
      const o = await prisma.contributionObligation.findFirstOrThrow({ where: { roundId: r3.id, membershipId: ids[dan.id] } });
      await payObligation(o.id, dan, 100_000);
      await as(app, pat).post(step(r3, 'approve'), {}).expect(409);
      const again = await as(app, treasurer).post(step(r3, 'prepare'), {}).expect(200);
      expect(again.body.rounds[2]).toMatchObject({ preparedAmountCents: 400_000, shortfallReason: null, approvals: [] });
    });

    it('holds a short round when the group policy says so', async () => {
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { missedContributionPolicy: 'HOLD_UNTIL_COMPLETE' } }).expect(200);
      const r = await as(app, treasurer).get(rot(`/${cycleId}`)).expect(200);
      expect(r.body.rounds[2].readiness.ready).toBe(true); // fully collected now
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { missedContributionPolicy: 'PAY_CONFIRMED_WITH_REASON' } }).expect(200);
    });

    it('other groups cannot see or act on this rotation', async () => {
      await as(app, outsider).get(rot(`/${cycleId}`)).expect(404);
      await as(app, outsider).post(step(rounds[2], 'approve'), {}).expect(404);
    });

    it('amendments: never move a locked recipient, apply only after approval, keep the original plan', async () => {
      const remove = { kind: 'REMOVE_MEMBER', memberId: ids[alice.id], reason: 'Alice is leaving the group' };
      await as(app, treasurer).post(rot(`/${cycleId}/amendments`), remove).expect(422); // already paid
      const p = await as(app, treasurer).post(rot(`/${cycleId}/amendments`), { kind: 'REPLACE_MEMBER', memberId: ids[dan.id], replacementId: ids[pat.id], reason: 'Dan hands his slot to Pat' }).expect(201);
      await as(app, treasurer).post(rot(`/${cycleId}/amendments`), { kind: 'ADD_MEMBERS', memberIds: [ids[chair.id]], reason: 'Another change' }).expect(409);
      const cyc = await as(app, treasurer).get(rot(`/${cycleId}`)).expect(200);
      expect(cyc.body.rounds[2].readiness.checks.find((c: { key: string }) => c.key === 'AMENDMENTS').status).toBe('FAIL');
      await as(app, treasurer).post(rot(`/${cycleId}/changes/${p.body.changeId}/decision`), { decision: 'APPROVE' }).expect(403);
      const after = await as(app, chair).post(rot(`/${cycleId}/changes/${p.body.changeId}/decision`), { decision: 'APPROVE' }).expect(200);
      expect(after.body.rounds.map((r: { recipientName: string }) => r.recipientName)).toEqual(['Alice Member', 'Bob Member', 'Carol Member', 'Pat Approver']);
      expect(after.body.approvedPlan.map((r: { memberName: string }) => r.memberName)).toEqual(['Alice Member', 'Bob Member', 'Carol Member', 'Dan Member']);
      expect(after.body.changeLog[0]).toMatchObject({ kind: 'REPLACE_MEMBER', joinedNames: ['Pat Approver'], leftNames: ['Dan Member'] });
      // Pat owes only rounds from today; Dan owes nothing further.
      const sm = await prisma.scheduleMember.findMany({ where: { schedule: { cycleId } }, include: { membership: { select: { userId: true } } } });
      expect(sm.find((m) => m.membership.userId === pat.id)!.fromDate).not.toBeNull();
      expect(sm.find((m) => m.membership.userId === dan.id)!.untilDate).not.toBeNull();
    });

    it('adding a member appends a round on the original calendar', async () => {
      await as(app, treasurer).post(rot(`/${cycleId}/amendments`), { kind: 'ADD_MEMBERS', memberIds: [ids[pat.id]], reason: 'Pat twice' }).expect(422); // already in the rotation
      const add = await as(app, treasurer).post(rot(`/${cycleId}/amendments`), { kind: 'ADD_MEMBERS', memberIds: [ids[chair.id]], reason: 'Grace joins the rotation' }).expect(201);
      const after = await as(app, pat).post(rot(`/${cycleId}/changes/${add.body.changeId}/decision`), { decision: 'APPROVE' }).expect(200);
      const last = after.body.rounds.at(-1);
      expect(last).toMatchObject({ round: 5, recipientName: 'Grace Chair', payoutDate: addDays(today, 28) });
    });
  });

  describe('several recipients per round', () => {
    it('splits each round exactly between its recipients', async () => {
      const g = await createGroupWith(app, outsider, [
        { user: alice, role: 'TREASURER' },
        { user: bob, role: 'MEMBER' },
        { user: carol, role: 'MEMBER' },
      ], { type: 'MERRY_GO_ROUND' });
      const d = await as(app, alice).post(`/v1/groups/${g.groupId}/rotations`, { name: 'Pairs', contributionCents: 100_001, frequency: 'MONTHLY', startDate: today, memberIds: [g.membershipIds[bob.id], g.membershipIds[carol.id], g.membershipIds[outsider.id], g.membershipIds[alice.id]], recipientsPerRound: 2 }).expect(201);
      expect(d.body.rounds.map((r: { round: number; slot: number }) => `${r.round}.${r.slot}`)).toEqual(['1.1', '1.2', '2.1', '2.2']);
      expect(d.body.rounds[0]).toMatchObject({ expectedCents: 400_004, expectedShareCents: 200_002, recipientsInRound: 2 });
      expect(d.body.rounds[2].payoutDate).toBe(d.body.rounds[3].payoutDate);
    });
  });
});
