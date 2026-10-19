/**
 * DEMO DATA ONLY — never run against production.
 *
 * Seeds four Chamas around one demo account (Amina) who holds a different
 * role in each, so every screen has realistic data. All money flows go
 * through the real services (recording → verification → ledger).
 *
 * Demo sign-in: phone 0700 000 001, password Demo1234 (all demo users share it).
 * Platform admin: phone 0700 000 099.
 */
import 'reflect-metadata';
process.env.DISABLE_JOBS = 'true';

import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { addDays, defaultLoanPolicy, GroupRole, resolvePermissions, todayInNairobi } from '@chamahub/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MembershipContext } from '../src/common/request';
import { ContributionsService } from '../src/modules/contributions/contributions.service';
import { LoansService } from '../src/modules/loans/loans.service';
import { RotationsService } from '../src/modules/rotations/rotations.service';
import { MeetingsService } from '../src/modules/meetings/meetings.service';
import { ExpensesService } from '../src/modules/expenses/expenses.service';
import { FinesService } from '../src/modules/fines/fines.service';
import { DEFAULT_PREFERENCES } from '../src/modules/notifications/notifications.service';
import { DEFAULT_SETTINGS } from '../src/modules/finance/policies';
import { newInviteCode } from '../src/modules/groups/groups.service';

