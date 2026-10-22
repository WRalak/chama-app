import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { BillingService } from '../src/modules/billing/billing.service';
import { EntitlementService } from '../src/modules/billing/entitlements.service';
import { SandboxProvider } from '../src/modules/billing/providers/sandbox.provider';
import { PaystackProvider } from '../src/modules/billing/providers/paystack.provider';
import { MpesaBillingProvider } from '../src/modules/billing/providers/mpesa.provider';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();

/**
 * ChamaHub's own subscription billing: entitlements enforced on the server, verified payments
 * only, duplicate and forged webhooks, refunds, renewals and grace, promotions, revenue,
 * currency integrity and least-privilege administration.
 */
describe('Subscriptions and billing', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let billing: BillingService;
  let entitlements: EntitlementService;
  let sandbox: SandboxProvider;
  let chair: TestUser, treasurer: TestUser, member: TestUser, otherChair: TestUser;
  let support: TestUser, platformAdmin: TestUser, finance: TestUser, superAdmin: TestUser;
  let A: string, B: string;
  let ids: Record<string, string>;
  const g = (groupId: string, p: string) => `/v1/groups/${groupId}/${p}`;

  /** Moves a group's subscription without waiting for real time to pass. */
  async function setSub(groupId: string, data: Record<string, unknown>) {
    await prisma.subscription.update({ where: { groupId }, data });
    entitlements.invalidate(groupId);
  }

  function webhook(body: Buffer, signature: string) {
    return api(app).post('/v1/billing/webhooks/sandbox').set('Content-Type', 'application/json').set('x-sandbox-signature', signature).send(body.toString('utf8'));
  }

  /** Starts a sandbox checkout and completes it through a signed webhook confirmed by the status API. */
  async function pay(groupId: string, user: TestUser, planCode: string, interval: 'MONTH' | 'YEAR' = 'MONTH') {
    const r = await as(app, user).post(g(groupId, 'billing/checkout'), { planCode, interval, provider: 'SANDBOX', idempotencyKey: idem() }).expect(201);
    if (r.body.payment.status === 'SUCCEEDED') return r.body.payment;
    sandbox.settle(r.body.payment.reference, 'SUCCEEDED');
    const hook = sandbox.signedWebhook({ id: `evt_${r.body.payment.reference}`, type: 'charge.updated', reference: r.body.payment.reference });
    await webhook(hook.body, hook.signature).expect(200);
    return (await as(app, user).get(g(groupId, `billing/payments/${r.body.payment.id}`)).expect(200)).body;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    billing = app.get(BillingService);
    entitlements = app.get(EntitlementService);
    sandbox = app.get(SandboxProvider);
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Chair Wanjiru');
    treasurer = await registerUser(app, 'Treasurer Otieno');
    member = await registerUser(app, 'Member Akinyi');
    otherChair = await registerUser(app, 'Other Chair');
    support = await registerUser(app, 'Support Sam');
    platformAdmin = await registerUser(app, 'Platform Pat');
    finance = await registerUser(app, 'Finance Faith');
    superAdmin = await registerUser(app, 'Super Sue');
    for (const [u, role] of [[support, 'SUPPORT'], [platformAdmin, 'PLATFORM_ADMIN'], [finance, 'FINANCE'], [superAdmin, 'SUPER_ADMIN']] as const) await prisma.user.update({ where: { id: u.id }, data: { platformRole: role } });
    ({ groupId: A, membershipIds: ids } = await createGroupWith(app, chair, [{ user: treasurer, role: 'TREASURER' }, { user: member, role: 'MEMBER' }], { name: 'Billing Chama' }));
    ({ groupId: B } = await createGroupWith(app, otherChair, [], { name: 'Other Chama' }));
  });
  afterAll(() => app.close());

  describe('plans and entitlements', () => {
    it('starts new groups on a trial of the configured plan; members see the plan, officers see billing', async () => {
      const m = (await as(app, member).get(g(A, 'billing')).expect(200)).body;
      expect(m.access).toMatchObject({ planCode: 'PREMIUM', source: 'TRIAL' });
      expect(m.canManage).toBe(false);
      expect(m.payments).toEqual([]);
      expect(m.providers).toEqual([]);
      const t = (await as(app, treasurer).get(g(A, 'billing')).expect(200)).body;
      expect(t.canManage).toBe(true);
      expect(t.providers.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['SANDBOX', 'MANUAL']));
      const plans = (await as(app, member).get(g(A, 'billing/plans')).expect(200)).body;
      expect(plans.map((p: { code: string }) => p.code)).toEqual(['FREE', 'STARTER', 'STANDARD', 'PREMIUM']);
      expect(plans.find((p: { code: string }) => p.code === 'STARTER').prices).toEqual(expect.arrayContaining([{ interval: 'MONTH', currency: 'KES', amountMinor: 50000 }]));
      await as(app, member).get(g(B, 'billing')).expect(404);
    });

    it('blocks paid features on Free with 402 and the plan that unlocks them, while every record stays readable', async () => {
      await setSub(A, { trialEndsAt: new Date(Date.now() - 1000) });
      await billing.lifecycle();
      const s = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } });
      expect(s.status).toBe('EXPIRED');
      const ai = await as(app, member).post(g(A, 'ai/chat'), { message: 'How much do I owe?' }).expect(402);
      expect(ai.body.details).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', feature: 'ai_assistant', currentPlan: 'FREE', requiredPlan: 'PREMIUM' });
      expect((await as(app, member).post(g(A, 'loans'), { principalCents: 100_000, installments: 2, purpose: 'School fees' }).expect(402)).body.details.requiredPlan).toBe('STARTER');
      await as(app, treasurer).post(g(A, 'statement-imports/preview'), { fileName: 'x.csv', csv: 'Date,Amount\n' }).expect(402);
      await as(app, treasurer).post(g(A, 'reminders/contributions'), {}).expect(402);
      // A member without the permission is told "not your role", not offered an upgrade.
      await as(app, member).post(g(A, 'reminders/contributions'), {}).expect(403);
      // Essential records: never gated.
      await as(app, treasurer).get(g(A, 'contributions/ledger')).expect(200);
      await as(app, member).get(g(A, 'statements')).expect(200);
      await as(app, member).get('/v1/me/statement').expect(200);
      await as(app, treasurer).get(g(A, 'reports/cashbook')).expect((r) => expect([200, 404]).toContain(r.status));
      await as(app, member).post(g(A, 'ai/tools/get_my_financial_summary'), {}).expect(200);
      const notes = await prisma.notification.findMany({ where: { type: 'BILLING', groupId: A } });
      expect(notes.length).toBeGreaterThanOrEqual(2); // chair and treasurer told the trial ended; ordinary members not
      expect(notes.every((n) => n.userId !== member.id)).toBe(true);
    });

    it('enforces the member limit, counting pending invitations', async () => {
      const free = await prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      const original = free.entitlements;
      await as(app, superAdmin).put('/v1/platform/plans/FREE', { code: 'FREE', name: 'Free', tier: 0, entitlements: { features: [], limits: { maxMembers: 4 } }, active: true, isPublic: true }).expect(200);
      const extra = await registerUser(app, 'Extra Person');
      await as(app, chair).post(g(A, 'invitations'), { phone: extra.phone, role: 'MEMBER' }).expect(201); // 3 members + 1 pending = 4
      const over = await registerUser(app, 'One Too Many');
      const r = await as(app, chair).post(g(A, 'invitations'), { phone: over.phone, role: 'MEMBER' }).expect(402);
      expect(r.body.details).toMatchObject({ code: 'MEMBER_LIMIT', limit: 4 });
      await prisma.plan.update({ where: { code: 'FREE' }, data: { entitlements: original as object } });
      entitlements.invalidate();
    });
  });

  describe('checkout and verified payments', () => {
    it('only billing managers of the group can start a checkout, and the same request key never charges twice', async () => {
      const body = { planCode: 'STARTER', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() };
      await as(app, member).post(g(A, 'billing/checkout'), body).expect(403);
      await as(app, otherChair).post(g(A, 'billing/checkout'), body).expect(404);
      const first = (await as(app, treasurer).post(g(A, 'billing/checkout'), body).expect(201)).body;
      expect(first.payment).toMatchObject({ status: 'PENDING', amountMinor: 50000, currency: 'KES', provider: 'SANDBOX', livemode: false, purpose: 'NEW' });
      expect(first.payment.reference).toMatch(/^CHB-[0-9A-F]{10}$/);
      const again = (await as(app, treasurer).post(g(A, 'billing/checkout'), body).expect(201)).body;
      expect(again.payment.id).toBe(first.payment.id);
      await as(app, treasurer).post(g(A, 'billing/checkout'), { ...body, idempotencyKey: idem(), planCode: 'FREE' }).expect(422);
      await as(app, treasurer).post(g(A, 'billing/checkout'), { ...body, idempotencyKey: idem(), provider: 'PAYSTACK' }).expect(422); // not enabled/configured
    });

    it('authenticates real providers\' webhooks: Paystack HMAC-SHA512, M-Pesa secret callback token', async () => {
      const paystack = app.get(PaystackProvider);
      const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 42, reference: 'CHB-ABC', customer: { email: 'x@y.z', phone: '+254700000000' }, authorization: { last4: '4242' } } }));
      const sig = createHmac('sha512', 'sk_test_chamahub_dummy_key').update(body).digest('hex');
      const [e] = paystack.parseWebhook({ rawBody: body, headers: { 'x-paystack-signature': sig }, query: {} });
      expect(e).toMatchObject({ eventId: 'charge.success:42', reference: 'CHB-ABC', livemode: false });
      expect(JSON.stringify(e.payload)).not.toMatch(/x@y\.z|254700000000|4242/); // personal and card data never stored
      expect(() => paystack.parseWebhook({ rawBody: Buffer.from(body.toString().replace('42', '43')), headers: { 'x-paystack-signature': sig }, query: {} })).toThrow();
      const mpesa = app.get(MpesaBillingProvider);
      const cb = Buffer.from(JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_1', ResultCode: 0, CallbackMetadata: { Item: [{ Name: 'PhoneNumber', Value: 254700000001 }, { Name: 'MpesaReceiptNumber', Value: 'SAB1234XYZ' }] } } } }));
      expect(() => mpesa.parseWebhook({ rawBody: cb, headers: {}, query: { token: 'wrong' } })).toThrow();
      const [m] = mpesa.parseWebhook({ rawBody: cb, headers: {}, query: { token: 'test-billing-webhook-token-0123456789' } });
      expect(m.eventId).toBe('ws_CO_1:0');
      expect(JSON.stringify(m.payload)).not.toContain('254700000001');
      expect(mpesa.receiptFromPayload(m.payload)).toBe('SAB1234XYZ');
      // Unconfigured providers are never offered at checkout.
      expect(mpesa.configured()).toBe(false);
    });

    it('rejects forged webhooks and records the attempt', async () => {
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'STARTER', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      sandbox.settle(r.payment.reference, 'SUCCEEDED');
      const hook = sandbox.signedWebhook({ id: 'evt_forged', type: 'charge.updated', reference: r.payment.reference }, 'wrong-secret');
      await webhook(hook.body, hook.signature).expect(400);
      expect(await prisma.billingEvent.count({ where: { provider: 'SANDBOX', signatureValid: false } })).toBeGreaterThan(0);
      expect((await prisma.billingPayment.findUniqueOrThrow({ where: { id: r.payment.id } })).status).toBe('PENDING');
      sandbox.settle(r.payment.reference, 'CANCELLED');
      await billing.reconcile(r.payment.id);
    });

    it('activates only after the provider status API confirms, exactly once despite duplicate webhooks', async () => {
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'STARTER', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      sandbox.settle(r.payment.reference, 'SUCCEEDED');
      const hook = sandbox.signedWebhook({ id: 'evt_dup_1', type: 'charge.updated', reference: r.payment.reference });
      await webhook(hook.body, hook.signature).expect(200);
      await webhook(hook.body, hook.signature).expect(200);
      await billing.reconcile(r.payment.id); // the reconciliation job finding it again changes nothing
      const p = await prisma.billingPayment.findUniqueOrThrow({ where: { id: r.payment.id } });
      expect(p.status).toBe('SUCCEEDED');
      expect(p.receiptNumber).toMatch(/^CHB-R-\d{4}-\d{6}$/);
      expect(await prisma.billingEvent.count({ where: { providerEventId: 'evt_dup_1' } })).toBe(1);
      expect(await prisma.subscriptionEvent.count({ where: { paymentId: p.id, type: 'activated' } })).toBe(1);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A }, include: { plan: true } });
      expect(sub).toMatchObject({ status: 'ACTIVE', interval: 'MONTH', currency: 'KES' });
      expect(sub.plan.code).toBe('STARTER');
      expect(Number(sub.amountMinor)).toBe(50000);
      expect(sub.currentPeriodEnd!.getTime() - sub.currentPeriodStart!.getTime()).toBeGreaterThan(27 * 86_400_000);
      // Starter unlocks loans but not the AI assistant.
      await as(app, member).post(g(A, 'loans'), { principalCents: 100_000, installments: 2, purpose: 'School fees' }).expect((x) => expect(x.status).not.toBe(402));
      await as(app, member).post(g(A, 'ai/chat'), { message: 'Hi' }).expect(402);
      const receipt = (await as(app, treasurer).get(g(A, `billing/payments/${p.id}/receipt`)).expect(200)).body;
      expect(receipt).toMatchObject({ receiptNumber: p.receiptNumber, amountMinor: 50000, currency: 'KES', livemode: false });
      await as(app, member).get(g(A, `billing/payments/${p.id}/receipt`)).expect(403);
    });

    it('does not trust a webhook that claims success when the provider says it failed', async () => {
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'STARTER', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      sandbox.settle(r.payment.reference, 'FAILED');
      const hook = sandbox.signedWebhook({ id: 'evt_lie', type: 'charge.updated', reference: r.payment.reference, status: 'SUCCEEDED' });
      await webhook(hook.body, hook.signature).expect(200);
      const p = await prisma.billingPayment.findUniqueOrThrow({ where: { id: r.payment.id } });
      expect(p.status).toBe('FAILED');
      expect(p.receiptNumber).toBeNull();
    });

    it('holds a payment whose confirmed amount does not match, and opens a case', async () => {
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'STARTER', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      sandbox.settle(r.payment.reference, 'SUCCEEDED', { amountMinor: 100 });
      await billing.reconcile(r.payment.id);
      expect((await prisma.billingPayment.findUniqueOrThrow({ where: { id: r.payment.id } })).status).toBe('PENDING');
      expect(await prisma.billingCase.count({ where: { paymentId: r.payment.id, priority: 'HIGH' } })).toBe(1);
      sandbox.settle(r.payment.reference, 'CANCELLED');
      await billing.reconcile(r.payment.id);
    });

    it('credits unused time when upgrading', async () => {
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'PREMIUM', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      expect(r.payment.purpose).toBe('UPGRADE');
      expect(r.payment.creditMinor).toBeGreaterThan(40000);
      expect(r.payment.creditMinor).toBeLessThanOrEqual(50000);
      expect(r.payment.amountMinor).toBe(200000 - r.payment.creditMinor);
      sandbox.settle(r.payment.reference, 'SUCCEEDED');
      await billing.reconcile(r.payment.id);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { groupId: A }, include: { plan: true } })).plan.code).toBe('PREMIUM');
      await as(app, member).post(g(A, 'ai/chat'), { message: 'Hi' }).expect((x) => expect(x.status).not.toBe(402));
    });
  });

  describe('plan changes, renewals and expiry', () => {
    it('schedules downgrades and cancellations for the period end, and can undo them', async () => {
      const ch = (await as(app, treasurer).post(g(A, 'billing/change-plan'), { planCode: 'STARTER', interval: 'MONTH' }).expect(200)).body;
      expect(ch.effectiveAt).toBeDefined();
      const s = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A }, include: { plan: true } });
      expect(s.plan.code).toBe('PREMIUM'); // nothing changes until the period ends
      expect(s.scheduledPlanId).not.toBeNull();
      await as(app, treasurer).post(g(A, 'billing/cancel'), { reason: 'Trying it out' }).expect(200);
      const cancelled = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } });
      expect(cancelled).toMatchObject({ cancelAtPeriodEnd: true, scheduledPlanId: null, status: 'ACTIVE' });
      await as(app, member).post(g(A, 'billing/cancel'), {}).expect(403);
      await as(app, treasurer).post(g(A, 'billing/resume'), {}).expect(200);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } })).cancelAtPeriodEnd).toBe(false);
    });

    it('reminds before renewal, keeps features through the grace period, then drops to Free with records intact', async () => {
      await setSub(A, { currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000) });
      await billing.lifecycle();
      expect((await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } })).remindersSent).toEqual(expect.arrayContaining([7, 3]));
      expect(await prisma.notification.count({ where: { groupId: A, type: 'BILLING', title: { contains: 'renews soon' } } })).toBeGreaterThan(0);

      await setSub(A, { currentPeriodEnd: new Date(Date.now() - 60_000) });
      await billing.lifecycle();
      let s = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } });
      expect(s.status).toBe('PAST_DUE');
      expect(s.graceEndsAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      expect((await as(app, member).get(g(A, 'billing')).expect(200)).body.access).toMatchObject({ planCode: 'PREMIUM', source: 'GRACE' });

      // A failed renewal attempt is recorded and the officers are told.
      const r = (await as(app, treasurer).post(g(A, 'billing/checkout'), { planCode: 'PREMIUM', interval: 'MONTH', provider: 'SANDBOX', idempotencyKey: idem() }).expect(201)).body;
      expect(r.payment.purpose).toBe('RENEWAL');
      const before = await prisma.subscriptionEvent.count({ where: { groupId: A, type: 'renewal_payment_failed' } });
      await as(app, treasurer).post(g(A, `billing/payments/${r.payment.id}/simulate`), { outcome: 'FAILED' }).expect(200);
      expect(await prisma.subscriptionEvent.count({ where: { groupId: A, type: 'renewal_payment_failed' } })).toBe(before + 1);

      await setSub(A, { graceEndsAt: new Date(Date.now() - 60_000) });
      await billing.lifecycle();
      s = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } });
      expect(s.status).toBe('EXPIRED');
      await as(app, member).post(g(A, 'ai/chat'), { message: 'Hi' }).expect(402);
      await as(app, treasurer).get(g(A, 'contributions/ledger')).expect(200);
      await as(app, treasurer).get(g(A, 'billing/payments')).expect(200); // billing history stays too
    });

    it('renews an expired group with a new paid period', async () => {
      const p = await pay(A, treasurer, 'STANDARD', 'YEAR');
      expect(p.status).toBe('SUCCEEDED');
      const s = await prisma.subscription.findUniqueOrThrow({ where: { groupId: A }, include: { plan: true } });
      expect(s).toMatchObject({ status: 'ACTIVE', interval: 'YEAR' });
      expect(s.currentPeriodEnd!.getTime() - Date.now()).toBeGreaterThan(360 * 86_400_000);
    });
  });

  describe('platform administration', () => {
    it('lets only finance refund; a full refund ends the period it paid for', async () => {
      const paid = await prisma.billingPayment.findFirstOrThrow({ where: { groupId: A, status: 'SUCCEEDED', interval: 'YEAR' } });
      const body = { amountMinor: Number(paid.amountMinor), reason: 'Customer asked within 7 days' };
      await as(app, support).post(`/v1/platform/billing/payments/${paid.id}/refund`, body).expect(403);
      await as(app, platformAdmin).post(`/v1/platform/billing/payments/${paid.id}/refund`, body).expect(403);
      await as(app, finance).post(`/v1/platform/billing/payments/${paid.id}/refund`, { ...body, amountMinor: Number(paid.amountMinor) + 1 }).expect(422);
      await as(app, finance).post(`/v1/platform/billing/payments/${paid.id}/refund`, { amountMinor: 100_000, reason: 'Partial goodwill refund' }).expect(201);
      expect((await prisma.billingPayment.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('PARTIALLY_REFUNDED');
      expect((await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } })).status).toBe('ACTIVE');
      await as(app, finance).post(`/v1/platform/billing/payments/${paid.id}/refund`, { amountMinor: Number(paid.amountMinor) - 100_000, reason: 'Rest of the refund' }).expect(201);
      const after = await prisma.billingPayment.findUniqueOrThrow({ where: { id: paid.id } });
      expect(after).toMatchObject({ status: 'REFUNDED' });
      expect(Number(after.refundedMinor)).toBe(Number(paid.amountMinor));
      expect((await prisma.subscription.findUniqueOrThrow({ where: { groupId: A } })).status).toBe('EXPIRED');
      expect(await prisma.subscriptionEvent.count({ where: { groupId: A, type: 'access_revoked_by_refund' } })).toBe(1);
      await as(app, member).post(g(A, 'loans'), { principalCents: 100_000, installments: 2, purpose: 'School fees' }).expect(402);
    });

    it('grants and revokes promotional access with a reason and an audit trail', async () => {
      const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
      await as(app, support).post(`/v1/platform/billing/groups/${B}/promotions`, { planCode: 'PREMIUM', endsAt, reason: 'Pilot partner' }).expect(403);
      await as(app, platformAdmin).post(`/v1/platform/billing/groups/${B}/promotions`, { planCode: 'PREMIUM', endsAt, reason: 'x' }).expect(400);
      const promo = (await as(app, platformAdmin).post(`/v1/platform/billing/groups/${B}/promotions`, { planCode: 'PREMIUM', endsAt, reason: 'Pilot partner programme' }).expect(201)).body;
      await setSub(B, { status: 'EXPIRED', trialEndsAt: new Date(Date.now() - 1000) });
      expect((await as(app, otherChair).get(g(B, 'billing')).expect(200)).body.access).toMatchObject({ planCode: 'PREMIUM', source: 'PROMOTION' });
      expect(await prisma.auditEvent.count({ where: { groupId: B, action: 'platform.promotion_granted', reason: 'Pilot partner programme' } })).toBe(1);
      await as(app, platformAdmin).post(`/v1/platform/billing/groups/${B}/promotions/${promo.id}/revoke`, { reason: 'Pilot ended early' }).expect(200);
      expect((await as(app, otherChair).get(g(B, 'billing')).expect(200)).body.access.planCode).toBe('FREE');
      expect(await prisma.subscriptionEvent.count({ where: { groupId: B, type: { in: ['promotion_granted', 'promotion_revoked'] } } })).toBe(2);
    });

    it('applies least privilege across platform roles and never opens group finances', async () => {
      await as(app, support).get('/v1/platform/billing/groups').expect(200);
      await as(app, support).get('/v1/platform/revenue').expect(403);
      await as(app, support).put('/v1/platform/plans/STARTER', {}).expect(403);
      await as(app, platformAdmin).get('/v1/platform/revenue').expect(403);
      await as(app, platformAdmin).post('/v1/platform/finance/costs', { category: 'AI', description: 'x', currency: 'USD', amountMinor: 1, incurredOn: today }).expect(403);
      await as(app, finance).get('/v1/platform/revenue').expect(200);
      await as(app, finance).put('/v1/platform/regions/UG', { countryCode: 'UG', name: 'Uganda', defaultCurrency: 'UGX', defaultTimezone: 'Africa/Kampala', defaultLocale: 'en-UG', available: true, billingAvailable: false }).expect(403);
      await as(app, member).get('/v1/platform/billing/groups').expect(403);
      for (const staff of [support, platformAdmin, finance, superAdmin]) await as(app, staff).get(g(A, 'contributions/ledger')).expect(404);
      const detail = (await as(app, platformAdmin).get(`/v1/platform/billing/groups/${A}`).expect(200)).body;
      expect(detail.events.length).toBeGreaterThan(5);
      expect(JSON.stringify(detail)).not.toMatch(/journal|ledger|contributionsCents|loanBalance/i);
    });

    it('keeps regions closed until their currency is launch-ready and a provider is enabled', async () => {
      const ug = { countryCode: 'UG', name: 'Uganda', defaultCurrency: 'UGX', defaultTimezone: 'Africa/Kampala', defaultLocale: 'en-UG', available: true, billingAvailable: false };
      await as(app, superAdmin).put('/v1/platform/regions/UG', ug).expect(409);
      await as(app, chair).post('/v1/groups', { name: 'Kampala Savers', type: 'SAVINGS', countryCode: 'UG' }).expect(422);
      await as(app, chair).post('/v1/groups', { name: 'Dollar Savers', type: 'STOKVEL', currency: 'USD' }).expect(422);
      const made = (await as(app, chair).post('/v1/groups', { name: 'Stokvel Nairobi', type: 'STOKVEL' }).expect(201)).body;
      expect(await prisma.group.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ countryCode: 'KE', currency: 'KES', timezone: 'Africa/Nairobi', type: 'STOKVEL' });
    });
  });

  describe('money integrity', () => {
    it('stamps the group currency on every money record and locks it once records exist', async () => {
      const p = await as(app, treasurer).post(g(A, 'payments'), { memberId: ids[member.id], amountCents: 150_050, method: 'MPESA', reference: 'SBILL0001X', paidAt: today, idempotencyKey: idem() }).expect(201);
      const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } });
      expect(row.currency).toBe('KES');
      expect(Number(row.amountCents)).toBe(150_050);
      await as(app, chair).patch(g(A, ''), { currency: 'USD' }).expect((r) => expect([409, 422]).toContain(r.status));
      await expect(prisma.$executeRawUnsafe(`UPDATE groups SET currency = 'USD' WHERE id = '${A}'`)).rejects.toThrow(/currency_locked/);
      await expect(prisma.$executeRawUnsafe(`INSERT INTO payments (id, "groupId", "amountCents", method, purpose, "paidAt", "idempotencyKey", currency, "updatedAt") VALUES ('raw1', '${A}', 100, 'CASH', 'CONTRIBUTION', CURRENT_DATE, 'raw-1', 'USD', now())`)).resolves.toBe(1);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: 'raw1' } })).currency).toBe('KES'); // the database overrides any other currency
    });

    it('never lets billing history be edited or deleted', async () => {
      const p = await prisma.billingPayment.findFirstOrThrow({ where: { groupId: A, status: 'REFUNDED' } });
      await expect(prisma.$executeRawUnsafe(`UPDATE billing_payments SET "amountMinor" = 1, "priceMinor" = 1 WHERE id = '${p.id}'`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM billing_payments WHERE id = '${p.id}'`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM billing_events`)).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`UPDATE subscription_events SET reason = 'edited'`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE billing_refunds SET "amountMinor" = 1`)).rejects.toThrow(/append-only/);
    });

    it('reports revenue from verified payments only, per currency, and never consolidates without a rate', async () => {
      const live = (await as(app, finance).get('/v1/platform/revenue?livemode=live').expect(200)).body;
      expect(live.cash.gross).toEqual([]); // sandbox payments are test mode: never revenue
      const test = (await as(app, finance).get('/v1/platform/revenue?livemode=test').expect(200)).body;
      const paid = await prisma.billingPayment.findMany({ where: { livemode: false, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'] }, amountMinor: { gt: 0 } } });
      const gross = paid.reduce((a, p) => a + Number(p.amountMinor), 0);
      expect(test.cash.gross).toEqual([{ currency: 'KES', amountMinor: gross }]);
      const refunded = paid.reduce((a, p) => a + Number(p.refundedMinor), 0);
      expect(test.cash.refunds).toEqual([{ currency: 'KES', amountMinor: refunded }]);
      expect(test.pending.count).toBe(await prisma.billingPayment.count({ where: { livemode: false, status: 'PENDING' } }));

      await as(app, finance).post('/v1/platform/finance/costs', { category: 'INFRASTRUCTURE', description: 'Hosting October', currency: 'USD', amountMinor: 4_999, incurredOn: today }).expect(201);
      let r = (await as(app, finance).get('/v1/platform/revenue?livemode=live').expect(200)).body;
      expect(r.consolidated.costs.complete).toBe(false);
      expect(r.consolidated.missingRates).toEqual(['USD']);
      await as(app, finance).post('/v1/platform/finance/exchange-rates', { baseCurrency: 'USD', quoteCurrency: 'KES', rate: '129.45', asOf: today, source: 'Central Bank of Kenya indicative rate' }).expect(201);
      await as(app, finance).post('/v1/platform/finance/exchange-rates', { baseCurrency: 'USD', quoteCurrency: 'KES', rate: '130', asOf: today, source: 'duplicate' }).expect(409);
      r = (await as(app, finance).get('/v1/platform/revenue?livemode=live').expect(200)).body;
      expect(r.consolidated.costs).toEqual({ amountMinor: 647_121, complete: true }); // US$ 49.99 × 129.45 = KSh 6,471.2055 → 6,471.21
      expect(r.consolidated.conversions).toEqual([{ from: 'USD', to: 'KES', rate: '129.45', asOf: today, source: 'Central Bank of Kenya indicative rate' }].map((c) => ({ ...c, rate: expect.stringMatching(/^129\.45/) })));
      expect(r.consolidated.estimatedOperatingProfit.amountMinor).toBe(r.consolidated.cashNet.amountMinor - 647_121);
    });

    it('exports a member’s own data and nobody else’s', async () => {
      const res = await as(app, member).get('/v1/me/export').expect(200);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="chamahub-my-data-/);
      expect(res.body.profile.id).toBe(member.id);
      expect(res.body.payments.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain(treasurer.phone);
    });
  });
});
