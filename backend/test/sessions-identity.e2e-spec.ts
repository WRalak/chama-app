import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { testOtpOutbox } from '../src/modules/auth/otp.service';
import { api, as, createGroupWith, createStaff, createTestApp, MEMBER_PASSWORD, registerUser, resetDatabase, testPassword } from './helpers';

/** Password storage, account suspension, session expiry and revocation, recovery replay, export auditing. */
describe('Identity and sessions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
  });
  afterAll(() => app.close());

  const login = (phone: string, password: string) => api(app).post('/v1/auth/login').send({ phone, password });

  it('stores new passwords with scrypt and upgrades old bcrypt hashes at sign-in', async () => {
    const u = await registerUser(app, 'Hash Check');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toMatch(/^scrypt\$15\$8\$1\$/);
    const legacy = testPassword();
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(legacy, 10) } });
    await login(u.phone, legacy).expect(200);
    const upgraded = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash;
    expect(upgraded).toMatch(/^scrypt\$/);
    await login(u.phone, legacy).expect(200);
  });

  it('uses every character of a long passphrase (bcrypt would ignore all after 72 bytes)', async () => {
    const u = await registerUser(app, 'Long Phrase');
    const stem = `${'river taxi mango '.repeat(5)}${testPassword()}`; // > 72 bytes
    await as(app, u).post('/v1/auth/password/change', { currentPassword: MEMBER_PASSWORD, newPassword: `${stem} first 1` }).expect(200);
    await login(u.phone, `${stem} other 2`).expect(401);
    await login(u.phone, `${stem} first 1`).expect(200);
  });

  it('a suspended account loses access at once and its status is not revealed without the password', async () => {
    const u = await registerUser(app, 'Suspend Me');
    await as(app, u).get('/v1/me').expect(200);
    await prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    await as(app, u).get('/v1/me').expect(403);
    await api(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    await login(u.phone, 'wrong-password-1').expect(401); // same answer as any wrong password
    await login(u.phone, MEMBER_PASSWORD).expect(403);
  });

  it('expired and signed-out sessions stop working, for the access and the refresh token', async () => {
    const a = await registerUser(app, 'Expired Session');
    const sessionA = await prisma.session.findFirstOrThrow({ where: { userId: a.id, revokedAt: null } });
    await prisma.session.update({ where: { id: sessionA.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await as(app, a).get('/v1/me').expect(401);
    await api(app).post('/v1/auth/refresh').send({ refreshToken: a.refreshToken }).expect(401);

    const b = await registerUser(app, 'Signed Out');
    await as(app, b).post('/v1/auth/logout').expect((r) => expect(r.status).toBeLessThan(300));
    await as(app, b).get('/v1/me').expect(401);
    await api(app).post('/v1/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
  });

  it('a password-reset code works once', async () => {
    const u = await registerUser(app, 'Reset Once');
    await api(app).post('/v1/auth/otp/request').send({ phone: u.phone, purpose: 'RESET_PASSWORD' }).expect(200);
    const code = testOtpOutbox.get(`${u.phone}:RESET_PASSWORD`);
    await api(app).post('/v1/auth/password/reset').send({ phone: u.phone, code, newPassword: testPassword() }).expect(200);
    const replay = await api(app).post('/v1/auth/password/reset').send({ phone: u.phone, code, newPassword: testPassword() });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('support can sign a member out of every device, only with the permission, and it is audited', async () => {
    const u = await registerUser(app, 'Taken Over');
    const owner = await createStaff(app, prisma, 'Sec Owner', ['OWNER']);
    const analyst = await createStaff(app, prisma, 'Sec Analyst', ['ANALYST']);
    await as(app, analyst).post(`/v1/platform/users/${u.id}/revoke-sessions`, { reason: 'Reported lost phone' }).expect(403);
    await as(app, u).post(`/v1/platform/users/${u.id}/revoke-sessions`, { reason: 'Member token' }).expect(401);
    const r = await as(app, owner).post(`/v1/platform/users/${u.id}/revoke-sessions`, { reason: 'Member reported a lost phone' }).expect(200);
    expect(r.body.revoked).toBeGreaterThanOrEqual(1);
    await as(app, u).get('/v1/me').expect(401);
    await api(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    expect(await prisma.platformAuditLog.count({ where: { action: 'platform.user_sessions_revoked', targetId: u.id } })).toBe(1);
  });

  it('records every financial export before sending it, never caches it, and records nothing when refused', async () => {
    const chair = await registerUser(app, 'Export Chair');
    const member = await registerUser(app, 'Export Member');
    const { groupId } = await createGroupWith(app, chair, [{ user: member, role: 'MEMBER' }]);
    const g = `/v1/groups/${groupId}`;
    const count = () => prisma.auditEvent.count({ where: { groupId, action: 'export.downloaded' } });

    const csv = await as(app, chair).get(`${g}/contributions/ledger.csv`).expect(200);
    expect(csv.headers['cache-control']).toMatch(/no-store/);
    expect(await count()).toBe(1);
    await as(app, chair).get(`${g}/reports/cashbook?format=csv`).expect(200);
    const afterReport = await count();
    await as(app, chair).get(`${g}/reports/cashbook`); // screen view: not an export
    expect(await count()).toBe(afterReport);

    await as(app, member).get(`${g}/contributions/ledger.csv`).expect(403);
    expect(await count()).toBe(afterReport);
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { groupId, action: 'export.downloaded' }, orderBy: { createdAt: 'asc' } });
    expect(row).toMatchObject({ actorUserId: chair.id, entityType: 'Export' });
  });
});
