/**
 * DEMO DATA ONLY — never run against production.
 *
 * Seeds four Chamas around one demo account (Amina) who holds a different
 * role in each, so every screen has realistic data. All money flows go
 * through the real services (recording → verification → ledger).
 *
 * Demo sign-in: phone 0700 000 001, password Demo1234 (all demo users share it).
 * Platform staff are NOT seeded with a known password. Either run the owner bootstrap
 * (npm run platform:bootstrap) or set SEED_PLATFORM_PASSWORD (12+ characters, your own choice)
 * to create demo staff accounts in development.
 */
import 'reflect-metadata';
process.env.DISABLE_JOBS = 'true';

import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { addDays, defaultLoanPolicy, GroupRole, resolvePermissions, todayInNairobi } from '@chamahub/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashStaffPassword } from '../src/modules/platform-auth/staff-crypto';
import { ensureSystemRoles } from '../src/modules/platform-auth/staff-roles';
import { SupportService } from '../src/modules/platform/support.service';
import { MembershipContext } from '../src/common/request';
import { ContributionsService } from '../src/modules/contributions/contributions.service';
import { LoansService } from '../src/modules/loans/loans.service';
import { RotationsService } from '../src/modules/rotations/rotations.service';
import { MeetingsService } from '../src/modules/meetings/meetings.service';
import { ExpensesService } from '../src/modules/expenses/expenses.service';
import { FinesService } from '../src/modules/fines/fines.service';
import { DestinationsService } from '../src/modules/collections/destinations.service';
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
  const destinations = app.get(DestinationsService);

  if (await prisma.group.count()) {
    console.log('Database already has groups — skipping demo seed. Recreate the dev database to reseed.');
    await app.close();
    return;
  }

  const today = todayInNairobi();
  const passwordHash = await bcrypt.hash('Demo1234', 10);

  // Plans, prices, regions and payment providers come from the migrations (editable in Platform › Plans & pricing).


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
  // Demo platform staff: only with an operator-chosen password, never a default one, never in production.
  const staffPassword = process.env.SEED_PLATFORM_PASSWORD;
  const staffSeeded = !!staffPassword && process.env.NODE_ENV !== 'production';
  if (staffPassword && staffPassword.length < 12) throw new Error('SEED_PLATFORM_PASSWORD must be at least 12 characters');
  if (staffSeeded) {
    await ensureSystemRoles(prisma);
    const hash = await hashStaffPassword(staffPassword!);
    for (const [fullName, email, role] of [
      ['Demo Owner', 'owner@staff.chamahub.test', 'OWNER'],
      ['Demo Platform Admin', 'admin@staff.chamahub.test', 'PLATFORM_ADMIN'],
      ['Demo Support Helper', 'helper@staff.chamahub.test', 'SUPPORT_HELPER'],
      ['Demo Analyst', 'analyst@staff.chamahub.test', 'ANALYST'],
      ['Demo Finance', 'finance@staff.chamahub.test', 'FINANCE'],
    ] as const) {
      const r = await prisma.platformStaffRole.findUniqueOrThrow({ where: { code: role } });
      await prisma.platformAccount.create({ data: { fullName, email, passwordHash: hash, status: 'ACTIVE', passwordChangedAt: new Date(), roles: { create: { roleId: r.id } } } });
    }
  }
  /**
   * DEMO billing: a subscription paid through the SANDBOX provider (test mode), so it never
   * counts as revenue. Shows plans, receipts and the billing history in the apps.
   */
  let receiptNo = 1;
  async function paidPlan(groupId: string, planCode: string, interval: 'MONTH' | 'YEAR', startedDaysAgo: number) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode }, include: { prices: { where: { countryCode: 'KE', currency: 'KES', interval } } } });
    const start = new Date(Date.now() - startedDaysAgo * 86_400_000);
    const end = new Date(start);
    if (interval === 'YEAR') end.setUTCFullYear(end.getUTCFullYear() + 1);
    else end.setUTCMonth(end.getUTCMonth() + 1);
    const price = plan.prices[0].amountMinor;
    const sub = await prisma.subscription.create({ data: { groupId, planId: plan.id, status: 'ACTIVE', interval, currency: 'KES', amountMinor: price, currentPeriodStart: start, currentPeriodEnd: end } });
    const p = await prisma.billingPayment.create({
      data: { reference: `CHB-DEMO${String(receiptNo).padStart(4, '0')}`, groupId, subscriptionId: sub.id, planId: plan.id, interval, purpose: 'NEW', provider: 'SANDBOX', providerRef: `sbx_demo_${receiptNo}`, livemode: false, currency: 'KES', priceMinor: price, amountMinor: price, status: 'SUCCEEDED', idempotencyKey: `demo-billing-${receiptNo}`, receiptNumber: `CHB-R-DEMO-${String(receiptNo++).padStart(4, '0')}`, paidAt: start, periodStart: start, periodEnd: end, createdAt: start },
    });
    await prisma.subscriptionEvent.create({ data: { groupId, type: 'activated', toPlan: planCode, toStatus: 'ACTIVE', paymentId: p.id, reason: 'Demo data (sandbox, test mode)', createdAt: start } });
  }
  async function trial(groupId: string, planCode: string, daysLeft: number) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
    await prisma.subscription.create({ data: { groupId, planId: plan.id, status: 'TRIALING', trialEndsAt: new Date(Date.now() + daysLeft * 86_400_000) } });
    await prisma.subscriptionEvent.create({ data: { groupId, type: 'trial_started', toPlan: planCode, toStatus: 'TRIALING', reason: 'Demo data' } });
  }

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
  await paidPlan(jt.id, 'PREMIUM', 'MONTH', 12);
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
  await trial(up.id, 'PREMIUM', 9);
  // Mercy is the group's Payout Approver (an optional role), so payouts to the chair can still be approved independently.
  await prisma.membership.update({ where: { id: up.ctx.Mercy.id }, data: { specialRoles: ['PAYOUT_APPROVER'] } });
  up.ctx.Mercy = { ...up.ctx.Mercy, permissions: resolvePermissions('MEMBER', null, ['PAYOUT_APPROVER']) };
  // The treasurer drafts the schedule; the chair approves it before it becomes binding.
  const draft = await rotations.create(up.id, { name: 'Upendo Cycle 3', contributionCents: 100_000, frequency: 'WEEKLY', startDate: addDays(today, -21), orderMethod: 'AGREED', memberIds: [up.ctx.Daniel.id, up.ctx.Mercy.id, up.ctx.Peter.id, up.ctx.Amina.id, up.ctx.Joyce.id], recipientsPerRound: 1, recipientContributes: true, approvalMode: 'OFFICERS' }, up.ctx.Joyce, meta);
  const cycle = await rotations.decideActivation(up.id, draft.id, 'APPROVE', 'Order agreed at the July meeting', up.ctx.Peter, meta);
  for (const round of cycle.rounds.filter((r) => r.payoutDate <= today)) {
    for (const o of await prisma.contributionObligation.findMany({ where: { roundId: round.id } })) {
      const member = byMembership(up.ctx, o.membershipId);
      if (round.round === 4 && member.userId === users.Daniel) continue; // a shortfall in the current round
      await settle(up.ctx, member, 100_000, round.payoutDate, { targetId: o.id });
    }
    if (round.round <= 3) {
      // Prepared by the treasurer, approved by an officer who is neither the preparer nor the recipient,
      // sent with an M-Pesa reference, then confirmed independently of the sender.
      const approver = [up.ctx.Peter, up.ctx.Mercy].find((c) => c.id !== round.recipientMembershipId)!;
      await rotations.prepare(up.id, cycle.id, round.id, {}, up.ctx.Joyce, meta);
      await rotations.decidePayout(up.id, cycle.id, round.id, { decision: 'APPROVE' }, approver, meta);
      await rotations.disburse(up.id, cycle.id, round.id, { method: 'MPESA', reference: `SPAY${round.round}XYZ`, destination: 'M-Pesa (registered number)', sentAt: round.payoutDate, idempotencyKey: k() }, up.ctx.Joyce, meta);
      const recipient = byMembership(up.ctx, round.recipientMembershipId);
      if (round.round === 3) await rotations.confirm(up.id, cycle.id, round.id, { note: 'Matched SPAY3XYZ on the till statement' }, up.ctx.Mercy, meta);
      else await rotations.confirm(up.id, cycle.id, round.id, { note: 'Received, thank you' }, recipient, meta);
    }
  }

  // Where Upendo members pay. DEMO details: 174379 is Safaricom's Daraja sandbox shortcode, not a real Paybill.
  await prisma.group.update({ where: { id: up.id }, data: { settings: { ...(await prisma.group.findUniqueOrThrow({ where: { id: up.id } })).settings as object, accountReferencePrefix: 'UPENDO' } } });
  const paybill = await destinations.propose(up.id, { type: 'PAYBILL', displayName: 'Upendo Paybill (demo)', accountNumber: '174379', accountReference: 'UPENDO-<your phone>', accountName: 'UPENDO MERRY GO ROUND (DEMO)', intendedUse: ['CONTRIBUTION'], verification: 'STATEMENT_IMPORT', reason: 'Group Paybill opened (demo data)' }, up.ctx.Joyce, meta);
  const first = await destinations.decide(up.id, paybill.id, 'APPROVE', 'Checked with the bank', up.ctx.Peter, meta);
  if (first.status === 'PENDING_APPROVAL') await destinations.decide(up.id, paybill.id, 'APPROVE', undefined, up.ctx.Mercy, meta);
  // A proposal waiting for approval, so the approval flow has something to show.
  await destinations.propose(up.id, { type: 'PERSONAL_MPESA', displayName: 'Treasurer M-Pesa — Joyce (demo)', accountNumber: '0700000003', accountName: 'JOYCE WANJIRU', intendedUse: [], verification: 'MANUAL_REVIEW', reason: 'Backup for members whose Paybill payments fail (demo)' }, up.ctx.Joyce, meta);
  // Daniel reports his round-4 payment; docs/samples/upendo-paybill-statement-demo.csv contains the matching line.
  const round4 = await prisma.contributionObligation.findFirst({ where: { groupId: up.id, membershipId: up.ctx.Daniel.id, round: { round: 4 } } });
  if (round4) await contributions.record(up.id, { memberId: up.ctx.Daniel.id, amountCents: 100_000, method: 'MPESA', reference: 'SDAN4RPT01', paidAt: today, purpose: 'CONTRIBUTION', targetId: round4.id, destinationId: paybill.id, idempotencyKey: k() }, up.ctx.Daniel, meta);

  // 3) Mombasa Investment Chama — Amina is CHAIRPERSON.
  const mi = await group('Mombasa Investment Chama', 'INVESTMENT', [['Amina', 'CHAIRPERSON'], ['Brian', 'TREASURER'], ['Lucy', 'SECRETARY'], ['Daniel', 'MEMBER'], ['Samuel', 'AUDITOR']], 3);
  await paidPlan(mi.id, 'STANDARD', 'YEAR', 40);
  // Daniel is a Joint Signatory, so Mombasa can switch on "require a joint signatory" for money movements.
  await prisma.membership.update({ where: { id: mi.ctx.Daniel.id }, data: { specialRoles: ['JOINT_SIGNATORY'] } });
  mi.ctx.Daniel = { ...mi.ctx.Daniel, permissions: resolvePermissions('MEMBER', null, ['JOINT_SIGNATORY']) };
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

  // Demo help requests, opened through the same service the apps use.
  const support = app.get(SupportService);
  await support.open(users.Daniel, { subject: 'My March contribution shows as pending', category: 'CONTRIBUTIONS_PAYMENTS', description: 'I paid KES 2,000 by M-Pesa on 3 March but the app still shows it as pending verification.', groupId: up.id }, meta);
  await support.open(users.Amina, { subject: 'How do I download our annual statement?', category: 'TECHNICAL', description: 'We need the statement for our AGM next week. Where do I find the PDF?', groupId: mi.id }, meta);

  console.log('Demo data seeded. Password for all demo users: Demo1234');
  console.log('  0700 000 001  Amina — treasurer / chairperson / member in different Chamas');
  console.log('  Upendo: 002 Peter (chair) · 003 Joyce (treasurer) · 005 Mercy (payout approver) · 004 Daniel (member)');
  console.log('  Try statement import as Joyce with docs/samples/upendo-paybill-statement-demo.csv');
  console.log('  Mombasa: 009 Lucy (secretary) · 006 Samuel (auditor) · 004 Daniel (joint signatory)');
  console.log(staffSeeded ? '  Staff portal (/platform/login): owner@, admin@, helper@, analyst@, finance@staff.chamahub.test with SEED_PLATFORM_PASSWORD' : '  Staff portal: no staff seeded. Run npm run platform:bootstrap (or reseed with SEED_PLATFORM_PASSWORD set).');
  console.log('  Plans: Jitegemee Premium (paid, test mode) · Mombasa Standard annual · Upendo Premium trial · Family Welfare Free');
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
