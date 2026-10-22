import { Injectable } from '@nestjs/common';
import { AiCard, formatDate, isoDateSchema, LABELS, Permission } from '@chamahub/shared';
import { z } from 'zod';
import { dbDate, isoDate, today } from '../../../common/dates';
import { n } from '../../../common/money';
import { PrismaService } from '../../../prisma/prisma.service';
import { SummariesService } from '../../collections/summaries.service';
import { ContributionsService } from '../../contributions/contributions.service';
import { MemberFinanceService } from '../../finance/member-finance.service';
import { readLoanPolicy, readSettings } from '../../finance/policies';
import { LoansService } from '../../loans/loans.service';
import { RotationsService } from '../../rotations/rotations.service';
import { StatementsService } from '../../statements/statements.service';
import { AiToolDefinition, card, defineTool, money, NO_INPUT, ToolContext } from './registry';

const P = Permission;
const d = (iso: string | null | undefined) => (iso ? formatDate(iso.slice(0, 10)) : '—');
const monthStart = (t: string) => `${t.slice(0, 7)}-01`;
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase();

const INTEREST_EXPLAINED: Record<string, string> = {
  FLAT: 'Flat rate: interest is the rate × the original principal for every repayment period, so each period carries the same interest however much has been repaid.',
  ONE_OFF: 'One-off: the rate is charged once on the principal for the whole loan, then spread across the installments.',
  REDUCING_BALANCE: 'Reducing balance (equal principal): each installment repays the same principal, and interest is the rate × the balance still owed, so installments get smaller.',
  AMORTIZED: 'Reducing balance (equal installments): interest is charged on the balance still owed, and installments are set so every payment is the same amount.',
};

const MISSED_POLICY: Record<string, string> = {
  PAY_CONFIRMED_WITH_REASON: 'If a round is not fully collected, officers may pay out what is confirmed, with a recorded reason.',
  HOLD_UNTIL_COMPLETE: 'If a round is not fully collected, the payout waits until it is.',
};

/**
 * The assistant's tools. Each one reads authoritative records through the
 * existing services, as the authenticated member, in their current group.
 * No tool writes to the ledger, approves anything or moves money.
 */