const meta = { ipAddress: '127.0.0.1', userAgent: 'seed', requestId: 'seed' };
let key = 0;
const k = () => `seed-${Date.now()}-${++key}`;

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const contributions = app.get(ContributionsService);
  const loans = app.get(LoansService);
  const rotations = app.get(RotationsService);
  const meetings = app.get(MeetingsService);
  const expenses = app.get(ExpensesService);
  const fines = app.get(FinesService);

  if (await prisma.group.count()) {
    console.log('Database already has groups — skipping demo seed. Recreate the dev database to reseed.');
    await app.close();
    return;
  }

  const today = todayInNairobi();
  const passwordHash = await bcrypt.hash('Demo1234', 10);

  await prisma.plan.createMany({
    data: [
      { code: 'STARTER', name: 'Starter', priceCents: 0n, maxMembers: 15, features: ['Contributions', 'Statements', 'Mobile app'] },
      { code: 'GROWTH', name: 'Growth', priceCents: 50_000n, maxMembers: 50, features: ['Loans', 'Rotations', 'Imports', 'SMS reminders'] },
      { code: 'PRO', name: 'Pro', priceCents: 150_000n, maxMembers: 500, features: ['Distributions', 'Investments', 'Priority support'] },
    ],
  });

  const people = [
    ['Amina Odhiambo', '+254700000001'],
    ['Peter Kamau', '+254700000002'],
    ['Joyce Wanjiru', '+254700000003'],
    ['Daniel Otieno', '+254700000004'],
    ['Mercy Achieng', '+254700000005'],
    ['Samuel Kiprop', '+254700000006'],
    ['Faith Njoki', '+254700000007'],
    ['Brian Mutua', '+254700000008'],
    ['Lucy Chebet', '+254700000009'],
  ] as const;
  const users: Record<string, string> = {};
  for (const [fullName, phone] of people) {
    const u = await prisma.user.create({ data: { fullName, phone, passwordHash, phoneVerifiedAt: new Date(), preferences: DEFAULT_PREFERENCES } });
    users[fullName.split(' ')[0]] = u.id;
  }
  for (const [fullName, phone, platformRole] of [
    ['ChamaHub Super Admin', '+254700000099', 'SUPER_ADMIN'],
    ['ChamaHub Platform Admin', '+254700000098', 'PLATFORM_ADMIN'],
    ['ChamaHub Support Agent', '+254700000097', 'SUPPORT'],
  ] as const) {
    await prisma.user.create({ data: { fullName, phone, passwordHash, phoneVerifiedAt: new Date(), platformRole, preferences: DEFAULT_PREFERENCES } });
  }
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: 'GROWTH' } });

  async function group(name: string, type: 'MERRY_GO_ROUND' | 'TABLE_BANKING' | 'INVESTMENT' | 'WELFARE', roster: [string, GroupRole][], monthsHistory: number, extra: Record<string, unknown> = {}) {
    const g = await prisma.group.create({
      data: {
        name,
        type,
        county: 'Nairobi',
        description: `${name} — demo group`,
        inviteCode: newInviteCode(),
        settings: { ...DEFAULT_SETTINGS, requiredFinancialApprovals: 1, accountReferencePrefix: name.slice(0, 4).toUpperCase(), ...extra },
        loanPolicy: { ...defaultLoanPolicy, enabled: type !== 'MERRY_GO_ROUND', requiredApprovals: 2 },
        createdById: users[roster[0][0]],
        subscription: { create: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } },
      },
    });
    const joinedAt = new Date(`${addDays(today, -31 * monthsHistory - 3)}T06:00:00Z`);
    const ctx: Record<string, MembershipContext> = {};
    for (const [first, role] of roster) {
      const m = await prisma.membership.create({ data: { groupId: g.id, userId: users[first], role, joinedAt, shares: role === 'MEMBER' ? 2 : 3 } });
      ctx[first] = { id: m.id, groupId: g.id, userId: users[first], role, permissions: resolvePermissions(role) };
    }
    return { id: g.id, ctx };
  }

  /**
   * Records and verifies a payment through the real two-person flow: the
   * verifier is an officer other than the payer, and the recorder is any
   * recording officer other than the verifier, or the payer self-reporting.
   */
  async function settle(ctx: Record<string, MembershipContext>, member: MembershipContext, amountCents: number, paidAt: string, extra: Record<string, unknown> = {}) {
    const officers = Object.values(ctx);
    const verifier = officers.find((c) => c.permissions.includes('contributions.verify') && c.id !== member.id)!;
    // If no other officer records payments, the payer reports their own (with its M-Pesa code).
    const recorder = officers.find((c) => c.permissions.includes('contributions.record') && c.id !== verifier.id) ?? member;
    const p = await contributions.record(member.groupId, { memberId: member.id, amountCents, method: 'MPESA', reference: `S${Math.random().toString(36).slice(2, 10).toUpperCase()}`, paidAt, purpose: 'CONTRIBUTION', idempotencyKey: k(), ...extra } as never, recorder, meta);
    await contributions.verify(member.groupId, p.id, 'CONFIRM', undefined, verifier, meta);
    return p.id;
  }
  const byMembership = (ctx: Record<string, MembershipContext>, id: string) => Object.values(ctx).find((c) => c.id === id)!;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const pastObligations = (groupId: string, before = today) => prisma.contributionObligation.findMany({ where: { groupId, dueDate: { lt: new Date(`${before}T00:00:00Z`) } }, orderBy: { dueDate: 'asc' } });

  // 1) Jitegemee Table Banking — Amina is TREASURER.
  const jt = await group('Jitegemee Table Banking', 'TABLE_BANKING', [['Samuel', 'CHAIRPERSON'], ['Amina', 'TREASURER'], ['Faith', 'MEMBER'], ['Brian', 'MEMBER'], ['Lucy', 'MEMBER'], ['Peter', 'MEMBER']], 5);
  await contributions.createSchedule(jt.id, { name: 'Monthly shares', amountCents: 200_000, frequency: 'MONTHLY', startDate: addDays(today, -31 * 5) }, jt.ctx.Amina, meta);
  const jtObl = await pastObligations(jt.id);
  const lastDue = jtObl.at(-1)?.dueDate.getTime();
  for (const o of jtObl) {
    const member = byMembership(jt.ctx, o.membershipId);
    if (member.userId === users.Brian && o.dueDate.getTime() === lastDue) continue; // Brian is overdue this month
    await settle(jt.ctx, member, 200_000, iso(o.dueDate), { targetId: o.id });
  }
  // Faith borrows KES 10,000 at 10% flat per month over 4 months.
  const loan = await loans.apply(jt.id, { principalCents: 1_000_000, installments: 4, purpose: 'Restock vegetable stall', guarantorMemberIds: [jt.ctx.Lucy.id] }, jt.ctx.Faith, meta);
  await loans.decide(jt.id, loan.id, 'APPROVE', 'Good repayment history', jt.ctx.Samuel, meta);
  await loans.decide(jt.id, loan.id, 'APPROVE', undefined, jt.ctx.Amina, meta);
  await loans.disburse(jt.id, loan.id, { method: 'MPESA', reference: 'SDISB0001', disbursedAt: addDays(today, -70), firstDueDate: addDays(today, -40), idempotencyKey: k() }, jt.ctx.Amina, meta);
  await settle(jt.ctx, jt.ctx.Faith, 350_000, addDays(today, -40), { purpose: 'LOAN_REPAYMENT', targetId: loan.id });
  await settle(jt.ctx, jt.ctx.Faith, 350_000, addDays(today, -10), { purpose: 'LOAN_REPAYMENT', targetId: loan.id });
  await loans.apply(jt.id, { principalCents: 500_000, installments: 3, purpose: 'School fees', guarantorMemberIds: [] }, jt.ctx.Lucy, meta);
  await contributions.record(jt.id, { memberId: jt.ctx.Brian.id, amountCents: 200_000, method: 'CASH', paidAt: today, purpose: 'CONTRIBUTION', idempotencyKey: k(), notes: 'Paid in cash at the meeting' } as never, jt.ctx.Amina, meta);
  await fines.issue(jt.id, { memberId: jt.ctx.Brian.id, amountCents: 20_000, reason: 'Late contribution', issuedOn: addDays(today, -5) }, jt.ctx.Amina, meta);

  // 2) Upendo Merry-Go-Round — Amina is a MEMBER.
  const up = await group('Upendo Merry-Go-Round', 'MERRY_GO_ROUND', [['Peter', 'CHAIRPERSON'], ['Joyce', 'TREASURER'], ['Amina', 'MEMBER'], ['Daniel', 'MEMBER'], ['Mercy', 'MEMBER']], 2);
  const cycle = await rotations.create(up.id, { name: 'Upendo Cycle 3', contributionCents: 100_000, frequency: 'WEEKLY', startDate: addDays(today, -21), memberIdsInOrder: [up.ctx.Daniel.id, up.ctx.Mercy.id, up.ctx.Peter.id, up.ctx.Amina.id, up.ctx.Joyce.id], recipientContributes: true }, up.ctx.Joyce, meta);
  for (const round of cycle.rounds.filter((r) => r.payoutDate <= today)) {
    for (const o of await prisma.contributionObligation.findMany({ where: { roundId: round.id } })) {
      const member = byMembership(up.ctx, o.membershipId);
      if (round.round === 4 && member.userId === users.Daniel) continue; // a shortfall in the current round
      await settle(up.ctx, member, 100_000, round.payoutDate, { targetId: o.id });
    }
    if (round.round <= 3) {
      const officers = [up.ctx.Peter, up.ctx.Joyce];
      const approver = officers.find((c) => c.id !== round.recipientMembershipId)!;
      await rotations.approvePayout(up.id, cycle.id, round.id, {}, approver, meta);
      await rotations.completePayout(up.id, cycle.id, round.id, { method: 'MPESA', reference: `SPAY${round.round}XYZ`, paidAt: round.payoutDate, idempotencyKey: k() }, approver, meta);
    }
  }

  // 3) Mombasa Investment Chama — Amina is CHAIRPERSON.
  const mi = await group('Mombasa Investment Chama', 'INVESTMENT', [['Amina', 'CHAIRPERSON'], ['Brian', 'TREASURER'], ['Lucy', 'SECRETARY'], ['Daniel', 'MEMBER'], ['Samuel', 'MEMBER']], 3);
  await contributions.createSchedule(mi.id, { name: 'Investment contribution', amountCents: 500_000, frequency: 'MONTHLY', startDate: addDays(today, -31 * 3) }, mi.ctx.Brian, meta);
  for (const o of await pastObligations(mi.id)) await settle(mi.ctx, byMembership(mi.ctx, o.membershipId), 500_000, iso(o.dueDate), { targetId: o.id });
  await prisma.investmentHolding.create({ data: { groupId: mi.id, name: 'Treasury bond FXD1/2024/10', kind: 'Government bond', costCents: 3_000_000n, currentValueCents: 3_120_000n, acquiredOn: new Date(`${addDays(today, -40)}T00:00:00Z`) } });
  const exp = await expenses.create(mi.id, { category: 'Meeting costs', description: 'Venue hire — quarterly AGM', amountCents: 250_000, incurredOn: addDays(today, -12), payee: 'Nyali Community Hall' }, mi.ctx.Brian, meta);
  await expenses.decide(mi.id, exp.id, 'APPROVE', undefined, mi.ctx.Amina, meta);
  await expenses.pay(mi.id, exp.id, { method: 'MPESA', reference: 'SEXP0001', paidAt: addDays(today, -11), idempotencyKey: k() }, mi.ctx.Brian, meta);
  const agm = await meetings.create(mi.id, { title: 'Quarterly AGM', scheduledAt: `${addDays(today, -12)}T14:00:00+03:00`, location: 'Nyali Community Hall', agenda: ['Treasurer report', 'Bond investment update', 'AOB'], requiresRsvp: true }, mi.ctx.Lucy, meta);
  await meetings.register(mi.id, agm.id, Object.values(mi.ctx).map((c, i) => ({ memberId: c.id, status: i === 4 ? 'APOLOGY' : 'PRESENT' })), mi.ctx.Lucy, meta);
  await meetings.saveMinutes(mi.id, agm.id, 'The treasurer presented the quarterly report. Members agreed to hold the treasury bond to maturity and to review a land investment proposal next quarter.', mi.ctx.Lucy, meta);
  await meetings.addResolution(mi.id, agm.id, { title: 'Hold treasury bond to maturity', isFinancial: true, amountCents: 3_000_000 }, mi.ctx.Lucy, meta);
  await meetings.addAction(mi.id, agm.id, { description: 'Get a valuation for the Kilifi plot', assigneeMemberId: mi.ctx.Daniel.id, dueDate: addDays(today, 20) }, mi.ctx.Lucy, meta);
  await meetings.approveMinutes(mi.id, agm.id, mi.ctx.Amina, meta);
  await meetings.create(mi.id, { title: 'Land investment review', scheduledAt: `${addDays(today, 9)}T15:00:00+03:00`, location: 'Online', virtualLink: 'https://meet.example.com/mombasa', agenda: ['Kilifi plot valuation', 'Financing options'], requiresRsvp: true }, mi.ctx.Lucy, meta);

  // 4) Family Welfare Group — Amina is a MEMBER.
  const fw = await group('Family Welfare Group', 'WELFARE', [['Mercy', 'CHAIRPERSON'], ['Faith', 'TREASURER'], ['Amina', 'MEMBER'], ['Joyce', 'MEMBER']], 2);
  await contributions.createSchedule(fw.id, { name: 'Welfare kitty', amountCents: 50_000, frequency: 'MONTHLY', startDate: addDays(today, -40) }, fw.ctx.Faith, meta);
  for (const o of await pastObligations(fw.id, addDays(today, -20))) await settle(fw.ctx, byMembership(fw.ctx, o.membershipId), 50_000, iso(o.dueDate), { targetId: o.id });

  // Optional roles and a group decision so those screens have data.
  await prisma.membership.update({ where: { id: jt.ctx.Peter.id }, data: { specialRoles: ['LOAN_COMMITTEE'] } });
  await prisma.proposal.create({ data: { groupId: mi.id, title: 'Buy the Kilifi plot', description: 'Use up to KES 300,000 from the investment fund for a deposit on the Kilifi plot, subject to valuation.', quorumPercent: 60, passPercent: 60, eligibleCount: 5, createdById: users.Amina, closesAt: new Date(Date.now() + 5 * 86_400_000) } });
  await prisma.auditFinding.create({ data: { groupId: mi.id, raisedByMembershipId: mi.ctx.Lucy.id, title: 'Venue receipt missing', details: 'The AGM venue expense has an M-Pesa code but no receipt from the hall.', severity: 'LOW' } });

  console.log('Demo data seeded. Password for all demo users: Demo1234');
  console.log('  0700 000 001  Amina — treasurer / chairperson / member in different Chamas');
  console.log('  0700 000 099  Super Admin · 0700 000 098 Platform Admin · 0700 000 097 Support Agent');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
