import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, as, createGroupWith, createTestApp, registerUser, resetDatabase, uniquePhone } from './helpers';
import { testOtpOutbox } from '../src/modules/auth/otp.service';

describe('Auth, groups and group-scoped authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
  });
  afterAll(async () => app.close());

  it('registers, blocks unverified users, verifies via OTP', async () => {
    const u = await registerUser(app, 'Wanjiku Kamau', { verify: false });
    await as(app, u).get('/v1/groups').expect(403);
    await as(app, u).get('/v1/me').expect(200);
    await as(app, u).post('/v1/auth/verify-phone', { code: '000000' }).expect(400);
    const code = testOtpOutbox.get(`${u.phone}:VERIFY_PHONE`);
    const res = await as(app, u).post('/v1/auth/verify-phone', { code }).expect(200);
    expect(res.body.phoneVerified).toBe(true);
    await as(app, u).get('/v1/groups').expect(200);
  });

  it('refuses common passwords and passwords built from the person’s own details', async () => {
    const phone = uniquePhone();
    const common = await api(app).post('/v1/auth/register').send({ fullName: 'Pass Word', phone, password: 'Password2026!' }).expect(400);
    expect(JSON.stringify(common.body)).toMatch(/too common/);
    const digits = phone.replace(/\D/g, '').slice(-9);
    const own = await api(app).post('/v1/auth/register').send({ fullName: 'Own Number', phone, password: `Pin${digits}x` }).expect(422);
    expect(own.body.message).toMatch(/phone number/);
    await api(app).post('/v1/auth/register').send({ fullName: 'Good Choice', phone, password: 'mango-taxi-river-42' }).expect(201);
  });

  it('rejects duplicate phone and wrong password; locks after repeated failures', async () => {
    const u = await registerUser(app, 'Otieno Ouma');
    await api(app).post('/v1/auth/register').send({ fullName: 'X Y Z', phone: u.phone, password: 'Kahawa-Tamu-2026' }).expect(409);
    for (let i = 0; i < 5; i++) await api(app).post('/v1/auth/login').send({ phone: u.phone, password: 'wrong' }).expect(401);
    await api(app).post('/v1/auth/login').send({ phone: u.phone, password: 'Kahawa-Tamu-2026' }).expect(403);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const u = await registerUser(app, 'Achieng Atieno');
    const r1 = await api(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
    await api(app).post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    // Reuse of the old token revoked the session, so the new token is dead too.
    await api(app).post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await api(app).get('/v1/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(401);
  });

  it('resets password with OTP and revokes sessions', async () => {
    const u = await registerUser(app, 'Kiprono Kirui');
    await api(app).post('/v1/auth/otp/request').send({ phone: u.phone, purpose: 'RESET_PASSWORD' }).expect(200);
    const code = testOtpOutbox.get(`${u.phone}:RESET_PASSWORD`);
    await api(app).post('/v1/auth/password/reset').send({ phone: u.phone, code, newPassword: 'Mango-River-77' }).expect(200);
    await as(app, u).get('/v1/me').expect(401);
    await api(app).post('/v1/auth/login').send({ phone: u.phone, password: 'Mango-River-77' }).expect(200);
    // The account holder is told, without any code or link in the message.
    const notices = await prisma.notification.findMany({ where: { userId: u.id, type: 'SECURITY' } });
    expect(notices.map((n) => n.title)).toContain('Your password was reset');
    for (const n of notices) expect(n.body).not.toMatch(/\d{6}|https?:/);
  });

  it('one account, different roles in different groups, no cross-group permissions', async () => {
    const alice = await registerUser(app, 'Alice Njeri');
    const bob = await registerUser(app, 'Bob Mwangi');
    const outsider = await registerUser(app, 'Carol Wambui');
    const g1 = await createGroupWith(app, alice, [{ user: bob, role: 'TREASURER' }]);
    const g2 = await createGroupWith(app, bob, [{ user: alice, role: 'MEMBER' }], { name: 'Second Chama' });

    const aliceGroups = await as(app, alice).get('/v1/groups').expect(200);
    expect(aliceGroups.body.map((g: { role: string }) => g.role).sort()).toEqual(['CHAIRPERSON', 'MEMBER']);

    // Alice is chair of g1 but only a member of g2: cannot invite or reconfigure there.
    await as(app, alice).patch(`/v1/groups/${g2.groupId}`, { name: 'Hijacked' }).expect(403);
    await as(app, alice).post(`/v1/groups/${g2.groupId}/invitations`, { phone: outsider.phone }).expect(403);
    await as(app, alice).get(`/v1/groups/${g2.groupId}/overview`).expect(403);
    await as(app, alice).patch(`/v1/groups/${g1.groupId}`, { name: 'Renamed Chama' }).expect(200);

    // Non-members cannot even see the group.
    await as(app, outsider).get(`/v1/groups/${g1.groupId}`).expect(404);

    // Members cannot see each other's financial profiles.
    await as(app, alice).get(`/v1/groups/${g2.groupId}/members/${g2.membershipIds[bob.id]}`).expect(403);
    await as(app, alice).get(`/v1/groups/${g2.groupId}/members/me`).expect(200);
  });

  it('protects the last chairperson and requires a chair to appoint a chair', async () => {
    const chair = await registerUser(app, 'Daniel Kiptoo');
    const sec = await registerUser(app, 'Esther Chebet');
    const g = await createGroupWith(app, chair, [{ user: sec, role: 'SECRETARY' }]);
    await as(app, chair)
      .patch(`/v1/groups/${g.groupId}/members/${g.membershipIds[chair.id]}/role`, { role: 'MEMBER', reason: 'Stepping down' })
      .expect(422);
    await as(app, sec)
      .patch(`/v1/groups/${g.groupId}/members/${g.membershipIds[sec.id]}/role`, { role: 'CHAIRPERSON', reason: 'Self promotion' })
      .expect(403);
  });

  it('joins with an invite code and records audit events', async () => {
    const chair = await registerUser(app, 'Faith Mutua');
    const joiner = await registerUser(app, 'George Kariuki');
    const g = await createGroupWith(app, chair, []);
    const detail = await as(app, chair).get(`/v1/groups/${g.groupId}`).expect(200);
    await as(app, joiner).post('/v1/invitations/join-code', { code: detail.body.inviteCode }).expect(200);
    await as(app, joiner).post('/v1/invitations/join-code', { code: detail.body.inviteCode }).expect(409);
    const events = await prisma.auditEvent.findMany({ where: { groupId: g.groupId } });
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['group.created', 'member.joined_with_code']));
  });
});
