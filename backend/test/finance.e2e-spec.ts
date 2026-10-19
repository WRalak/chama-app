import { INestApplication } from '@nestjs/common';
import { addDays, todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetEnvCache } from '../src/config/env';
import { api, as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();

describe('Financial workflows', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let chair: TestUser, treasurer: TestUser, alice: TestUser, bob: TestUser;
  let groupId: string;
  let ids: Record<string, string>;

  const cash = async () => (await prisma.journalLine.aggregate({ where: { account: 'CASH', entry: { groupId } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n;

  async function pay(by: TestUser, verifier: TestUser, member: TestUser, amountCents: number, extra: Record<string, unknown> = {}) {
    const rec = await as(app, by).post(`/v1/groups/${groupId}/payments`, { memberId: ids[member.id], amountCents, method: 'CASH', paidAt: today, idempotencyKey: idem(), ...extra }).expect(201);
    await as(app, verifier).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }).expect(200);
    return rec.body.id as string;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    treasurer = await registerUser(app, 'Tom Treasurer');
    alice = await registerUser(app, 'Alice Member');
    bob = await registerUser(app, 'Bob Member');
    const g = await createGroupWith(app, chair, [
      { user: treasurer, role: 'TREASURER' },
      { user: alice, role: 'MEMBER' },
      { user: bob, role: 'MEMBER' },
    ]);
    groupId = g.groupId;
    ids = g.membershipIds;
  });
  afterAll(async () => app.close());

  describe('contributions', () => {
    let obligationId: string;

    it('generates obligations from a schedule', async () => {
      await as(app, treasurer).post(`/v1/groups/${groupId}/schedules`, { name: 'Monthly savings', amountCents: 200_000, frequency: 'MONTHLY', startDate: today }).expect(201);
      await as(app, alice).post(`/v1/groups/${groupId}/schedules`, { name: 'Nope', amountCents: 100, frequency: 'MONTHLY', startDate: today }).expect(403);
      const mine = await as(app, alice).get('/v1/me/obligations').expect(200);
      expect(mine.body.length).toBeGreaterThanOrEqual(1);
      expect(mine.body[0]).toMatchObject({ amountCents: 200_000, paidCents: 0, status: 'DUE', groupId });
      obligationId = mine.body[0].id;
    });

    it('records as PENDING, enforces maker-checker, confirms into the ledger', async () => {
      const key = idem();
      const body = { memberId: ids[alice.id], amountCents: 200_000, method: 'MPESA', reference: 'QWE123RTY', paidAt: today, idempotencyKey: key, targetId: obligationId };
      await as(app, alice).post(`/v1/groups/${groupId}/payments`, body).expect(403);
      const rec = await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, body).expect(201);
      expect(rec.body.status).toBe('PENDING');
      expect(await cash()).toBe(0n); // recorded ≠ received

      const replay = await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, body).expect(201);
      expect(replay.body.id).toBe(rec.body.id);
      await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { ...body, amountCents: 1 }).expect(409);
      await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { ...body, idempotencyKey: idem() }).expect(409); // duplicate M-Pesa ref

      await as(app, treasurer).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }).expect(403);
      const ok = await as(app, chair).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }).expect(200);
      expect(ok.body.status).toBe('CONFIRMED');
      await as(app, chair).post(`/v1/groups/${groupId}/payments/${rec.body.id}/verify`, { decision: 'CONFIRM' }).expect(422);
      expect(await cash()).toBe(200_000n);

      const ob = await prisma.contributionObligation.findUniqueOrThrow({ where: { id: obligationId } });
      expect(ob.paidCents).toBe(200_000n);
      expect(ob.status).toBe('PAID');
    });

    it('lets members see only their own payments', async () => {
      const a = await as(app, alice).get(`/v1/groups/${groupId}/payments`).expect(200);
      const b = await as(app, bob).get(`/v1/groups/${groupId}/payments`).expect(200);
      expect(a.body.total).toBe(1);
      expect(b.body.total).toBe(0);
      await as(app, bob).get(`/v1/groups/${groupId}/contributions/ledger`).expect(403);
      const ledger = await as(app, treasurer).get(`/v1/groups/${groupId}/contributions/ledger`).expect(200);
      expect(ledger.body.items.find((r: { obligationId: string }) => r.obligationId === obligationId)).toMatchObject({ receivedCents: 200_000, status: 'PAID' });
      const csv = await as(app, treasurer).get(`/v1/groups/${groupId}/contributions/ledger.csv`).expect(200);
      expect(csv.text).toContain('Alice Member');
    });
  });

  it('records reversals and refuses direct ledger edits', async () => {
    const pid = await pay(treasurer, chair, bob, 30_000);
    const before = await cash();
    const rev = await as(app, chair).post(`/v1/groups/${groupId}/payments/${pid}/reverse`, { reason: 'Recorded against the wrong member' }).expect(200);
    expect(rev.body.status).toBe('REVERSED');
    expect(await cash()).toBe(before - 30_000n);
    await as(app, chair).post(`/v1/groups/${groupId}/payments/${pid}/reverse`, { reason: 'Recorded against the wrong member' }).expect(422);
    const entries = await prisma.journalEntry.findMany({ where: { paymentId: pid } });
    expect(entries.map((e) => e.type).sort()).toEqual(['CONTRIBUTION', 'REVERSAL']);
    await expect(prisma.journalLine.updateMany({ where: { entry: { paymentId: pid } }, data: { amountCents: 1n } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({ where: { groupId } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.journalEntry.create({ data: { groupId, entryDate: new Date(), type: 'ADJUSTMENT', description: 'x', lines: { create: [{ account: 'CASH', amountCents: 5n }] } } }),
    ).rejects.toThrow(/unbalanced/);
  });

  describe('loans', () => {
    let loanId: string;

    it('enforces eligibility, no self-approval, multi-approval and cash on disbursement', async () => {
      // Alice has KES 2,000 confirmed savings → 3× limit = KES 6,000.
      await as(app, alice).post(`/v1/groups/${groupId}/loans`, { principalCents: 700_000, installments: 3, purpose: 'Stock for shop' }).expect(422);
      const quote = await as(app, alice).get(`/v1/groups/${groupId}/loans/quote?principalCents=300000&installments=3`).expect(200);
      expect(quote.body).toMatchObject({ totalInterestCents: 90_000, eligibility: { eligible: true, limitCents: 600_000 } });
      const applied = await as(app, alice).post(`/v1/groups/${groupId}/loans`, { principalCents: 300_000, installments: 3, purpose: 'Stock for shop' }).expect(201);
      loanId = applied.body.id;
      expect(applied.body.status).toBe('PENDING_APPROVAL');
      await as(app, alice).post(`/v1/groups/${groupId}/loans/${loanId}/decision`, { decision: 'APPROVE' }).expect(403);
      const one = await as(app, treasurer).post(`/v1/groups/${groupId}/loans/${loanId}/decision`, { decision: 'APPROVE' }).expect(200);
      expect(one.body.status).toBe('PENDING_APPROVAL');
      await as(app, treasurer).post(`/v1/groups/${groupId}/loans/${loanId}/decision`, { decision: 'APPROVE' }).expect(409);
      const two = await as(app, chair).post(`/v1/groups/${groupId}/loans/${loanId}/decision`, { decision: 'APPROVE' }).expect(200);
      expect(two.body.status).toBe('APPROVED');
    });

    it('disburses with a generated schedule and an idempotency key', async () => {
      const key = idem();
      const body = { method: 'MPESA', reference: 'DISB001', disbursedAt: today, firstDueDate: addDays(today, 30), idempotencyKey: key };
      await as(app, alice).post(`/v1/groups/${groupId}/loans/${loanId}/disburse`, body).expect(403);
      // The group only holds KES 2,200 — it cannot lend money it does not have.
      const short = await as(app, treasurer).post(`/v1/groups/${groupId}/loans/${loanId}/disburse`, body).expect(422);
      expect(short.body.message).toMatch(/Insufficient group funds/);
      await as(app, alice).post(`/v1/groups/${groupId}/ledger/adjustments`, { amountCents: 100_000, account: 'OPENING_BALANCE', reason: 'Cash box balance carried from paper books', effectiveDate: today }).expect(403);
      await as(app, chair).post(`/v1/groups/${groupId}/ledger/adjustments`, { amountCents: 100_000, account: 'OPENING_BALANCE', reason: 'Cash box balance carried from paper books', effectiveDate: today }).expect(201);
      const before = await cash();
      const d = await as(app, treasurer).post(`/v1/groups/${groupId}/loans/${loanId}/disburse`, body).expect(200);
      expect(d.body.status).toBe('DISBURSED');
      expect(d.body.schedule).toHaveLength(3);
      expect(d.body.outstandingCents).toBe(390_000);
      await as(app, treasurer).post(`/v1/groups/${groupId}/loans/${loanId}/disburse`, body).expect(200);
      expect(await cash()).toBe(before - 300_000n);
    });

    it('applies repayments interest-first and rejects overpayment', async () => {
      await as(app, treasurer).post(`/v1/groups/${groupId}/payments`, { memberId: ids[alice.id], amountCents: 500_000, method: 'CASH', paidAt: today, idempotencyKey: idem(), purpose: 'LOAN_REPAYMENT', targetId: loanId }).expect(422);
      await pay(treasurer, chair, alice, 130_000, { purpose: 'LOAN_REPAYMENT', targetId: loanId });
      const d = await as(app, alice).get(`/v1/groups/${groupId}/loans/${loanId}`).expect(200);
      expect(d.body.paidCents).toBe(130_000);
      expect(d.body.schedule[0]).toMatchObject({ paidCents: 130_000, status: 'PAID' });
      await pay(treasurer, chair, alice, 260_000, { purpose: 'LOAN_REPAYMENT', targetId: loanId });
      const done = await as(app, alice).get(`/v1/groups/${groupId}/loans/${loanId}`).expect(200);
      expect(done.body.status).toBe('REPAID');
      const interest = await prisma.journalLine.aggregate({ where: { account: 'INTEREST_INCOME', entry: { groupId } }, _sum: { amountCents: true } });
      expect(interest._sum.amountCents).toBe(-90_000n);
    });

    it("hides other members' loans", async () => {
      await as(app, bob).get(`/v1/groups/${groupId}/loans/${loanId}`).expect(404);
      const list = await as(app, bob).get(`/v1/groups/${groupId}/loans`).expect(200);
      expect(list.body).toHaveLength(0);
    });
  });

  describe('expenses', () => {
    it('requires an independent approval before payment', async () => {
      const e = await as(app, treasurer).post(`/v1/groups/${groupId}/expenses`, { category: 'Bank charges', description: 'Ledger fees', amountCents: 10_000, incurredOn: today }).expect(201);
      await as(app, treasurer).post(`/v1/groups/${groupId}/expenses/${e.body.id}/pay`, { method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(422);
      await as(app, chair).post(`/v1/groups/${groupId}/expenses/${e.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      // Default policy needs two approvals; the recorder cannot be one of them.
      const list = await as(app, chair).get(`/v1/groups/${groupId}/expenses`).expect(200);
      expect(list.body[0]).toMatchObject({ status: 'PENDING_APPROVAL', approvalsRequired: 2 });
      await as(app, chair).patch(`/v1/groups/${groupId}`, { settings: { requiredFinancialApprovals: 1 } }).expect(200);
      const e2 = await as(app, treasurer).post(`/v1/groups/${groupId}/expenses`, { category: 'Stationery', description: 'Receipt books', amountCents: 5_000, incurredOn: today }).expect(201);
      await as(app, chair).post(`/v1/groups/${groupId}/expenses/${e2.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      const before = await cash();
      await as(app, treasurer).post(`/v1/groups/${groupId}/expenses/${e2.body.id}/pay`, { method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(200);
      expect(await cash()).toBe(before - 5_000n);
    });
  });

  describe('merry-go-round', () => {
    let cycleId: string;

    it('creates a cycle with rounds and per-round collections', async () => {
      const c = await as(app, treasurer)
        .post(`/v1/groups/${groupId}/rotations`, { name: 'MGR 2026', contributionCents: 100_000, frequency: 'WEEKLY', startDate: today, memberIdsInOrder: [ids[alice.id], ids[bob.id], ids[chair.id]], recipientContributes: true })
        .expect(201);
      cycleId = c.body.id;
      expect(c.body.rounds).toHaveLength(3);
      expect(c.body.currentRound).toMatchObject({ round: 1, recipientName: 'Alice Member', expectedCents: 300_000, status: 'COLLECTING' });
      expect(c.body.remainingRounds).toBe(3);
      const bobView = await as(app, bob).get(`/v1/groups/${groupId}/rotations/${cycleId}`).expect(200);
      expect(bobView.body.myRounds.map((r: { round: number }) => r.round)).toEqual([2]);
    });

    it('never skips rounds, blocks self-approval, requires shortfall reasons', async () => {
      const cycle = (await as(app, chair).get(`/v1/groups/${groupId}/rotations/${cycleId}`)).body;
      const [r1, r2] = cycle.rounds;
      await as(app, chair).post(`/v1/groups/${groupId}/rotations/${cycleId}/rounds/${r2.id}/approve`, {}).expect(422);
      const obligations = await prisma.contributionObligation.findMany({ where: { roundId: r1.id } });
      expect(obligations).toHaveLength(3);
      for (const o of obligations.filter((o) => o.membershipId !== ids[bob.id])) {
        const member = [alice, chair].find((u) => ids[u.id] === o.membershipId)!;
        // The chair's own payment is recorded by the chair and verified by the treasurer.
        await pay(member === chair ? chair : treasurer, member === chair ? treasurer : chair, member, 100_000, { targetId: o.id });
      }
      await as(app, alice).post(`/v1/groups/${groupId}/rotations/${cycleId}/rounds/${r1.id}/approve`, {}).expect(403);
      await as(app, chair).post(`/v1/groups/${groupId}/rotations/${cycleId}/rounds/${r1.id}/approve`, {}).expect(422); // short by Bob's share
      const approved = await as(app, chair).post(`/v1/groups/${groupId}/rotations/${cycleId}/rounds/${r1.id}/approve`, { shortfallReason: 'Bob paid late; agreed at meeting to pay out' }).expect(200);
      expect(approved.body.rounds[0]).toMatchObject({ status: 'APPROVED', shortfallCents: 100_000 });
      const before = await cash();
      const done = await as(app, treasurer).post(`/v1/groups/${groupId}/rotations/${cycleId}/rounds/${r1.id}/complete`, { method: 'MPESA', reference: 'PAYOUT1', paidAt: today, idempotencyKey: idem() }).expect(200);
      expect(done.body.rounds[0].status).toBe('COMPLETED');
      expect(await cash()).toBe(before - 200_000n);
      await as(app, treasurer).post(`/v1/groups/${groupId}/rotations/${cycleId}/close`).expect(422);
    });

    it('applies an order change only after independent approval', async () => {
      const cycle = (await as(app, chair).get(`/v1/groups/${groupId}/rotations/${cycleId}`)).body;
      const p = await as(app, treasurer).post(`/v1/groups/${groupId}/rotations/${cycleId}/reorder`, { memberIdsInOrder: [ids[chair.id], ids[bob.id]], reason: 'Bob travelling in round 2' }).expect(201);
      await as(app, treasurer).post(`/v1/groups/${groupId}/rotations/${cycleId}/changes/${p.body.changeId}/decision`, { decision: 'APPROVE' }).expect(403);
      const after = await as(app, chair).post(`/v1/groups/${groupId}/rotations/${cycleId}/changes/${p.body.changeId}/decision`, { decision: 'APPROVE' }).expect(200);
      expect(after.body.rounds.map((r: { recipientName: string }) => r.recipientName)).toEqual(['Alice Member', 'Grace Chair', 'Bob Member']);
      expect(cycle.rounds[1].recipientName).toBe('Bob Member');
    });
  });

  describe('statements', () => {
    it('reconciles: opening + inflows − outflows = closing', async () => {
      const s = await as(app, treasurer).get(`/v1/groups/${groupId}/statements/live?from=${addDays(today, -30)}&to=${today}`).expect(200);
      const b = s.body;
      const inflow = b.contributionsCents + b.loanRepaymentsCents + b.interestReceivedCents + b.finesReceivedCents + b.otherIncomeCents;
      const outflow = b.expensesCents + b.loansDisbursedCents + b.payoutsCents + b.distributionsCents;
      expect(b.openingBalanceCents + inflow - outflow).toBe(b.closingBalanceCents);
      expect(BigInt(b.closingBalanceCents)).toBe(await cash());
      expect(b.loansDisbursedCents).toBe(300_000);
      expect(b.interestReceivedCents).toBe(90_000);
      await as(app, alice).get(`/v1/groups/${groupId}/statements/live`).expect(403);
    });

    it('publishes for members without exposing names', async () => {
      const pub = await as(app, treasurer).post(`/v1/groups/${groupId}/statements/publish`, { from: addDays(today, -30), to: today }).expect(201);
      const s = await as(app, alice).get(`/v1/groups/${groupId}/statements/${pub.body.id}`).expect(200);
      expect(s.body.transactions.every((t: { memberName: string | null }) => t.memberName === null)).toBe(true);
      const pdf = await as(app, alice).get(`/v1/groups/${groupId}/statements/${pub.body.id}/pdf`).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    });

    it('consolidates a personal statement without counting loans as income', async () => {
      const s = await as(app, alice).get(`/v1/me/statement?from=${addDays(today, -30)}&to=${today}`).expect(200);
      const line = s.body.groups.find((g: { groupId: string }) => g.groupId === groupId);
      expect(line).toMatchObject({ contributionsCents: 300_000, loansReceivedCents: 300_000, loanRepaymentsCents: 300_000, interestPaidCents: 90_000, payoutsReceivedCents: 200_000, loanBalanceCents: 0 });
      const pdf = await as(app, alice).get(`/v1/me/statement/pdf`).expect(200);
      expect(pdf.body.length).toBeGreaterThan(1000);
      const dash = await as(app, alice).get('/v1/me/dashboard').expect(200);
      expect(dash.body).toMatchObject({ activeGroups: 1, payoutsReceivedCents: 200_000, outstandingLoanCents: 0 });
      const cal = await as(app, alice).get('/v1/me/calendar').expect(200);
      expect(cal.body.some((e: { kind: string }) => e.kind === 'CONTRIBUTION')).toBe(true);
    });

    it('serves CSV reports to officers only', async () => {
      for (const r of ['cashbook', 'loan-portfolio', 'income-expenditure', 'audit', 'payouts']) {
        const res = await as(app, treasurer).get(`/v1/groups/${groupId}/reports/${r}?format=csv`).expect(200);
        expect(res.headers['content-type']).toContain('text/csv');
      }
      await as(app, bob).get(`/v1/groups/${groupId}/reports/cashbook`).expect(403);
    });
  });

  describe('distributions', () => {
    it('separates retained funds and requires independent approval', async () => {
      const available = Number(await cash());
      const prev = await as(app, treasurer).post(`/v1/groups/${groupId}/distributions/preview`, { method: 'EQUAL', periodFrom: addDays(today, -30), periodTo: today, retainedCents: 10_000 }).expect(200);
      expect(prev.body.availableCashCents).toBe(available);
      expect(prev.body.distributableCents).toBe(available - 10_000);
      expect(prev.body.allocations.reduce((a: number, x: { grossCents: number }) => a + x.grossCents, 0)).toBe(available - 10_000);
      const d = await as(app, treasurer).post(`/v1/groups/${groupId}/distributions`, { title: 'Year end', method: 'CONTRIBUTION_PROPORTIONAL', periodFrom: addDays(today, -30), periodTo: today, retainedCents: 10_000 }).expect(201);
      await as(app, treasurer).post(`/v1/groups/${groupId}/distributions/${d.body.id}/decision`, { decision: 'APPROVE' }).expect(403);
      const approved = await as(app, chair).post(`/v1/groups/${groupId}/distributions/${d.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      expect(approved.body.status).toBe('APPROVED');
      const aliceAlloc = approved.body.allocations.find((a: { memberName: string }) => a.memberName === 'Alice Member');
      await as(app, treasurer).post(`/v1/groups/${groupId}/distributions/${d.body.id}/allocations/${aliceAlloc.id}/pay`, { method: 'MPESA', paidAt: today, idempotencyKey: idem() }).expect(200);
      const after = Number(await cash());
      expect(after).toBe(available - aliceAlloc.netPayableCents);
    });
  });

  describe('paper records import', () => {
    it('validates, blocks self-commit, and commits after independent review', async () => {
      const csv = 'full_name,phone,role,shares\nJane Imported,0799000111,MEMBER,2\nBad Row,12345,MEMBER,1\n';
      const bad = await as(app, treasurer).post(`/v1/groups/${groupId}/imports`, { kind: 'MEMBERS', fileName: 'register.csv', csv }).expect(201);
      expect(bad.body).toMatchObject({ status: 'HAS_ERRORS', errorCount: 1 });
      await as(app, chair).post(`/v1/groups/${groupId}/imports/${bad.body.id}/commit`).expect(422);
      const good = await as(app, treasurer).post(`/v1/groups/${groupId}/imports`, { kind: 'MEMBERS', fileName: 'register.csv', csv: 'full_name,phone,shares\nJane Imported,0799000111,2\n' }).expect(201);
      await as(app, treasurer).post(`/v1/groups/${groupId}/imports/${good.body.id}/commit`).expect(403);
      await as(app, chair).post(`/v1/groups/${groupId}/imports/${good.body.id}/commit`).expect(200);
      const loans = await as(app, treasurer).post(`/v1/groups/${groupId}/imports`, { kind: 'LOANS', fileName: 'loans.csv', csv: `phone,principal,interest,balance,disbursed_on,due_date\n0799000111,10000,1000,5500,${addDays(today, -60)},${addDays(today, 60)}\n` }).expect(201);
      expect(loans.body.status).toBe('VALIDATED');
      const before = await cash();
      await as(app, chair).post(`/v1/groups/${groupId}/imports/${loans.body.id}/commit`).expect(200);
      expect(await cash()).toBe(before); // migrated loan book does not move cash
      const loan = await prisma.loan.findFirstOrThrow({ where: { groupId, purpose: 'Imported loan' }, include: { installments: true } });
      expect(loan.installments[0]).toMatchObject({ interestPaidCents: 100_000n, principalPaidCents: 450_000n });
    });
  });

  describe('M-Pesa callbacks', () => {
    beforeAll(() => {
      process.env.MPESA_CALLBACK_TOKEN = 'cb-secret-token';
      resetEnvCache();
    });

    it('rejects callbacks without the shared token', async () => {
      await api(app).post('/v1/integrations/mpesa/stk-callback?token=wrong').send({}).expect(403);
    });

    it('confirms once, ignores duplicates and flags amount mismatches', async () => {
      const mk = async (amount: number, checkout: string) => {
        const p = await prisma.payment.create({ data: { groupId, membershipId: ids[bob.id], amountCents: BigInt(amount), method: 'MPESA', source: 'MPESA_STK', purpose: 'CONTRIBUTION', status: 'PENDING', paidAt: new Date(`${today}T00:00:00Z`), idempotencyKey: idem() } });
        await prisma.mpesaRequest.create({ data: { groupId, paymentId: p.id, checkoutRequestId: checkout, phone: '+254700000000', amountCents: BigInt(amount) } });
        return p.id;
      };
      const callback = (checkout: string, amountKes: number, receipt: string) => ({
        Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: checkout, ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'Amount', Value: amountKes }, { Name: 'MpesaReceiptNumber', Value: receipt }] } } },
      });
      const pid = await mk(150_000, 'ws_CO_1');
      const before = await cash();
      await api(app).post('/v1/integrations/mpesa/stk-callback?token=cb-secret-token').send(callback('ws_CO_1', 1500, 'RCP111')).expect(200);
      await api(app).post('/v1/integrations/mpesa/stk-callback?token=cb-secret-token').send(callback('ws_CO_1', 1500, 'RCP111')).expect(200);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: pid } })).status).toBe('CONFIRMED');
      expect(await cash()).toBe(before + 150_000n);

      const pid2 = await mk(100_000, 'ws_CO_2');
      await api(app).post('/v1/integrations/mpesa/stk-callback?token=cb-secret-token').send(callback('ws_CO_2', 10, 'RCP222')).expect(200);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: pid2 } })).status).toBe('DISPUTED');
      expect(await cash()).toBe(before + 150_000n);
    });

    it('reports STK push as unavailable when Daraja is not configured', async () => {
      await as(app, bob).post(`/v1/groups/${groupId}/payments/mpesa/stk`, { amountCents: 100_000, phone: bob.phone, idempotencyKey: idem() }).expect(503);
    });
  });

  describe('platform administration', () => {
    it('gives platform admins no implicit access to group finances; support grants are read-only and audited', async () => {
      const admin = await registerUser(app, 'Platform Admin');
      await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'SUPER_ADMIN' } });
      const overview = await as(app, admin).get('/v1/platform/overview').expect(200);
      expect(overview.body.totalGroups).toBeGreaterThanOrEqual(1);
      await as(app, alice).get('/v1/platform/overview').expect(403);
      await as(app, admin).get(`/v1/groups/${groupId}/contributions/ledger`).expect(404);

      const req = await as(app, admin).post('/v1/platform/support-access', { groupId, purpose: 'Investigate reported duplicate payment', hours: 2 }).expect(201);
      await as(app, admin).get(`/v1/groups/${groupId}/contributions/ledger`).expect(404);
      await as(app, treasurer).post(`/v1/groups/${groupId}/support-access/${req.body.id}/decision`, { decision: 'APPROVE' }).expect(403);
      await as(app, chair).post(`/v1/groups/${groupId}/support-access/${req.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      await as(app, admin).get(`/v1/groups/${groupId}/contributions/ledger`).expect(200);
      await as(app, admin).post(`/v1/groups/${groupId}/schedules`, { name: 'x', amountCents: 100, frequency: 'MONTHLY', startDate: today }).expect(404);
      const audited = await prisma.auditEvent.count({ where: { groupId, action: 'support.access' } });
      expect(audited).toBeGreaterThan(0);
    });
  });
});
