import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetEnvCache } from '../src/config/env';
import { DarajaClient } from '../src/modules/mpesa/daraja.client';
import { MpesaService, STK_LIMITS } from '../src/modules/mpesa/mpesa.service';
import { api, as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const today = todayInNairobi();
const TOKEN = 'payments-integrity-callback-token';

/**
 * M-Pesa callbacks are not signed. These tests prove a callback alone cannot post money: the
 * outcome must be confirmed with Safaricom (STK query), duplicates and races post once, and
 * STK prompts are capped so they cannot be used against someone else's phone.
 */
describe('Payment integrity: M-Pesa confirmation, duplicates, races and abuse limits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let daraja: DarajaClient;
  let mpesa: MpesaService;
  let chair: TestUser, bob: TestUser;
  let groupId: string;
  let ids: Record<string, string>;
  let query: jest.SpyInstance;

  const cash = async () => (await prisma.journalLine.aggregate({ where: { account: 'CASH', entry: { groupId } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0n;
  const entriesFor = (paymentId: string) => prisma.journalEntry.count({ where: { paymentId } });
  const callback = (checkout: string, amountKes: number, receipt: string) => ({
    Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: checkout, ResultCode: 0, ResultDesc: 'The service request is processed successfully.', CallbackMetadata: { Item: [{ Name: 'Amount', Value: amountKes }, { Name: 'MpesaReceiptNumber', Value: receipt }] } } },
  });
  const send = (body: unknown) => api(app).post(`/v1/integrations/mpesa/stk-callback?token=${TOKEN}`).send(body as object);
  let seq = 0;
  async function stkRequest(amountCents: number) {
    const checkout = `ws_CO_test_${++seq}_${Date.now()}`;
    const p = await prisma.payment.create({ data: { groupId, membershipId: ids[bob.id], amountCents: BigInt(amountCents), method: 'MPESA', source: 'MPESA_STK', purpose: 'CONTRIBUTION', status: 'PENDING', paidAt: new Date(`${today}T00:00:00Z`), idempotencyKey: idem() } });
    await prisma.mpesaRequest.create({ data: { groupId, paymentId: p.id, checkoutRequestId: checkout, phone: bob.phone, amountCents: BigInt(amountCents) } });
    return { paymentId: p.id, checkout };
  }

  beforeAll(async () => {
    process.env.MPESA_CALLBACK_TOKEN = TOKEN;
    resetEnvCache();
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    chair = await registerUser(app, 'Grace Chair');
    bob = await registerUser(app, 'Bob Member');
    ({ groupId, membershipIds: ids } = await createGroupWith(app, chair, [{ user: bob, role: 'MEMBER' }]));
    daraja = app.get(DarajaClient);
    mpesa = app.get(MpesaService);
    // Pretend Daraja is configured; every Safaricom call is scripted per test.
    jest.spyOn(daraja, 'configured', 'get').mockReturnValue(true);
    query = jest.spyOn(daraja, 'stkQuery');
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('does not post a "success" callback that M-Pesa does not confirm (forged callback)', async () => {
    query.mockResolvedValue({ state: 'FAILED', resultCode: '1032', resultDesc: 'Request cancelled by user' });
    const { paymentId, checkout } = await stkRequest(150_000);
    const before = await cash();
    await send(callback(checkout, 1500, 'FORGED0001')).expect(200);
    expect(query).toHaveBeenCalledWith(checkout);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('FAILED');
    expect(await cash()).toBe(before);
    expect(await prisma.auditEvent.count({ where: { action: 'mpesa.callback_not_confirmed', entityId: paymentId } })).toBe(1);
  });

  it('holds a callback while M-Pesa is unreachable, then posts once when the retry confirms it', async () => {
    const { paymentId, checkout } = await stkRequest(200_000);
    const before = await cash();
    query.mockResolvedValue({ state: 'PENDING', resultCode: null, resultDesc: 'M-Pesa could not be reached' });
    await send(callback(checkout, 2000, 'HOLD000001')).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
    expect(await cash()).toBe(before);

    query.mockResolvedValue({ state: 'SUCCESS', resultCode: '0', resultDesc: 'Processed' });
    await mpesa.retryUnconfirmed(0);
    await mpesa.retryUnconfirmed(0); // a second run finds nothing left to do
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('CONFIRMED');
    expect(await cash()).toBe(before + 200_000n);
    expect(await entriesFor(paymentId)).toBe(1);
  });

  it('posts once when the same confirmed callback arrives 10 times at once', async () => {
    query.mockResolvedValue({ state: 'SUCCESS', resultCode: '0', resultDesc: 'Processed' });
    const { paymentId, checkout } = await stkRequest(300_000);
    const before = await cash();
    const results = await Promise.all(Array.from({ length: 10 }, () => send(callback(checkout, 3000, 'RACE000001'))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await entriesFor(paymentId)).toBe(1);
    expect(await cash()).toBe(before + 300_000n);
  });

  it('refuses a receipt number already used by another payment, and amount manipulation', async () => {
    query.mockResolvedValue({ state: 'SUCCESS', resultCode: '0', resultDesc: 'Processed' });
    const first = await stkRequest(100_000);
    await send(callback(first.checkout, 1000, 'REUSE00001')).expect(200);
    const before = await cash();
    const second = await stkRequest(100_000);
    await send(callback(second.checkout, 1000, 'REUSE00001')).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } })).status).toBe('PENDING');
    const third = await stkRequest(500_000);
    await send(callback(third.checkout, 5, 'SMALL00001')).expect(200); // KES 5 sent for a KES 5,000 request
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: third.paymentId } })).status).toBe('DISPUTED');
    expect(await cash()).toBe(before);
  });

  it('caps STK prompts per phone number, and does not reuse another member’s request key', async () => {
    let n = 0;
    jest.spyOn(daraja, 'stkPush').mockImplementation(async () => ({ checkoutRequestId: `ws_CO_cap_${++n}_${Date.now()}`, merchantRequestId: null, customerMessage: 'ok' }));
    await prisma.mpesaRequest.deleteMany({ where: { phone: bob.phone } }); // earlier tests created requests to this phone
    const stk = (key = idem()) => as(app, bob).post(`/v1/groups/${groupId}/payments/mpesa/stk`, { amountCents: 100_000, phone: bob.phone, idempotencyKey: key });
    for (let i = 0; i < STK_LIMITS.perPhonePerHour; i++) await stk().expect(201);
    await stk().expect(429);
    // The chairperson cannot read Bob's request by replaying its idempotency key.
    const key = (await prisma.payment.findFirstOrThrow({ where: { membershipId: ids[bob.id], source: 'MPESA_STK' } })).idempotencyKey!;
    await as(app, chair).post(`/v1/groups/${groupId}/payments/mpesa/stk`, { amountCents: 100_000, phone: chair.phone, idempotencyKey: key }).expect(409);
  });
});
