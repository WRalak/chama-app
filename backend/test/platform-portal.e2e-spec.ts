import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffContext } from '../src/common/request';
import { testStaffMailbox, StaffMailerService } from '../src/modules/platform-auth/staff-mailer.service';
import { bootstrapOwner } from '../src/modules/platform-auth/staff-bootstrap';
import { totpAt } from '../src/modules/platform-auth/staff-crypto';
import { StaffService } from '../src/modules/platform/staff.service';
import { api, as, createGroupWith, createStaff, createTestApp, registerUser, resetDatabase, STAFF_PASSWORD, StaffUser, TestUser } from './helpers';

const GOOD_PASSWORD = 'Correct-Horse-42-battery';
const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
const lastMailTo = (email: string) => [...testStaffMailbox].reverse().find((m) => m.to === email);
const login = (app: INestApplication, email: string, password: string) => api(app).post('/v1/platform/auth/login').send({ email, password });

describe('Platform administration portal', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: StaffUser;
  let admin: StaffUser;
  let helper: StaffUser;
  let chair: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let A: string;
  let B: string;
  /** Every secret used in this suite: none may ever appear in the audit log. */
  const secrets: string[] = [STAFF_PASSWORD, GOOD_PASSWORD];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    testStaffMailbox.length = 0;
    owner = await createStaff(app, prisma, 'Olivia Owner', ['OWNER']);
    admin = await createStaff(app, prisma, 'Adam Admin', ['PLATFORM_ADMIN']);
    helper = await createStaff(app, prisma, 'Hana Helper', ['SUPPORT_HELPER']);
    chair = await registerUser(app, 'Chair Wanjiru');
    member = await registerUser(app, 'Member Akinyi');
    outsider = await registerUser(app, 'Outsider Otieno');
    ({ groupId: A } = await createGroupWith(app, chair, [{ user: member, role: 'MEMBER' }], { name: 'Portal Chama' }));
    ({ groupId: B } = await createGroupWith(app, outsider, [], { name: 'Other Chama' }));
  });
  afterAll(() => app.close());

  describe('owner bootstrap', () => {
    it('needs explicit configuration, sets no password, works once, and cannot add owners later', async () => {
      // A fresh database: no staff at all.
      await prisma.$transaction([prisma.$executeRawUnsafe('SET LOCAL session_replication_role = replica'), prisma.$executeRawUnsafe('TRUNCATE platform_accounts CASCADE')]);
      expect(await bootstrapOwner(prisma, {})).toMatchObject({ ok: false });
      expect(await bootstrapOwner(prisma, { email: 'not-an-email', fullName: 'X' })).toMatchObject({ ok: false });

      const first = await bootstrapOwner(prisma, { email: 'Founder@Example.com', fullName: 'Fatuma Founder' });
      if (!first.ok) throw new Error(first.reason);
      const account = await prisma.platformAccount.findUniqueOrThrow({ where: { email: 'founder@example.com' } });
      expect(account).toMatchObject({ status: 'INVITED', passwordHash: null });
      // Re-running before setup replaces the link (the old one stops working)…
      const again = await bootstrapOwner(prisma, { email: 'founder@example.com', fullName: 'Fatuma Founder' });
      if (!again.ok) throw new Error(again.reason);
      expect(await bootstrapOwner(prisma, { email: 'someone-else@example.com', fullName: 'Intruder' })).toMatchObject({ ok: false });
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token: tokenFrom(first.setupUrl), password: GOOD_PASSWORD }).expect(400);
      // …and the owner chooses their own password.
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token: tokenFrom(again.setupUrl), password: 'short' }).expect(400);
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token: tokenFrom(again.setupUrl), password: GOOD_PASSWORD }).expect(200);
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token: tokenFrom(again.setupUrl), password: GOOD_PASSWORD }).expect(400); // single use
      const res = await login(app, 'founder@example.com', GOOD_PASSWORD).expect(200);
      expect(res.body.me.roles.map((r: { code: string }) => r.code)).toEqual(['OWNER']);

      // Disabled after first use.
      expect(await bootstrapOwner(prisma, { email: 'second@example.com', fullName: 'Second Owner' })).toMatchObject({ ok: false });
      expect(await prisma.platformAuditLog.count({ where: { action: 'platform.owner_bootstrap', outcome: 'DENIED' } })).toBeGreaterThan(0);

      // Put the suite's staff back.
      owner = await createStaff(app, prisma, 'Olivia Owner', ['OWNER']);
      admin = await createStaff(app, prisma, 'Adam Admin', ['PLATFORM_ADMIN']);
      helper = await createStaff(app, prisma, 'Hana Helper', ['SUPPORT_HELPER']);
    });
  });

  describe('sign-in', () => {
    it('blocks unauthenticated callers, member tokens and forged tokens from every portal route', async () => {
      for (const path of ['/v1/platform/dashboard', '/v1/platform/staff', '/v1/platform/support/cases', '/v1/platform/audit', '/v1/platform/auth/me']) {
        await api(app).get(path).expect(401);
        await as(app, chair).get(path).expect(401);
      }
      // A token signed with the member key, shaped like a staff token, is still rejected.
      const forged = await app.get(JwtService).signAsync({ sub: owner.id, sid: 'x', typ: 'platform' });
      await as(app, { token: forged }).get('/v1/platform/auth/me').expect(401);
    });

    it('uses one generic message for every failure and locks the account after repeated failures', async () => {
      const unknown = await login(app, 'nobody@example.com', 'whatever-password-1').expect(401);
      const wrong = await login(app, helper.email, 'wrong-password-123').expect(401);
      expect(unknown.body.message).toBe(wrong.body.message);
      for (let i = 0; i < 4; i++) await login(app, helper.email, 'wrong-password-123').expect(401);
      // Locked: even the right password fails, with the same message.
      const locked = await login(app, helper.email, STAFF_PASSWORD).expect(401);
      expect(locked.body.message).toBe(wrong.body.message);
      expect(await prisma.platformAuditLog.count({ where: { action: 'platform.login', outcome: 'FAILURE', actorLabel: helper.email } })).toBeGreaterThanOrEqual(6);
      expect(await prisma.platformAuditLog.count({ where: { action: 'platform.account_locked', targetId: helper.id } })).toBe(1);
      await prisma.platformAccount.update({ where: { id: helper.id }, data: { lockedUntil: null } });
      helper.token = (await login(app, helper.email, STAFF_PASSWORD).expect(200)).body.tokens.accessToken;
    });

    it('never returns password hashes, and records logins and logouts', async () => {
      const me = await as(app, owner).get('/v1/platform/auth/me').expect(200);
      const staff = await as(app, owner).get('/v1/platform/staff').expect(200);
      for (const body of [me.text, staff.text]) {
        expect(body).not.toMatch(/scrypt\$|passwordHash|mfaSecret/);
      }
      const extra = await createStaff(app, prisma, 'Logout Lena', ['ANALYST']);
      await as(app, extra).post('/v1/platform/auth/logout').expect(200);
      await as(app, extra).get('/v1/platform/auth/me').expect(401);
      expect(await prisma.platformAuditLog.count({ where: { actorAccountId: extra.id, action: { in: ['platform.login', 'platform.logout'] }, outcome: 'SUCCESS' } })).toBe(2);
    });

    it('rotates refresh tokens and refuses a reused one', async () => {
      const s = await createStaff(app, prisma, 'Refresh Rita', ['ANALYST']);
      const r1 = await api(app).post('/v1/platform/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
      expect(r1.body.refreshToken).not.toBe(s.refreshToken);
      await api(app).post('/v1/platform/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
      // A member refresh token is not a staff refresh token.
      await api(app).post('/v1/platform/auth/refresh').send({ refreshToken: member.refreshToken }).expect(401);
    });

    it('supports optional two-step sign-in (TOTP)', async () => {
      const s = await createStaff(app, prisma, 'Mfa Musa', ['ANALYST']);
      const { secret } = (await as(app, s).post('/v1/platform/auth/mfa/setup').expect(200)).body;
      await as(app, s).post('/v1/platform/auth/mfa/enable', { code: '000000' }).expect(400);
      await as(app, s).post('/v1/platform/auth/mfa/enable', { code: totpAt(secret, Math.floor(Date.now() / 30_000)) }).expect(200);
      const first = (await login(app, s.email, STAFF_PASSWORD).expect(200)).body;
      expect(first).toMatchObject({ mfaRequired: true });
      expect(first.tokens).toBeUndefined();
      await api(app).post('/v1/platform/auth/login/mfa').send({ mfaToken: first.mfaToken, code: '123456' }).expect(401);
      const done = await api(app).post('/v1/platform/auth/login/mfa').send({ mfaToken: first.mfaToken, code: totpAt(secret, Math.floor(Date.now() / 30_000)) }).expect(200);
      expect(done.body.tokens.accessToken).toBeTruthy();
      // The secret is encrypted at rest.
      const row = await prisma.platformAccount.findUniqueOrThrow({ where: { id: s.id } });
      expect(row.mfaSecret).not.toContain(secret);
    });

    it('resets a forgotten password with a single-use, expiring link and ends existing sessions', async () => {
      const s = await createStaff(app, prisma, 'Reset Rose', ['ANALYST']);
      const unknown = await api(app).post('/v1/platform/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
      const known = await api(app).post('/v1/platform/auth/forgot-password').send({ email: s.email }).expect(200);
      expect(unknown.body).toEqual(known.body); // no account discovery
      const token = tokenFrom(lastMailTo(s.email)!.text);
      secrets.push(token);
      const stored = await prisma.platformPasswordReset.findFirstOrThrow({ where: { accountId: s.id, usedAt: null } });
      expect(stored.tokenHash).not.toBe(token);
      await api(app).post('/v1/platform/auth/reset-password').send({ token, password: 'weak' }).expect(400);
      await api(app).post('/v1/platform/auth/reset-password').send({ token, password: GOOD_PASSWORD }).expect(200);
      await api(app).post('/v1/platform/auth/reset-password').send({ token, password: GOOD_PASSWORD }).expect(400);
      await as(app, s).get('/v1/platform/auth/me').expect(401);
      await login(app, s.email, STAFF_PASSWORD).expect(401);
      await login(app, s.email, GOOD_PASSWORD).expect(200);

      // Expired links do not work.
      await api(app).post('/v1/platform/auth/forgot-password').send({ email: s.email }).expect(200);
      const t2 = tokenFrom(lastMailTo(s.email)!.text);
      secrets.push(t2);
      await prisma.platformPasswordReset.updateMany({ where: { accountId: s.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await api(app).post('/v1/platform/auth/reset-password').send({ token: t2, password: 'Another-Good-Pass-9' }).expect(400);
    });
  });

  describe('helpers', () => {
    let invitedId: string;

    it('invites a helper by e-mail; the helper sets their own password through a single-use link', async () => {
      const res = await as(app, owner).post('/v1/platform/staff', { fullName: 'Nia New', email: 'Nia.New@Example.com', roleCodes: ['SUPPORT_HELPER'] }).expect(201);
      expect(res.body.delivery).toEqual({ sent: true });
      expect(res.body.inviteUrl).toBeUndefined();
      expect(res.body.account).toMatchObject({ email: 'nia.new@example.com', status: 'INVITED', invitation: 'PENDING' });
      invitedId = res.body.account.id;
      const token = tokenFrom(lastMailTo('nia.new@example.com')!.text);
      secrets.push(token);
      expect((await prisma.platformInvitation.findFirstOrThrow({ where: { accountId: invitedId } })).tokenHash).not.toBe(token);
      expect((await api(app).get(`/v1/platform/auth/invitation?token=${token}`).expect(200)).body).toMatchObject({ email: 'nia.new@example.com' });
      await login(app, 'nia.new@example.com', GOOD_PASSWORD).expect(401); // no password yet
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token, password: GOOD_PASSWORD }).expect(200);
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token, password: GOOD_PASSWORD }).expect(400);
      await login(app, 'nia.new@example.com', GOOD_PASSWORD).expect(200);
      await as(app, owner).post('/v1/platform/staff', { fullName: 'Nia Again', email: 'nia.new@example.com', roleCodes: ['SUPPORT_HELPER'] }).expect(409);
    });

    it('when e-mail fails, shows the inviter a one-time link instead and never logs it', async () => {
      const mailer = app.get(StaffMailerService);
      const spy = jest.spyOn(mailer, 'send').mockResolvedValueOnce({ sent: false, error: 'E-mail is not configured on this server (EMAIL_WEBHOOK_URL).' });
      const res = await as(app, owner).post('/v1/platform/staff', { fullName: 'Offline Omar', email: 'omar@example.com', roleCodes: ['ANALYST'] }).expect(201);
      spy.mockRestore();
      expect(res.body.delivery.sent).toBe(false);
      expect(res.body.delivery.error).toMatch(/not configured/);
      expect(res.body.inviteUrl).toMatch(/\/platform\/accept-invite\?token=/);
      secrets.push(tokenFrom(res.body.inviteUrl));
      // Resending revokes that link.
      await as(app, owner).post(`/v1/platform/staff/${res.body.account.id}/resend-invite`).expect(200);
      await api(app).get(`/v1/platform/auth/invitation?token=${tokenFrom(res.body.inviteUrl)}`).expect(400);
      secrets.push(tokenFrom(lastMailTo('omar@example.com')!.text));
    });

    it('expired invitations do not work', async () => {
      const res = await as(app, owner).post('/v1/platform/staff', { fullName: 'Late Lulu', email: 'lulu@example.com', roleCodes: ['ANALYST'] }).expect(201);
      const token = tokenFrom(lastMailTo('lulu@example.com')!.text);
      secrets.push(token);
      await prisma.platformInvitation.updateMany({ where: { accountId: res.body.account.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await api(app).post('/v1/platform/auth/accept-invitation').send({ token, password: GOOD_PASSWORD }).expect(400);
      expect((await as(app, owner).get(`/v1/platform/staff/${res.body.account.id}`).expect(200)).body.invitation).toBe('EXPIRED');
    });

    it('prevents privilege escalation: nobody grants what they lack, admins cannot create admins or owners', async () => {
      // Helpers cannot manage staff at all.
      await as(app, helper).get('/v1/platform/staff').expect(403);
      await as(app, helper).post('/v1/platform/staff', { fullName: 'X Y', email: 'x@example.com', roleCodes: ['SUPPORT_HELPER'] }).expect(403);
      // Platform admins can add helpers and analysts…
      await as(app, admin).post('/v1/platform/staff', { fullName: 'Hired Helper', email: 'hired@example.com', roleCodes: ['SUPPORT_HELPER'] }).expect(201);
      // …but not administrators, owners, or anything they do not hold.
      await as(app, admin).post('/v1/platform/staff', { fullName: 'Peer Admin', email: 'peer@example.com', roleCodes: ['PLATFORM_ADMIN'] }).expect(403);
      await as(app, admin).post('/v1/platform/staff', { fullName: 'New Owner', email: 'own@example.com', roleCodes: ['OWNER'] }).expect(403);
      await as(app, admin).post('/v1/platform/staff', { fullName: 'Rev Viewer', email: 'rev@example.com', roleCodes: ['SUPPORT_HELPER'], extraPermissions: ['platform.view_revenue'] }).expect(403);
      // Nobody changes their own access.
      await as(app, admin).put(`/v1/platform/staff/${admin.id}/access`, { roleCodes: ['OWNER'], reason: 'Promote myself please' }).expect(403);
      await as(app, owner).put(`/v1/platform/staff/${owner.id}/access`, { roleCodes: ['ANALYST'], reason: 'Demote myself please' }).expect(403);
      // Admins cannot touch an owner.
      await as(app, admin).post(`/v1/platform/staff/${owner.id}/suspend`, { reason: 'Hostile takeover' }).expect(403);
      // Roles: only with manage_roles, never the owner role, never beyond your own permissions.
      await as(app, admin).put('/v1/platform/roles', { code: 'SUPER_HELPER', name: 'Super helper', permissions: ['platform.support', 'platform.view_revenue'] }).expect(403);
      await as(app, owner).put('/v1/platform/roles', { code: 'OWNER', name: 'Owner', permissions: ['platform.support'] }).expect(403);
      const role = await as(app, owner).put('/v1/platform/roles', { code: 'TRIAGE', name: 'Triage', permissions: ['platform.support', 'platform.support_manage'] }).expect(200);
      expect(role.body).toMatchObject({ code: 'TRIAGE', system: false });
      // The client cannot send itself permissions: they are read from the database each request.
      await as(app, helper).get('/v1/platform/dashboard').set('X-Platform-Permissions', 'platform.view_stats').expect(403);
      expect(await prisma.platformAuditLog.count({ where: { actorAccountId: helper.id, action: 'platform.permission_denied', outcome: 'DENIED' } })).toBeGreaterThan(0);
    });

    it('suspends a helper immediately (sessions end), and reactivates them', async () => {
      const s = await createStaff(app, prisma, 'Sus Pendo', ['SUPPORT_HELPER']);
      await as(app, s).get('/v1/platform/support/cases').expect(200);
      await as(app, owner).post(`/v1/platform/staff/${s.id}/suspend`, { reason: 'Left the company' }).expect(200);
      await as(app, s).get('/v1/platform/support/cases').expect(401);
      await api(app).post('/v1/platform/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
      await login(app, s.email, STAFF_PASSWORD).expect(401);
      await as(app, owner).post(`/v1/platform/staff/${s.id}/reactivate`, { reason: 'Came back' }).expect(200);
      const again = (await login(app, s.email, STAFF_PASSWORD).expect(200)).body.tokens.accessToken;
      // Revoking sessions also takes effect at once.
      await as(app, owner).post(`/v1/platform/staff/${s.id}/revoke-sessions`, { reason: 'Lost laptop' }).expect(200);
      await as(app, { token: again }).get('/v1/platform/support/cases').expect(401);
      // Access changes apply on the next request, without signing in again.
      const fresh = (await login(app, s.email, STAFF_PASSWORD).expect(200)).body.tokens.accessToken;
      await as(app, { token: fresh }).get('/v1/platform/dashboard').expect(403);
      await as(app, owner).put(`/v1/platform/staff/${s.id}/access`, { roleCodes: ['ANALYST'], reason: 'Moved to analytics' }).expect(200);
      await as(app, { token: fresh }).get('/v1/platform/dashboard').expect(200);
      // Temporary staff stop working when their end date passes.
      await prisma.platformAccount.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await as(app, { token: fresh }).get('/v1/platform/dashboard').expect(401);
    });

    it('always keeps at least one active owner', async () => {
      const staff = app.get(StaffService);
      const ownerId = owner.id;
      // Remove every other owner the suite created, so `owner` is the only active one.
      const others = await prisma.platformAccount.findMany({ where: { id: { not: ownerId }, roles: { some: { role: { code: 'OWNER' } } } } });
      await prisma.platformAccount.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'DEACTIVATED' } });
      const someoneElse: StaffContext = { accountId: 'another-owner', sessionId: 's', fullName: 'Another Owner', email: 'a@x', roleCodes: ['OWNER'], permissions: (await as(app, owner).get('/v1/platform/auth/me')).body.permissions, isOwner: true };
      await expect(staff.setStatus(someoneElse, ownerId, 'SUSPENDED', 'Testing last owner', {})).rejects.toThrow(/last active owner/);
      await expect(staff.setAccess(someoneElse, ownerId, { roleCodes: ['ANALYST'], extraPermissions: [], reason: 'Testing last owner' }, {})).rejects.toThrow(/last active owner/);
      // With a second active owner, one can be removed.
      const second = await createStaff(app, prisma, 'Second Owner', ['OWNER']);
      await as(app, owner).post(`/v1/platform/staff/${second.id}/suspend`, { reason: 'Rotation of duties' }).expect(200);
      expect((await as(app, owner).get('/v1/platform/auth/me').expect(200)).body.roles[0].code).toBe('OWNER');
    });
  });

  describe('support cases', () => {
    let caseId: string;

    it('lets members open cases only for their own groups and read only their own cases', async () => {
      await as(app, member).post('/v1/me/support-cases', { subject: 'Wrong group', category: 'OTHER', description: 'Trying to attach a group I am not in.', groupId: B }).expect(404);
      const c = await as(app, member).post('/v1/me/support-cases', { subject: 'Contribution missing', category: 'CONTRIBUTIONS_PAYMENTS', description: 'My KES 1,000 contribution from Monday is not showing.', groupId: A }).expect(201);
      expect(c.body.number).toMatch(/^CH-\d{6}$/);
      caseId = c.body.id;
      await as(app, outsider).get(`/v1/me/support-cases/${caseId}`).expect(404);
      // Staff tokens are not member tokens.
      await as(app, admin).get('/v1/me/support-cases').expect(401);
    });

    it('routes cases: helpers see only what is assigned to them', async () => {
      expect((await as(app, helper).get('/v1/platform/support/cases').expect(200)).body.items).toEqual([]);
      await as(app, helper).get(`/v1/platform/support/cases/${caseId}`).expect(404);
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/assign`, { accountId: helper.id }).expect(403);
      const queue = (await as(app, admin).get('/v1/platform/support/cases?scope=unassigned').expect(200)).body.items;
      expect(queue.map((c: { id: string }) => c.id)).toContain(caseId);
      await as(app, admin).post(`/v1/platform/support/cases/${caseId}/assign`, { accountId: helper.id }).expect(200);
      const mine = (await as(app, helper).get('/v1/platform/support/cases').expect(200)).body.items;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ status: 'ASSIGNED', assignedTo: { id: helper.id } });
    });

    it('runs the helper workflow: note, clarification, escalation, resolution; users never see notes', async () => {
      const detail = (await as(app, helper).get(`/v1/platform/support/cases/${caseId}`).expect(200)).body;
      expect(detail.financialGuidance).toMatch(/cannot change contributions/i);
      expect(detail.requester.phoneMasked).not.toBe(member.phone);
      expect(detail.group).not.toHaveProperty('balance');
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/notes`, { body: 'INTERNAL: treasurer may have recorded it under the wrong member.' }).expect(201);
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/reply`, { body: 'Thanks. What was the M-Pesa confirmation code?', requestClarification: true }).expect(201);
      let mine = (await as(app, member).get(`/v1/me/support-cases/${caseId}`).expect(200)).body;
      expect(mine.status).toBe('WAITING_FOR_USER');
      expect(mine.messages.map((m: { from: string }) => m.from)).toEqual(['YOU', 'CHAMAHUB']);
      expect(JSON.stringify(mine)).not.toContain('INTERNAL');
      expect(JSON.stringify(await as(app, member).get('/v1/me/support-cases').expect(200).then((r) => r.body))).not.toContain('INTERNAL');
      expect(await prisma.notification.count({ where: { userId: member.id, type: 'SUPPORT' } })).toBe(1);

      await as(app, member).post(`/v1/me/support-cases/${caseId}/messages`, { body: 'It was QJK12345XY.' }).expect(201);
      expect((await as(app, helper).get(`/v1/platform/support/cases/${caseId}`).expect(200)).body.status).toBe('IN_PROGRESS');
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/priority`, { priority: 'URGENT' }).expect(403);
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/escalate`, { reason: 'Needs a treasurer to check the record' }).expect(200);
      await as(app, helper).post(`/v1/platform/support/cases/${caseId}/status`, { status: 'RESOLVED' }).expect(400); // needs a summary
      const resolved = await as(app, helper).post(`/v1/platform/support/cases/${caseId}/status`, { status: 'RESOLVED', resolution: 'Explained how the treasurer re-assigns the payment; group officers corrected it.' }).expect(200);
      expect(resolved.body).toMatchObject({ status: 'RESOLVED' });
      mine = (await as(app, member).get(`/v1/me/support-cases/${caseId}`).expect(200)).body;
      expect(mine).toMatchObject({ status: 'RESOLVED', resolution: expect.stringContaining('treasurer') });
      // The conversation and notes are append-only.
      await expect(prisma.supportInternalNote.updateMany({ where: { caseId }, data: { body: 'edited' } })).rejects.toThrow(/append-only/);
      await expect(prisma.supportMessage.deleteMany({ where: { caseId } })).rejects.toThrow(/append-only/);
    });

    it('keeps helpers out of finances: group access needs an assigned case and the chairperson’s approval', async () => {
      for (const [method, path] of [
        ['get', '/v1/platform/users'],
        ['get', '/v1/platform/groups'],
        ['get', '/v1/platform/revenue'],
        ['get', '/v1/platform/billing/groups'],
        ['get', '/v1/platform/audit'],
        ['get', '/v1/platform/settings'],
        ['put', '/v1/platform/plans/STARTER'],
        ['post', '/v1/platform/billing/payments/x/refund'],
        ['post', `/v1/platform/groups/${A}/suspend`],
      ] as const) {
        const client = as(app, helper);
        await (method === 'get' ? client.get(path) : client[method](path, {})).expect(403);
      }
      await as(app, helper).get(`/v1/groups/${A}/contributions/ledger`).expect(401);
      await as(app, helper).post('/v1/platform/support-access', { groupId: A, purpose: 'Check the contribution record', hours: 2 }).expect(403); // no case
      await as(app, member).post('/v1/me/support-cases', { subject: 'Still missing', category: 'CONTRIBUTIONS_PAYMENTS', description: 'Another contribution is missing from my record.', groupId: A }).expect(201);
      const open = (await as(app, admin).get('/v1/platform/support/cases?scope=unassigned').expect(200)).body.items[0];
      await as(app, admin).post(`/v1/platform/support/cases/${open.id}/assign`, { accountId: helper.id }).expect(200);
      await as(app, helper).post('/v1/platform/support-access', { groupId: B, purpose: 'Wrong group for this case', hours: 2, caseId: open.id }).expect(403);
      const grant = await as(app, helper).post('/v1/platform/support-access', { groupId: A, purpose: 'Check the contribution record', hours: 2, caseId: open.id }).expect(201);
      await as(app, helper).get(`/v1/platform/support-access/${grant.body.id}/records`).expect(404);
      await as(app, chair).post(`/v1/groups/${A}/support-access/${grant.body.id}/decision`, { decision: 'APPROVE' }).expect(200);
      expect((await as(app, helper).get(`/v1/platform/support-access/${grant.body.id}/records`).expect(200)).body.readOnly).toBe(true);
      // Another helper cannot use someone else's grant.
      const other = await createStaff(app, prisma, 'Other Helper', ['SUPPORT_HELPER']);
      await as(app, other).get(`/v1/platform/support-access/${grant.body.id}/records`).expect(404);
    });
  });

  describe('operations', () => {
    it('reports real dashboard figures and hides revenue from staff without permission', async () => {
      const d = (await as(app, owner).get('/v1/platform/dashboard').expect(200)).body;
      expect(d.totals.users).toBe(await prisma.user.count());
      expect(d.totals.groups).toBe(await prisma.group.count({ where: { status: { not: 'ARCHIVED' } } }));
      expect(d.totals.openSupportCases).toBe(await prisma.supportCase.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }));
      expect(d.revenue.byMonth).toEqual([]); // no live payments exist: nothing is invented
      expect((await as(app, admin).get('/v1/platform/dashboard').expect(200)).body.revenue).toBeNull();
      await as(app, owner).get('/v1/platform/dashboard?from=2026-10-10&to=2026-10-01').expect(400);
      await as(app, admin).patch('/v1/platform/settings', { maxSupportAccessHours: 8 }).expect(403);
      await as(app, owner).patch('/v1/platform/settings', { maxSupportAccessHours: 8 }).expect(200);
    });

    it('suspends a group: members keep read access but cannot change anything', async () => {
      await as(app, helper).post(`/v1/platform/groups/${A}/suspend`, { reason: 'Suspected fraud report' }).expect(403);
      await as(app, admin).post(`/v1/platform/groups/${A}/suspend`, { reason: 'Suspected fraud report' }).expect(200);
      await as(app, chair).get(`/v1/groups/${A}`).expect(200);
      const blocked = await as(app, chair).post(`/v1/groups/${A}/schedules`, { name: 'x', amountCents: 100, frequency: 'MONTHLY', startDate: '2026-11-01' }).expect(403);
      expect(blocked.body.details?.code ?? blocked.body.code).toBe('GROUP_SUSPENDED');
      await as(app, admin).post(`/v1/platform/groups/${A}/reactivate`, { reason: 'Report was unfounded' }).expect(200);
      expect(await prisma.auditEvent.count({ where: { groupId: A, action: 'platform.group_suspended' } })).toBe(1);
    });

    it('keeps an append-only audit trail without secrets', async () => {
      const rows = (await as(app, owner).get('/v1/platform/audit?pageSize=100').expect(200)).body;
      expect(rows.total).toBeGreaterThan(20);
      await as(app, admin).get('/v1/platform/audit').expect(403);
      const actions = new Set((await prisma.platformAuditLog.findMany({ select: { action: true } })).map((r) => r.action));
      for (const a of ['platform.login', 'platform.logout', 'platform.staff_invited', 'platform.invitation_accepted', 'platform.staff_suspended', 'platform.staff_reactivated', 'platform.staff_sessions_revoked', 'platform.staff_access_changed', 'platform.password_reset', 'platform.support_escalated', 'platform.group_suspended', 'platform.support_access_used', 'platform.settings_changed', 'platform.role_created', 'platform.permission_denied']) {
        expect(actions).toContain(a);
      }
      const all = JSON.stringify(await prisma.platformAuditLog.findMany());
      for (const s of secrets) expect(all).not.toContain(s);
      await expect(prisma.platformAuditLog.updateMany({ data: { reason: 'tampered' } })).rejects.toThrow(/append-only/);
      await expect(prisma.platformAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    });
  });
});
