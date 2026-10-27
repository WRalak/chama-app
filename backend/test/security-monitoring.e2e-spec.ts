import { INestApplication, Logger } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, as, createGroupWith, createTestApp, registerUser, resetDatabase } from './helpers';

/** Patterns of denied requests raise a reviewable alert in the staff audit log; events carry no secrets. */
describe('Security monitoring', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const lines: string[] = [];
  /** Alerts are written in the background; give them a moment. */
  const settle = () => new Promise((r) => setTimeout(r, 300));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    for (const level of ['log', 'warn'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(function (this: Logger, message: unknown) {
        lines.push(String(message));
      });
    }
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('flags a member who keeps requesting another group’s records', async () => {
    const prober = await registerUser(app, 'Curious Member');
    const victim = await registerUser(app, 'Other Chair');
    const { groupId: other } = await createGroupWith(app, victim, []);
    const { groupId: own } = await createGroupWith(app, prober, []);
    const otherPayments = await prisma.payment.findMany({ where: { groupId: other }, take: 1 });
    for (let i = 0; i < 26; i++) {
      await as(app, prober).get(`/v1/groups/${i % 2 ? other : own}/payments/${otherPayments[0]?.id ?? `c${i}notarealid000000000000`}/history`);
    }
    await settle();
    const alerts = await prisma.platformAuditLog.findMany({ where: { action: 'security.alert.cross_tenant_probing', targetId: prober.id } });
    expect(alerts).toHaveLength(1); // one alert per window, not one per request
    expect(alerts[0].outcome).toBe('FAILURE');
    // Security events name the route template, never the ids in the URL.
    const events = lines.filter((l) => l.includes('"securityEvent":"authz.not_found"'));
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((l) => l.includes(other))).toBe(true); // groupId is recorded as a field
    expect(events.every((l) => l.includes('/v1/groups/:groupId/payments/:paymentId/history'))).toBe(true);
  });

  it('flags many failed token checks from one address, without logging the tokens', async () => {
    // Built at run time: a token-shaped string with a signature nobody issued.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'HS256' })}.${b64({ sub: 'x', sid: 'y' })}.forged-signature-value`;
    for (let i = 0; i < 50; i++) await api(app).get('/v1/me').set('Authorization', `Bearer ${forged}${i}`);
    await settle();
    expect(await prisma.platformAuditLog.count({ where: { action: 'security.alert.credential_stuffing' } })).toBe(1);
    expect(lines.some((l) => l.includes('forged-signature-value'))).toBe(false);
  });

  it('never writes one-time codes to the log when SMS is not configured', () => {
    const sms = lines.filter((l) => l.startsWith('[dev, not sent]'));
    expect(sms.length).toBeGreaterThan(0); // sign-ups above sent verification codes
    expect(sms.some((l) => /\b\d{6}\b/.test(l))).toBe(false);
  });
});
