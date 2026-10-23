import { INestApplication } from '@nestjs/common';
import { todayInNairobi } from '@chamahub/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, as, createGroupWith, createTestApp, idem, registerUser, resetDatabase, TestUser } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f4c8e70000000049454e44ae426082', 'hex').toString('base64');
const SECRET = 'BRAVO-PRIVATE';

interface Route { method: string; path: string }

/** Every route Nest registered on the Express router. */
function routes(app: INestApplication): Route[] {
  const instance = app.getHttpAdapter().getInstance() as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
  const stack = (instance.router ?? instance._router)!.stack as { route?: { path: string; methods: Record<string, boolean> } }[];
  return stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })));
}

/**
 * Broken object-level authorization sweep. Group B is filled with every kind of record; then the
 * chairperson of group A (who holds every permission in A) calls every group-scoped route that
 * takes a record id, through group A's URL, with each of group B's record ids. No call may
 * succeed with group B's data, and no write may succeed at all.
 */
describe('Tenant isolation: record ids from another group are never usable', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let attacker: TestUser;
  let bChair: TestUser, bTreasurer: TestUser, bMember: TestUser;
  let A: string;
  let B: string;
  let bIds: string[] = [];
  let markers: string[] = [];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
    attacker = await registerUser(app, 'Alpha Chair');
    const aMember = await registerUser(app, 'Alpha Member');
    ({ groupId: A } = await createGroupWith(app, attacker, [{ user: aMember, role: 'MEMBER' }], { name: 'Alpha Chama' }));

    bChair = await registerUser(app, `${SECRET} Chair`);
    bTreasurer = await registerUser(app, `${SECRET} Treasurer`);
    bMember = await registerUser(app, `${SECRET} Member`);
    const b = await createGroupWith(app, bChair, [{ user: bTreasurer, role: 'TREASURER' }, { user: bMember, role: 'MEMBER' }], { name: `${SECRET} Chama` });
    B = b.groupId;
    const ids = b.membershipIds;
    const today = todayInNairobi();
    const g = (p: string) => `/v1/groups/${B}/${p}`;
    const t = as(app, bTreasurer);
    const c = as(app, bChair);
    const m = as(app, bMember);

    // Records of every kind in group B (each call is checked, so the sweep is not testing an empty group).
    await t.post(g('schedules'), { name: `${SECRET} savings`, amountCents: 200_000, frequency: 'MONTHLY', startDate: today }).expect(201);
    const pay = (await t.post(g('payments'), { memberId: ids[bMember.id], amountCents: 150_000, method: 'MPESA', reference: 'BRAVOREF123', paidAt: today, idempotencyKey: idem(), notes: `${SECRET} note` }).expect(201)).body;
    const payId = (pay.payment ?? pay).id as string;
    await c.post(g(`payments/${payId}/verify`), { decision: 'CONFIRM' }).expect(200);
    const pending = (await t.post(g('payments'), { memberId: ids[bMember.id], amountCents: 50_000, method: 'CASH', paidAt: today, idempotencyKey: idem() }).expect(201)).body;
    const pendingId = (pending.payment ?? pending).id as string;
    await t.post(g(`payments/${pendingId}/evidence`), { fileName: 'receipt.png', mimeType: 'image/png', dataBase64: PNG, note: `${SECRET} receipt` }).expect(201);
    await m.post(g('disputes'), { paymentId: payId, subject: `${SECRET} dispute`, details: 'Checking the amount recorded' }).expect(201);
    await c.post(g('ledger/adjustments'), { amountCents: 500_000, account: 'OPENING_BALANCE', reason: 'Cash box balance carried from paper books', effectiveDate: today }).expect(201);
    await m.post(g('loans'), { principalCents: 100_000, installments: 2, purpose: `${SECRET} loan` });
    await t.post(g('expenses'), { category: 'Stationery', description: `${SECRET} receipt books`, amountCents: 5_000, incurredOn: today }).expect(201);
    await c.post(g('meetings'), { title: `${SECRET} meeting`, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    await c.post(g('announcements'), { title: `${SECRET} notice`, body: 'Meeting moved to Saturday' });
    await t.post(g('rotations'), { name: `${SECRET} rotation`, contributionCents: 100_000, frequency: 'MONTHLY', startDate: today, memberIds: [ids[bChair.id], ids[bTreasurer.id], ids[bMember.id]] });
    await t.post(g('statement-imports'), { fileName: 'bravo.csv', csv: `Receipt No.,Completion Time,Details,Paid In,Withdrawn\nBRAVO999X,${today} 10:00:00,Funds received from ${SECRET} Member,1500.00,\n` });
    await t.post(g('imports'), { kind: 'MEMBERS', fileName: 'bravo-register.csv', csv: `full_name,phone,shares\n${SECRET} Imported,0799123456,1\n` });
    await m.post('/v1/me/support-cases', { subject: `${SECRET} help`, category: 'OTHER', description: 'Something about my group account', groupId: B }).expect(201);

    // Harvest every id stored against group B, in every table that has a groupId column.
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id'
      WHERE c.table_schema = 'public' AND c.column_name = 'groupId'`;
    const found = new Set<string>([B, ...Object.values(ids)]);
    for (const { table_name } of tables) {
      const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${table_name}" WHERE "groupId" = $1 LIMIT 50`, B);
      rows.forEach((r) => found.add(r.id));
    }
    bIds = [...found];
    markers = [SECRET, 'BRAVOREF123', 'BRAVO999X', ...bIds.filter((id) => id !== B)];
  }, 120_000);
  afterAll(() => app.close());

  const groupRoutes = () =>
    routes(app)
      .filter((r) => r.path.startsWith('/v1/groups/:groupId/'))
      .filter((r) => (r.path.match(/:[A-Za-z]+/g) ?? []).length > 1);

  it('populated group B with records of many kinds', () => {
    expect(bIds.length).toBeGreaterThan(20);
    expect(groupRoutes().length).toBeGreaterThan(40);
  });

  it('never returns group B data through group A on any read route', async () => {
    const leaks: string[] = [];
    let calls = 0;
    for (const r of groupRoutes().filter((x) => x.method === 'GET')) {
      for (const id of bIds) {
        const url = r.path.replace(':groupId', A).replace(/:[A-Za-z]+/g, id).replace(/\.(pdf|csv)$/, '.$1');
        const res = await as(app, attacker).get(url);
        calls++;
        if (res.status < 300) {
          const text = typeof res.text === 'string' ? res.text : JSON.stringify(res.body);
          const hit = markers.find((mk) => text.includes(mk));
          if (hit) leaks.push(`${r.method} ${r.path} with ${id} -> ${res.status} contains ${hit}`);
        }
      }
    }
    expect(calls).toBeGreaterThan(500);
    expect(leaks).toEqual([]);
  }, 600_000);

  it('never accepts a write through group A that targets a group B record', async () => {
    const accepted: string[] = [];
    const before = await snapshot(prisma, B);
    for (const r of groupRoutes().filter((x) => x.method !== 'GET')) {
      for (const id of bIds) {
        const url = r.path.replace(':groupId', A).replace(/:[A-Za-z]+/g, id);
        const res = await api(app)[r.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](url).set('Authorization', `Bearer ${attacker.token}`).send({ decision: 'APPROVE', reason: 'cross-group attempt', status: 'RESOLVED', resolution: 'cross-group attempt' });
        if (res.status < 300) accepted.push(`${r.method} ${r.path} with ${id} -> ${res.status}`);
      }
    }
    expect(accepted).toEqual([]);
    // And nothing in group B changed.
    expect(await snapshot(prisma, B)).toEqual(before);
  }, 600_000);

  it('denies group B routes to a non-member, even with valid ids', async () => {
    const sample = groupRoutes().filter((r) => r.method === 'GET').slice(0, 25);
    for (const r of sample) {
      const res = await as(app, attacker).get(r.path.replace(':groupId', B).replace(/:[A-Za-z]+/g, bIds[1]));
      expect([403, 404]).toContain(res.status);
    }
    await as(app, attacker).get(`/v1/groups/${B}`).expect(404);
    await as(app, attacker).get(`/v1/groups/${B}/members`).expect(404);
  });
});

/** Counts and update times of group B's records, to prove a sweep changed nothing. */
async function snapshot(prisma: PrismaService, groupId: string) {
  const [payments, loans, expenses, disputes, entries, rotations, meetings, audit] = await Promise.all([
    prisma.payment.findMany({ where: { groupId }, select: { id: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.loan.findMany({ where: { groupId }, select: { id: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.expense.findMany({ where: { groupId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.dispute.findMany({ where: { groupId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.journalEntry.count({ where: { groupId } }),
    prisma.payoutCycle.findMany({ where: { groupId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.meeting.findMany({ where: { groupId }, select: { id: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.auditEvent.count({ where: { groupId } }),
  ]);
  return { payments, loans, expenses, disputes, entries, rotations, meetings, audit };
}