@Injectable()
export class AiToolsService {
  readonly tools: Map<string, AiToolDefinition>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: MemberFinanceService,
    private readonly contributions: ContributionsService,
    private readonly loans: LoansService,
    private readonly rotations: RotationsService,
    private readonly statements: StatementsService,
    private readonly summaries: SummariesService,
  ) {
    const list: AiToolDefinition[] = [
      this.myFinancialSummary(),
      this.myContributions(),
      this.myLoans(),
      this.loanStatement(),
      this.groupCollectionSummary(),
      this.outstandingContributions(),
      this.reconciliationQueue(),
      this.rotationSchedule(),
      this.payoutReadiness(),
      this.groupFinancialReport(),
      this.approvedMinutes(),
      this.groupRules(),
      this.draftWhatsapp(),
    ];
    this.tools = new Map(list.map((t) => [t.name, t]));
  }

  private async activeCycleId(groupId: string) {
    const c = await this.prisma.payoutCycle.findFirst({ where: { groupId, status: { in: ['ACTIVE', 'DRAFT'] } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], select: { id: true } });
    return c?.id ?? null;
  }

  /* ---------- the member's own records ---------- */

  private myFinancialSummary() {
    return defineTool({
      name: 'get_my_financial_summary',
      description: 'The signed-in member’s own position in this group: confirmed contributions, amount owed now, payments awaiting verification, loan balance, fines, next contribution due and their payout turn.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [],
      run: async (ctx: ToolContext) => {
        const me = ctx.viewer.id;
        const [b, upcoming, pending, cycleId] = await Promise.all([
          this.finance.balances(ctx.groupId, [me]).then((m) => m.get(me)!),
          this.finance.obligationItems({ membershipIds: [me], from: today() }),
          this.prisma.payment.aggregate({ where: { groupId: ctx.groupId, membershipId: me, status: 'PENDING' }, _sum: { amountCents: true }, _count: true }),
          ctx.viewer.permissions.includes(P.ROTATIONS_VIEW) ? this.activeCycleId(ctx.groupId) : null,
        ]);
        const next = upcoming.filter((o) => o.outstandingCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        const facts = [
          { label: 'Confirmed contributions', value: money(b.contributedCents) },
          { label: 'Owed now (due and unpaid)', value: money(b.outstandingCents) },
          { label: 'Awaiting verification (not counted yet)', value: `${money(n(pending._sum.amountCents))} in ${pending._count} payment(s)` },
          { label: 'Loan balance', value: money(b.loanBalanceCents) },
          { label: 'Fines outstanding', value: money(b.finesOutstandingCents) },
          { label: 'Next contribution', value: next ? `${money(next.outstandingCents)} for ${next.periodLabel}, due ${d(next.dueDate)}` : 'Nothing upcoming' },
        ];
        if (cycleId) {
          const c = await this.rotations.detail(ctx.groupId, cycleId, ctx.viewer);
          const mine = c.myRounds.filter((r) => r.status !== 'CANCELLED');
          facts.push({ label: 'My payout turn', value: mine.length ? mine.map((r) => `round ${r.round} on ${d(r.payoutDate)} (${titleCase(r.status)})`).join('; ') : `Not in ${c.name}` });
        }
        return card({ tool: 'get_my_financial_summary', title: `My position in ${ctx.groupName}`, facts, notes: ['Only confirmed payments count towards contributions.'], links: [{ label: 'My contributions', target: 'my-contributions' }] });
      },
    });
  }

  private myContributions() {
    return defineTool({
      name: 'get_my_contributions',
      description: 'The signed-in member’s contribution periods (amount, paid, pending, status) and their recent payments with verification status. Optional date range.',
      jsonSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD, inclusive (default: 6 months ago)' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive (default: today)' },
          outstandingOnly: { type: 'boolean', description: 'Only periods that still have money owed' },
        },
        additionalProperties: false,
      },
      input: z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional(), outstandingOnly: z.boolean().optional() }).strict(),
      anyOf: [],
      run: async (ctx, input) => {
        const to = input.to ?? today();
        const from = input.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 183 * 86_400_000).toISOString().slice(0, 10);
        const [items, payments] = await Promise.all([
          this.finance.obligationItems({ membershipIds: [ctx.viewer.id], from, to }),
          this.prisma.payment.findMany({ where: { groupId: ctx.groupId, membershipId: ctx.viewer.id }, orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }], take: 10 }),
        ]);
        const shown = items.filter((o) => (input.outstandingOnly ? o.outstandingCents > 0 : true)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
        const periods = card({
          tool: 'get_my_contributions',
          title: 'My contributions',
          period: { from, to },
          facts: [
            { label: 'Due in period', value: money(items.reduce((a, o) => a + o.amountCents, 0)) },
            { label: 'Paid (confirmed)', value: money(items.reduce((a, o) => a + o.paidCents, 0)) },
            { label: 'Awaiting verification', value: money(items.reduce((a, o) => a + o.pendingCents, 0)) },
            { label: 'Still owed', value: money(items.reduce((a, o) => a + o.outstandingCents, 0)) },
          ],
          columns: ['Period', 'Due', 'Amount', 'Paid', 'Pending', 'Status'],
          rows: shown.map((o) => [o.periodLabel, d(o.dueDate), money(o.amountCents), money(o.paidCents), money(o.pendingCents), titleCase(o.status)]),
          links: [{ label: 'My contributions', target: 'my-contributions' }],
        });
        const recent = card({
          tool: 'get_my_contributions',
          title: 'My recent payments',
          columns: ['Date', 'Amount', 'For', 'Reference', 'Status'],
          rows: payments.map((p) => [d(isoDate(p.paidAt)), money(n(p.amountCents)), titleCase(p.purpose), p.reference ?? '—', titleCase(p.status)]),
          notes: ['A pending payment counts only after an officer, a statement or M-Pesa confirms it.'],
          links: payments.slice(0, 5).map((p) => ({ label: `${money(n(p.amountCents))} on ${d(isoDate(p.paidAt))}`, target: 'payment' as const, id: p.id })),
        });
        return [periods, recent];
      },
    });
  }

  private myLoans() {
    return defineTool({
      name: 'get_my_loans',
      description: 'The signed-in member’s own loans in this group with balance, status and next installment.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [],
      run: async (ctx) => {
        const rows = await this.loans.list(ctx.groupId, ctx.viewer, { memberId: ctx.viewer.id });
        const mine = rows.filter((l) => l.membershipId === ctx.viewer.id);
        return card({
          tool: 'get_my_loans',
          title: 'My loans',
          facts: [{ label: 'Outstanding on active loans', value: money(mine.filter((l) => l.status === 'DISBURSED').reduce((a, l) => a + l.outstandingCents, 0)) }],
          columns: ['Purpose', 'Principal', 'Outstanding', 'Overdue', 'Status', 'Next installment'],
          rows: mine.map((l) => [l.purpose, money(l.principalCents), money(l.outstandingCents), money(l.overdueCents), titleCase(l.status), l.nextInstallment ? `${money(l.nextInstallment.amountCents)} on ${d(l.nextInstallment.dueDate)}` : '—']),
          links: mine.slice(0, 5).map((l) => ({ label: `${l.purpose} (${money(l.principalCents)})`, target: 'loan' as const, id: l.id })),
          notes: mine.length ? [] : ['You have no loans in this group.'],
        });
      },
    });
  }

  private loanStatement() {
    return defineTool({
      name: 'get_loan_statement',
      description: 'Repayment schedule and repayments for one loan. Members can open only their own loans; loan officers can open any loan in the group. Get loan ids from get_my_loans.',
      jsonSchema: { type: 'object', properties: { loanId: { type: 'string' } }, required: ['loanId'], additionalProperties: false },
      input: z.object({ loanId: z.string().min(1).max(40) }).strict(),
      anyOf: [],
      run: async (ctx, input) => {
        const l = await this.loans.detail(ctx.groupId, input.loanId, ctx.viewer);
        return card({
          tool: 'get_loan_statement',
          title: `Loan: ${l.purpose}${l.membershipId === ctx.viewer.id ? '' : ` (${l.memberName})`}`,
          facts: [
            { label: 'Principal', value: money(l.principalCents) },
            { label: 'Interest', value: `${money(l.interestCents)} — ${LABELS.interestMethod[l.interestMethod]}, ${(l.rateBps / 100).toFixed(2)}%` },
            { label: 'Total repayable', value: money(l.totalRepayableCents) },
            { label: 'Paid (confirmed)', value: money(l.paidCents) },
            { label: 'Outstanding', value: money(l.outstandingCents) },
            { label: 'Overdue', value: money(l.overdueCents) },
            { label: 'Status', value: titleCase(l.status) },
          ],
          columns: ['#', 'Due', 'Principal', 'Interest', 'Total', 'Paid', 'Status'],
          rows: l.schedule.map((i) => [String(i.number), d(i.dueDate), money(i.principalCents), money(i.interestCents), money(i.totalCents), money(i.paidCents), titleCase(i.status)]),
          notes: [INTEREST_EXPLAINED[l.interestMethod] ?? ''],
          links: [{ label: 'Open loan', target: 'loan', id: l.id }],
        });
      },
    });
  }

  /* ---------- group-wide (officers) ---------- */

  private groupCollectionSummary() {
    return defineTool({
      name: 'get_group_collection_summary',
      description: 'Group contribution collection for a month: amount due so far, confirmed, awaiting verification, members up to date. Use for "how much have we collected" and "why is collection below target".',
      jsonSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (default: current month)' } }, additionalProperties: false },
      input: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict(),
      anyOf: [P.CONTRIBUTIONS_VIEW_ALL],
      run: async (ctx, input) => {
        const t = today();
        const ym = input.month ?? t.slice(0, 7);
        const from = `${ym}-01`;
        const end = monthEnd(ym);
        const to = end > t ? t : end;
        const [obligations, pending, members] = await Promise.all([
          this.prisma.contributionObligation.findMany({ where: { groupId: ctx.groupId, waivedReason: null, dueDate: { gte: dbDate(from), lte: dbDate(to) } }, select: { membershipId: true, amountCents: true, paidCents: true } }),
          this.prisma.payment.aggregate({ where: { groupId: ctx.groupId, status: 'PENDING', purpose: 'CONTRIBUTION', paidAt: { gte: dbDate(from), lte: dbDate(end) } }, _sum: { amountCents: true }, _count: true }),
          this.prisma.membership.count({ where: { groupId: ctx.groupId, status: 'ACTIVE' } }),
        ]);
        const per = new Map<string, { due: number; paid: number }>();
        for (const o of obligations) {
          const e = per.get(o.membershipId) ?? { due: 0, paid: 0 };
          e.due += n(o.amountCents);
          e.paid += Math.min(n(o.paidCents), n(o.amountCents));
          per.set(o.membershipId, e);
        }
        const due = [...per.values()].reduce((a, e) => a + e.due, 0);
        const paid = [...per.values()].reduce((a, e) => a + e.paid, 0);
        const upToDate = [...per.values()].filter((e) => e.paid >= e.due).length;
        return card({
          tool: 'get_group_collection_summary',
          title: `Collections — ${ym}`,
          period: { from, to },
          facts: [
            { label: to < end ? 'Due so far this month' : 'Due in month', value: money(due) },
            { label: 'Confirmed', value: money(paid) },
            { label: 'Collection rate', value: due ? `${Math.floor((paid * 100) / due)}%` : '—' },
            { label: 'Still owed for the month', value: money(Math.max(due - paid, 0)) },
            { label: 'Awaiting verification (not counted)', value: `${money(n(pending._sum.amountCents))} in ${pending._count} payment(s)` },
            { label: 'Members up to date', value: `${upToDate} of ${per.size} with contributions due (${members} active members)` },
          ],
          notes: ['Collected = confirmed payments only. Payments awaiting verification are listed separately and are not counted.'],
          links: [{ label: 'Contributions', target: 'contributions' }],
        });
      },
    });
  }

  private outstandingContributions() {
    return defineTool({
      name: 'get_outstanding_contributions',
      description: 'Members who owe contributions that are already due, with the amount owed, the oldest unpaid period and payments awaiting verification.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [P.CONTRIBUTIONS_VIEW_ALL],
      run: async (ctx) => {
        const owed = await this.finance.outstandingObligations(ctx.groupId);
        const ids = [...owed.entries()].filter(([, c]) => c > 0).map(([id]) => id);
        const [members, oldest, pending] = await Promise.all([
          this.prisma.membership.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, user: { select: { fullName: true } } } }),
          this.prisma.contributionObligation.findMany({ where: { groupId: ctx.groupId, membershipId: { in: ids }, status: { notIn: ['PAID', 'WAIVED'] }, dueDate: { lte: dbDate(today()) } }, orderBy: { dueDate: 'asc' }, select: { membershipId: true, periodLabel: true, dueDate: true } }),
          this.prisma.payment.groupBy({ by: ['membershipId'], where: { groupId: ctx.groupId, status: 'PENDING', membershipId: { in: ids } }, _sum: { amountCents: true } }),
        ]);
        const name = new Map(members.map((m) => [m.id, m.user.fullName]));
        const first = new Map<string, { periodLabel: string; dueDate: Date }>();
        for (const o of oldest) if (!first.has(o.membershipId)) first.set(o.membershipId, o);
        const rows = ids.map((id) => ({ id, cents: owed.get(id)!, pending: n(pending.find((p) => p.membershipId === id)?._sum.amountCents) })).sort((a, b) => b.cents - a.cents);
        return card({
          tool: 'get_outstanding_contributions',
          title: 'Outstanding contributions',
          period: { from: '—', to: today() },
          facts: [
            { label: 'Members owing', value: String(rows.length) },
            { label: 'Total owed (due and unpaid)', value: money(rows.reduce((a, r) => a + r.cents, 0)) },
            { label: 'Of which awaiting verification', value: money(rows.reduce((a, r) => a + Math.min(r.pending, r.cents), 0)) },
          ],
          columns: ['Member', 'Owed', 'Oldest unpaid', 'Awaiting verification'],
          rows: rows.map((r) => [name.get(r.id) ?? 'Member', money(r.cents), first.get(r.id) ? `${first.get(r.id)!.periodLabel} (due ${d(isoDate(first.get(r.id)!.dueDate))})` : '—', money(r.pending)]),
          notes: ['Only contributions already due are counted. A payment awaiting verification may clear part of the amount once confirmed.'],
          links: [{ label: 'Contributions', target: 'contributions' }],
        });
      },
    });
  }

  private reconciliationQueue() {
    return defineTool({
      name: 'get_payment_reconciliation_queue',
      description: 'Everything waiting for reconciliation: payments awaiting verification, unmatched M-Pesa payments, statement lines to review, duplicate references and open payment disputes.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [P.CONTRIBUTIONS_VERIFY, P.RECONCILIATION_MANAGE],
      run: async (ctx) => {
        const [pending, unmatched, lines, dups, disputes] = await Promise.all([
          this.prisma.payment.findMany({ where: { groupId: ctx.groupId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50, include: { membership: { select: { user: { select: { fullName: true } } } } } }),
          this.prisma.unmatchedPayment.count({ where: { groupId: ctx.groupId, status: 'UNMATCHED' } }),
          this.prisma.statementLine.count({ where: { groupId: ctx.groupId, state: 'OPEN', match: { notIn: ['DUPLICATE', 'OUTGOING'] }, statementImport: { status: 'REVIEWING' } } }),
          this.prisma.payment.groupBy({ by: ['reference'], where: { groupId: ctx.groupId, reference: { not: null }, status: { not: 'FAILED' } }, having: { reference: { _count: { gt: 1 } } } }),
          this.prisma.dispute.count({ where: { groupId: ctx.groupId, status: 'OPEN', paymentId: { not: null } } }),
        ]);
        const now = Date.now();
        return card({
          tool: 'get_payment_reconciliation_queue',
          title: 'Reconciliation queue',
          facts: [
            { label: 'Payments awaiting verification', value: `${pending.length}${pending.length === 50 ? '+' : ''} (${money(pending.reduce((a, p) => a + n(p.amountCents), 0))})` },
            { label: 'Unmatched M-Pesa payments', value: String(unmatched) },
            { label: 'Statement lines needing a decision', value: String(lines) },
            { label: 'Duplicate references', value: dups.length ? dups.map((x) => x.reference).join(', ') : 'None' },
            { label: 'Open payment disputes', value: String(disputes) },
          ],
          columns: ['Member', 'Amount', 'Reference', 'Source', 'Waiting'],
          rows: pending.map((p) => [p.membership?.user.fullName ?? '—', money(n(p.amountCents)), p.reference ?? '—', titleCase(p.source), `${Math.max(0, Math.floor((now - p.createdAt.getTime()) / 86_400_000))} day(s)`]),
          notes: ['Verifying, matching and resolving are done by officers in the app; the assistant cannot confirm payments.'],
          links: [{ label: 'Reconcile payments', target: 'contributions' }, ...(lines ? [{ label: 'Review statement lines', target: 'statement-import' as const }] : [])],
        });
      },
    });
  }

  private rotationSchedule() {
    return defineTool({
      name: 'get_rotation_schedule',
      description: 'The merry-go-round payout schedule for the current cycle: order, recipients, dates, status and collections per round.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [P.ROTATIONS_VIEW],
      run: async (ctx) => {
        const id = await this.activeCycleId(ctx.groupId);
        if (!id) return card({ tool: 'get_rotation_schedule', title: 'Payout rotation', notes: ['This group has no active or draft rotation.'] });
        const c = await this.rotations.detail(ctx.groupId, id, ctx.viewer);
        return card({
          tool: 'get_rotation_schedule',
          title: `${c.name}${c.status === 'DRAFT' ? ' (draft, not yet approved)' : ''}`,
          facts: [
            { label: 'Contribution', value: `${money(c.contributionCents)} ${titleCase(c.frequency)}` },
            { label: 'Order method', value: titleCase(c.orderMethod) },
            { label: 'Rounds remaining', value: String(c.remainingRounds) },
            { label: 'Next payout', value: c.currentRound ? `Round ${c.currentRound.round}: ${c.currentRound.recipientName} on ${d(c.currentRound.payoutDate)}` : 'None' },
            ...(c.myRounds.length ? [{ label: 'My turn', value: c.myRounds.map((r) => `round ${r.round} on ${d(r.payoutDate)}`).join('; ') }] : []),
          ],
          columns: ['Round', 'Recipient', 'Date', 'Status', 'Expected', 'Confirmed'],
          rows: c.rounds.map((r) => [`${r.round}${r.recipientsInRound > 1 ? `.${r.slot}` : ''}`, r.recipientName, d(r.payoutDate), titleCase(r.status), money(r.recipientsInRound > 1 ? r.expectedShareCents : r.expectedCents), money(r.confirmedCents)]),
          notes: ['The order can only change through an approved amendment.'],
          links: [{ label: 'Rotation', target: 'rotation' }],
        });
      },
    });
  }

  private payoutReadiness() {
    return defineTool({
      name: 'get_payout_readiness',
      description: 'Readiness of the next payout as evaluated by the payout engine: confirmed vs expected collection, pending verifications, each readiness check with its result, approvals. Read-only.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [P.ROTATIONS_VIEW],
      run: async (ctx) => {
        const id = await this.activeCycleId(ctx.groupId);
        const c = id ? await this.rotations.detail(ctx.groupId, id, ctx.viewer) : null;
        const r = c?.currentRound;
        if (!c || !r) return card({ tool: 'get_payout_readiness', title: 'Next payout', notes: ['There is no payout in progress.'] });
        const approved = r.approvals.filter((a) => a.decision === 'APPROVED').length;
        return card({
          tool: 'get_payout_readiness',
          title: `Round ${r.round}: ${r.recipientName}`,
          facts: [
            { label: 'Payout date', value: d(r.payoutDate) },
            { label: 'Stage', value: titleCase(r.status) },
            { label: 'Expected collection', value: money(r.expectedCents) },
            { label: 'Confirmed', value: money(r.confirmedCents) },
            { label: 'Awaiting verification (not counted)', value: money(r.pendingCents) },
            { label: 'Shortfall', value: money(r.shortfallCents) },
            ...(r.readiness ? [{ label: 'Engine says', value: r.readiness.ready ? `Ready — payable ${money(r.readiness.payableCents)}` : 'Not ready' }] : []),
            { label: 'Approvals', value: `${approved} of ${r.approvalsRequired}` },
          ],
          columns: r.readiness ? ['Check', 'Result', 'Detail'] : undefined,
          rows: r.readiness ? r.readiness.checks.map((k) => [k.label, k.status, k.detail]) : undefined,
          notes: [
            r.readiness ? 'Readiness is decided by the payout engine. The assistant cannot change the order, approve, send or complete a payout.' : 'Detailed readiness checks are shown only to officers and the recipient.',
            ...(r.shortfallReason ? [`Recorded shortfall reason: ${r.shortfallReason}`] : []),
          ],
          links: [{ label: 'Payouts', target: ctx.viewer.permissions.includes(P.ROTATIONS_MANAGE) || ctx.viewer.permissions.includes(P.PAYOUTS_APPROVE) ? 'payouts' : 'rotation' }],
        });
      },
    });
  }

  private groupFinancialReport() {
    return defineTool({
      name: 'get_group_financial_report',
      description: 'Group income and spending for a period from the ledger: opening balance, contributions, repayments, interest and fines, expenses, loans disbursed, payouts, distributions, closing balance, loans outstanding.',
      jsonSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD (default: start of this month)' }, to: { type: 'string', description: 'YYYY-MM-DD (default: today)' } }, additionalProperties: false },
      input: z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }).strict(),
      anyOf: [P.REPORTS_VIEW],
      run: async (ctx, input) => {
        const to = input.to ?? today();
        const from = input.from ?? monthStart(to);
        const s = await this.statements.groupStatement(ctx.groupId, from, to, { showMemberNames: false });
        const inflow = s.contributionsCents + s.loanRepaymentsCents + s.interestReceivedCents + s.finesReceivedCents + s.otherIncomeCents;
        const outflow = s.expensesCents + s.loansDisbursedCents + s.payoutsCents + s.distributionsCents;
        const balanced = s.openingBalanceCents + inflow - outflow === s.closingBalanceCents;
        return card({
          tool: 'get_group_financial_report',
          title: `Financial summary`,
          period: { from, to },
          facts: [
            { label: 'Opening balance', value: money(s.openingBalanceCents) },
            { label: 'Contributions', value: money(s.contributionsCents) },
            { label: 'Loan repayments', value: money(s.loanRepaymentsCents) },
            { label: 'Interest received', value: money(s.interestReceivedCents) },
            { label: 'Fines received', value: money(s.finesReceivedCents) },
            { label: 'Other income', value: money(s.otherIncomeCents) },
            { label: 'Expenses', value: money(s.expensesCents) },
            { label: 'Loans disbursed', value: money(s.loansDisbursedCents) },
            { label: 'Payouts', value: money(s.payoutsCents) },
            { label: 'Distributions', value: money(s.distributionsCents) },
            { label: 'Total in', value: money(inflow) },
            { label: 'Total out', value: money(outflow) },
            { label: 'Closing balance', value: money(s.closingBalanceCents) },
            { label: 'Loans outstanding', value: money(s.loansOutstandingCents) },
          ],
          notes: [balanced ? 'Opening balance + money in − money out = closing balance.' : 'WARNING: opening + movements does not equal closing. Do not publish; ask the treasurer and auditor to check.'],
          links: [{ label: 'Reports', target: 'reports' }],
        });
      },
    });
  }

  private approvedMinutes() {
    return defineTool({
      name: 'get_approved_meeting_minutes',
      description: 'Approved minutes of recent meetings, with resolutions and action items. Draft minutes are never included.',
      jsonSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5, description: 'How many recent meetings (default 3)' } }, additionalProperties: false },
      input: z.object({ limit: z.number().int().min(1).max(5).optional() }).strict(),
      anyOf: [P.MEETINGS_VIEW],
      run: async (ctx, input) => {
        const meetings = await this.prisma.meeting.findMany({
          where: { groupId: ctx.groupId, minutes: { status: 'APPROVED' } },
          orderBy: { scheduledAt: 'desc' },
          take: input.limit ?? 3,
          include: { minutes: true, resolutions: { orderBy: { createdAt: 'asc' } }, actions: { orderBy: { createdAt: 'asc' }, include: { assignee: { select: { user: { select: { fullName: true } } } } } } },
        });
        if (!meetings.length) return card({ tool: 'get_approved_meeting_minutes', title: 'Meeting minutes', notes: ['No approved minutes yet.'] });
        return meetings.map((m) =>
          card({
            tool: 'get_approved_meeting_minutes',
            title: `${m.title} — ${d(m.scheduledAt.toISOString())}`,
            facts: [
              { label: 'Minutes', value: 'Approved (official record)' },
              { label: 'Resolutions', value: m.resolutions.length ? m.resolutions.map((r) => `${r.title}${r.amountCents !== null ? ` (${money(n(r.amountCents))})` : ''}`).join('; ') : 'None' },
            ],
            columns: ['Action item', 'Assigned to', 'Due', 'Done'],
            rows: m.actions.map((a) => [a.description, a.assignee?.user.fullName ?? '—', d(isoDate(a.dueDate)), a.done ? 'Yes' : 'No']),
            text: (m.minutes?.body ?? '').slice(0, 4000),
            links: [{ label: 'Open meeting', target: 'meeting', id: m.id }],
          }),
        );
      },
    });
  }

  private groupRules() {
    return defineTool({
      name: 'get_group_rules',
      description: 'The group’s configured rules: contribution schedules, grace days and late fines, approvals required, payout shortfall policy, and the loan policy including how interest is calculated.',
      jsonSchema: NO_INPUT,
      input: z.object({}).strict(),
      anyOf: [],
      run: async (ctx) => {
        const g = await this.prisma.group.findUniqueOrThrow({ where: { id: ctx.groupId }, select: { settings: true, loanPolicy: true } });
        const s = readSettings(g.settings);
        const lp = readLoanPolicy(g.loanPolicy);
        const schedules = (await this.contributions.schedules(ctx.groupId)).filter((x) => x.active);
        const cards: AiCard[] = [
          card({
            tool: 'get_group_rules',
            title: 'Contribution rules',
            facts: [
              { label: 'Grace period', value: `${s.graceDays} day(s)` },
              { label: 'Late contribution fine', value: s.lateContributionFineCents ? money(s.lateContributionFineCents) : 'None' },
              { label: 'Approvals for expenses and payouts', value: String(s.requiredFinancialApprovals) },
              { label: 'Payout shortfall', value: MISSED_POLICY[s.missedContributionPolicy] ?? titleCase(s.missedContributionPolicy) },
              { label: 'Early payouts', value: s.allowEarlyPayout ? 'Allowed' : 'Not allowed' },
            ],
            columns: ['Schedule', 'Amount', 'Frequency', 'Since'],
            rows: schedules.map((x) => [x.name, money(x.amountCents), titleCase(x.frequency), d(x.startDate)]),
          }),
        ];
        cards.push(
          lp.enabled
            ? card({
                tool: 'get_group_rules',
                title: 'Loan policy',
                facts: [
                  { label: 'Interest method', value: LABELS.interestMethod[lp.interestMethod] },
                  { label: 'Rate', value: `${(lp.rateBps / 100).toFixed(2)}% ${lp.interestMethod === 'ONE_OFF' ? 'for the whole loan' : `per ${titleCase(lp.repaymentFrequency).replace(/ly$/, '')} period`}` },
                  { label: 'Maximum installments', value: String(lp.maxInstallments) },
                  { label: 'Borrowing limit', value: `${(lp.maxMultipleOfSavingsBps / 10000).toFixed(1)}× confirmed savings${lp.maxPrincipalCents ? `, at most ${money(lp.maxPrincipalCents)}` : ''}` },
                  { label: 'Approvals required', value: String(lp.requiredApprovals) },
                  { label: 'Late penalty', value: lp.latePenaltyBps ? `${(lp.latePenaltyBps / 100).toFixed(2)}%` : 'None' },
                ],
                notes: [INTEREST_EXPLAINED[lp.interestMethod]],
              })
            : card({ tool: 'get_group_rules', title: 'Loan policy', notes: ['Loans are switched off in this group.'] }),
        );
        return cards;
      },
    });
  }

  private draftWhatsapp() {
    return defineTool({
      name: 'draft_whatsapp_report',
      description: 'A WhatsApp-ready message built from confirmed records, for a person to review and share: "collections" (this or another month), "how_to_pay", "payment_receipt" (needs paymentId) or "payout_notice" (needs roundId, only after the payout is confirmed).',
      jsonSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['collections', 'how_to_pay', 'payment_receipt', 'payout_notice'] },
          month: { type: 'string', description: 'YYYY-MM for collections' },
          paymentId: { type: 'string' },
          roundId: { type: 'string' },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      input: z
        .object({ kind: z.enum(['collections', 'how_to_pay', 'payment_receipt', 'payout_notice']), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), paymentId: z.string().max(40).optional(), roundId: z.string().max(40).optional() })
        .strict()
        .refine((v) => (v.kind === 'payment_receipt' ? !!v.paymentId : v.kind === 'payout_notice' ? !!v.roundId : true), { message: 'paymentId or roundId is required for this kind' }),
      anyOf: [],
      run: async (ctx, input) => {
        const s =
          input.kind === 'collections' ? await this.summaries.collections(ctx.groupId, ctx.viewer, input.month)
          : input.kind === 'how_to_pay' ? await this.summaries.howToPay(ctx.groupId)
          : input.kind === 'payment_receipt' ? await this.summaries.receipt(ctx.groupId, input.paymentId!, ctx.viewer)
          : await this.summaries.payout(ctx.groupId, input.roundId!, ctx.viewer);
        return card({ tool: 'draft_whatsapp_report', kind: 'DRAFT', title: `WhatsApp draft: ${s.title}`, text: s.text, notes: ['Review before sharing. Built from confirmed records; contains no one’s loans or balances.', ...(s.namesMembers ? ['This message names members.'] : [])] });
      },
    });
  }
}
