import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { testOtpOutbox } from '../src/modules/auth/otp.service';
import { as, createGroupWith, createStaff, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

describe('Roles: platform vs Chama, multi-group, configurable within safeguards', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mary: TestUser, chairA: TestUser, chairB: TestUser, treasurerC: TestUser, auditor: TestUser, secretary: TestUser, member: TestUser;
  let A: { groupId: string; membershipIds: Record<string, string> };
  let B: typeof A;
  let C: typeof A;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    mary = await registerUser(app, 'Mary Wanjiku');
    chairA = await registerUser(app, 'Chair Upendo');
    chairB = await registerUser(app, 'Chair Jitegemee');
    treasurerC = await registerUser(app, 'Treasurer Mombasa');
    auditor = await registerUser(app, 'Auditor Atieno');
    secretary = await registerUser(app, 'Secretary Sang');
    member = await registerUser(app, 'Member Musa');
    // Mary: Treasurer in A, Member in B, Chairperson in C — one account.
    A = await createGroupWith(app, chairA, [{ user: mary, role: 'TREASURER' }, { user: auditor, role: 'AUDITOR' }, { user: secretary, role: 'SECRETARY' }, { user: member, role: 'MEMBER' }], { name: 'Upendo Merry-Go-Round', type: 'MERRY_GO_ROUND' });
    B = await createGroupWith(app, chairB, [{ user: mary, role: 'MEMBER' }], { name: 'Jitegemee Table Banking' });
    C = await createGroupWith(app, mary, [{ user: treasurerC, role: 'TREASURER' }], { name: 'Mombasa Investment Chama', type: 'INVESTMENT' });
  });
  afterAll(async () => app.close());

  it('gives one account a different role and permission set in each group', async () => {
    const groups = (await as(app, mary).get('/v1/groups').expect(200)).body as { name: string; role: string; permissions: string[] }[];
    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    expect(byName['Upendo Merry-Go-Round'].role).toBe('TREASURER');
    expect(byName['Upendo Merry-Go-Round'].permissions).toContain('contributions.record');
    expect(byName['Jitegemee Table Banking'].role).toBe('MEMBER');
    expect(byName['Jitegemee Table Banking'].permissions).not.toContain('contributions.record');
    expect(byName['Mombasa Investment Chama'].permissions).toContain('permissions.configure');

    // Enforced by the API, not just hidden in the UI.
    const body = { memberId: B.membershipIds[chairB.id], amountCents: 1000, method: 'CASH', paidAt: todayInNairobi(), idempotencyKey: idem() };
    await as(app, mary).post(`/v1/groups/${B.groupId}/payments`, body).expect(403);
    await as(app, mary).post(`/v1/groups/${A.groupId}/payments`, { ...body, memberId: A.membershipIds[member.id] }).expect(201);
    await as(app, mary).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'MEMBER', permissions: null, reason: 'Trying from another group' }).expect(403);
  });

  it('separates duties by default: treasurer prepares, another officer approves', async () => {
    const e = await as(app, mary).post(`/v1/groups/${A.groupId}/expenses`, { category: 'Stationery', description: 'Receipt books', amountCents: 5000, incurredOn: todayInNairobi() }).expect(201);
    await as(app, mary).post(`/v1/groups/${A.groupId}/expenses/${e.body.id}/decision`, { decision: 'APPROVE' }).expect(403);
    // Chairperson does not record contributions or expenses by default.
    await as(app, chairA).post(`/v1/groups/${A.groupId}/expenses`, { category: 'Other', description: 'Something', amountCents: 5000, incurredOn: todayInNairobi() }).expect(403);
    // Secretary manages meetings but not money.
    await as(app, secretary).get(`/v1/groups/${A.groupId}/contributions/ledger`).expect(403);
    await as(app, secretary).post(`/v1/groups/${A.groupId}/meetings`, { title: 'Monthly meeting', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    // Auditor reads but cannot write.
    await as(app, auditor).get(`/v1/groups/${A.groupId}/contributions/ledger`).expect(200);
    await as(app, auditor).post(`/v1/groups/${A.groupId}/payments`, { memberId: A.membershipIds[member.id], amountCents: 100, method: 'CASH', paidAt: todayInNairobi(), idempotencyKey: idem() }).expect(403);
  });

  it('lets a group adjust role permissions only within platform safeguards', async () => {
    // Give the chair contribution recording (configurable).
    const chairPerms = (await as(app, chairA).get('/v1/groups').expect(200)).body[0].permissions as string[];
    await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'CHAIRPERSON', permissions: [...chairPerms, 'contributions.record'], reason: 'Small group, chair also collects cash' }).expect(200);
    await as(app, chairA).post(`/v1/groups/${A.groupId}/payments`, { memberId: A.membershipIds[member.id], amountCents: 2000, method: 'CASH', paidAt: todayInNairobi(), idempotencyKey: idem() }).expect(201);
    // Auditors can never be given write access; members can never get financial write access.
    const bad = await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'AUDITOR', permissions: ['group.view', 'contributions.record'], reason: 'Should be rejected' }).expect(422);
    expect(bad.body.details.rejected).toEqual(['contributions.record']);
    await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'MEMBER', permissions: ['group.view', 'expenses.record'], reason: 'Should be rejected' }).expect(422);
    // The chair cannot lock themselves out: locked permissions are always kept.
    await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'CHAIRPERSON', permissions: ['group.view'], reason: 'Minimal chair' }).expect(200);
    await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'CHAIRPERSON', permissions: null, reason: 'Restore defaults' }).expect(200);
    // Taking a permission away takes effect immediately.
    const tPerms = ((await as(app, mary).get('/v1/groups').expect(200)).body as { groupId: string; permissions: string[] }[]).find((g) => g.groupId === A.groupId)!.permissions;
    await as(app, chairA).put(`/v1/groups/${A.groupId}/role-policy`, { role: 'TREASURER', permissions: tPerms.filter((p) => p !== 'expenses.record'), reason: 'Expenses go through the chair' }).expect(200);
    await as(app, mary).post(`/v1/groups/${A.groupId}/expenses`, { category: 'Other', description: 'Blocked now', amountCents: 100, incurredOn: todayInNairobi() }).expect(403);
    const events = await prisma.auditEvent.count({ where: { groupId: A.groupId, action: 'group.role_policy_changed' } });
    expect(events).toBeGreaterThanOrEqual(4);
  });

  it('supports optional roles: loan committee, read-only', async () => {
    await as(app, chairA).put(`/v1/groups/${A.groupId}/members/${A.membershipIds[secretary.id]}/special-roles`, { specialRoles: ['LOAN_COMMITTEE'], reason: 'Elected to loan committee' }).expect(200);
    await as(app, secretary).get(`/v1/groups/${A.groupId}/loans`).expect(200);
    await as(app, chairA).put(`/v1/groups/${A.groupId}/members/${A.membershipIds[member.id]}/special-roles`, { specialRoles: ['READ_ONLY'], reason: 'Observer status pending membership fee' }).expect(200);
    await as(app, member).post(`/v1/groups/${A.groupId}/loans`, { principalCents: 1000, installments: 1, purpose: 'Test' }).expect(403);
    await as(app, member).get(`/v1/groups/${A.groupId}/statements`).expect(200);
    await as(app, chairA).put(`/v1/groups/${A.groupId}/members/${A.membershipIds[mary.id]}/special-roles`, { specialRoles: ['READ_ONLY'], reason: 'Not allowed for officers' }).expect(422);
    await as(app, mary).put(`/v1/groups/${A.groupId}/members/${A.membershipIds[member.id]}/special-roles`, { specialRoles: [], reason: 'Treasurer cannot assign roles' }).expect(403);
  });

  it('stops whoever prepared a loan from approving it', async () => {
    // The treasurer reports a payment so they have savings to borrow against; Mary (chair) verifies it.
    await as(app, treasurerC).post(`/v1/groups/${C.groupId}/payments`, { memberId: C.membershipIds[treasurerC.id], amountCents: 100_000, method: 'MPESA', reference: 'TRC1PREP', paidAt: todayInNairobi(), idempotencyKey: idem() }).expect(201);
    const pending = await prisma.payment.findFirstOrThrow({ where: { groupId: C.groupId, reference: 'TRC1PREP' } });
    await as(app, mary).post(`/v1/groups/${C.groupId}/payments/${pending.id}/verify`, { decision: 'CONFIRM' }).expect(200);
    // Mary (chair) prepares a loan for the treasurer, so she cannot approve it herself.
    const loan = await as(app, mary).post(`/v1/groups/${C.groupId}/loans/prepare`, { memberId: C.membershipIds[treasurerC.id], principalCents: 50_000, installments: 2, purpose: 'Paper application from the meeting' }).expect(201);
    await as(app, mary).post(`/v1/groups/${C.groupId}/loans/${loan.body.id}/decision`, { decision: 'APPROVE' }).expect(403);
    await as(app, treasurerC).post(`/v1/groups/${C.groupId}/loans/${loan.body.id}/decision`, { decision: 'APPROVE' }).expect(403); // borrower
  });

  it('scopes audit logs: full for chair/auditor, own area for officers, own activity for members', async () => {
    const full = await as(app, auditor).get(`/v1/groups/${A.groupId}/audit?pageSize=200`).expect(200);
    const sec = await as(app, secretary).get(`/v1/groups/${A.groupId}/audit?pageSize=200`).expect(200);
    const mem = await as(app, member).get(`/v1/groups/${A.groupId}/audit?pageSize=200`).expect(200);
    expect(full.body.total).toBeGreaterThan(sec.body.total);
    expect(sec.body.items.some((e: { entityType: string }) => e.entityType === 'Meeting')).toBe(true);
    expect(sec.body.items.some((e: { entityType: string }) => e.entityType === 'Expense')).toBe(false);
    expect(mem.body.items.every((e: { actorName: string }) => e.actorName === 'Member Musa')).toBe(true);
  });

  it('runs member votes: one final ballot each, secret tallies, decision published', async () => {
    await as(app, member).post(`/v1/groups/${A.groupId}/votes`, { title: 'Raise contribution to 1,500', description: 'From next month', closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(403);
    const v = await as(app, chairA).post(`/v1/groups/${A.groupId}/votes`, { title: 'Raise contribution to 1,500', description: 'From next month', closesAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), quorumPercent: 50, passPercent: 50 }).expect(201);
    expect(v.body.eligibleCount).toBe(4); // read-only member excluded
    await as(app, mary).post(`/v1/groups/${A.groupId}/votes/${v.body.id}/ballot`, { choice: 'YES' }).expect(200);
    await as(app, mary).post(`/v1/groups/${A.groupId}/votes/${v.body.id}/ballot`, { choice: 'NO' }).expect(409);
    await as(app, member).post(`/v1/groups/${A.groupId}/votes/${v.body.id}/ballot`, { choice: 'NO' }).expect(403);
    await as(app, auditor).post(`/v1/groups/${A.groupId}/votes/${v.body.id}/ballot`, { choice: 'YES' }).expect(200);
    const seen = (await as(app, secretary).get(`/v1/groups/${A.groupId}/votes`).expect(200)).body[0];
    expect(seen).toMatchObject({ tally: { YES: 2, NO: 0, ABSTAIN: 0 }, myVote: null, canVote: true });
    const closed = await as(app, chairA).post(`/v1/groups/${A.groupId}/votes/${v.body.id}/close`, {}).expect(200);
    expect(closed.body.status).toBe('PASSED');
    await expect(prisma.vote.deleteMany({ where: { proposalId: v.body.id } })).rejects.toThrow(/append-only/);
    const auditOfBallot = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'vote.cast', entityId: v.body.id } });
    expect(auditOfBallot.after).toBeNull(); // choice is not recorded against the voter
  });

  it('lets auditors raise findings that another officer must answer', async () => {
    await as(app, member).post(`/v1/groups/${A.groupId}/findings`, { title: 'Cash count mismatch', details: 'Cash box short by 200', severity: 'HIGH' }).expect(403);
    const f = await as(app, auditor).post(`/v1/groups/${A.groupId}/findings`, { title: 'Cash count mismatch', details: 'Cash box short by KES 200 on 12 March', severity: 'HIGH' }).expect(201);
    await as(app, member).get(`/v1/groups/${A.groupId}/findings`).expect(403);
    await as(app, mary).post(`/v1/groups/${A.groupId}/findings/${f.body.id}/respond`, { status: 'RESOLVED', response: 'Recount found the note in the receipt book' }).expect(200);
    const list = (await as(app, auditor).get(`/v1/groups/${A.groupId}/findings`).expect(200)).body;
    expect(list[0]).toMatchObject({ status: 'RESOLVED', respondedByName: 'Mary Wanjiku', canRespond: false });
  });

  it('scopes platform staff roles; Chama roles never grant portal access', async () => {
    const helper = await createStaff(app, prisma, 'Support Sam', ['SUPPORT_HELPER']);
    const platformAdmin = await createStaff(app, prisma, 'Ops Olive', ['PLATFORM_ADMIN']);
    const owner = await createStaff(app, prisma, 'Root Rose', ['OWNER']);

    // A chairperson's member token is not a staff token.
    await as(app, chairA).get('/v1/platform/dashboard').expect(401);
    await as(app, chairA).get('/v1/platform/users').expect(401);
    // …and a staff token is not a member token.
    await as(app, owner).get(`/v1/groups/${A.groupId}/contributions/ledger`).expect(401);

    // Support helper: own cases and requesting access, no stats, no plans, no account actions.
    await as(app, helper).get('/v1/platform/support/cases').expect(200);
    await as(app, helper).get('/v1/platform/dashboard').expect(403);
    await as(app, helper).get('/v1/platform/users').expect(403);
    await as(app, helper).put('/v1/platform/plans/X1', { code: 'X1', name: 'X', tier: 5, entitlements: { features: [], limits: { maxMembers: 5 } }, active: true, isPublic: false }).expect(403);
    await as(app, helper).post(`/v1/platform/users/${member.id}/send-reset-code`, { reason: 'Member lost access to phone PIN' }).expect(403);

    // Platform admin: operations and account help, but not staff admins, settings or revenue.
    await as(app, platformAdmin).get('/v1/platform/dashboard').expect(200);
    await as(app, platformAdmin).post(`/v1/platform/users/${member.id}/send-reset-code`, { reason: 'Member lost access to phone PIN' }).expect(200);
    expect(testOtpOutbox.get(`${member.phone}:RESET_PASSWORD`)).toMatch(/^\d{6}$/);
    await as(app, platformAdmin).patch('/v1/platform/settings', { smsEnabled: false }).expect(403);
    await as(app, platformAdmin).post(`/v1/platform/staff/${owner.id}/suspend`, { reason: 'Cannot suspend an owner' }).expect(403);
    expect((await as(app, platformAdmin).get('/v1/platform/dashboard').expect(200)).body.revenue).toBeNull();

    // Owner: configuration, still no implicit access to group finances.
    await as(app, owner).patch('/v1/platform/settings', { maxSupportAccessHours: 4 }).expect(200);
    expect((await as(app, owner).get('/v1/platform/dashboard').expect(200)).body.revenue).not.toBeNull();
    await as(app, owner).post('/v1/platform/support-access', { groupId: A.groupId, purpose: 'Investigate reported issue', hours: 24 }).expect(403); // over the 4h policy
  });

  it('lets import approvers open batches they must review, without letting them upload', async () => {
    const g = (p: string) => `/v1/groups/${A.groupId}/${p}`;
    await as(app, chairA).get(g('imports')).expect(200); // approves imports, does not prepare them
    await as(app, mary).get(g('imports')).expect(200); // treasurer prepares imports
    await as(app, member).get(g('imports')).expect(403);
    await as(app, chairA).post(g('imports'), { kind: 'MEMBERS', fileName: 'm.csv', csv: 'name,phone\n' }).expect(403);
  });
});
