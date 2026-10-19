import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LedgerAccount, LedgerEntryType, Prisma } from '@prisma/client';
import { addDays, GroupRole, GroupStatement, LedgerLine, PersonalGroupLine, PersonalStatement, Permission } from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { dbDate, isoDate, today } from '../../common/dates';
import { n } from '../../common/money';
import { MembershipContext, RequestMeta } from '../../common/request';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { MemberFinanceService } from '../finance/member-finance.service';
import { readSettings } from '../finance/policies';
import { NotificationsService } from '../notifications/notifications.service';

const entryInclude = {
  lines: true,
  reverses: { select: { type: true } },
  membership: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.JournalEntryInclude;
type Entry = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

/** A reversal is classified as the type it reverses (its lines carry the opposite sign). */
export const effectiveType = (e: { type: LedgerEntryType; reverses: { type: LedgerEntryType } | null }) => (e.type === 'REVERSAL' && e.reverses ? e.reverses.type : e.type);
const sumAccount = (e: Entry, account: LedgerAccount) => e.lines.filter((l) => l.account === account).reduce((a, l) => a + n(l.amountCents), 0);

const TYPE_LABEL: Record<string, string> = {
  CONTRIBUTION: 'Contribution',
  LOAN_DISBURSEMENT: 'Loan disbursed',
  LOAN_REPAYMENT_PRINCIPAL: 'Loan repayment',
  LOAN_REPAYMENT_INTEREST: 'Loan interest',
  FINE_PAYMENT: 'Fine paid',
  EXPENSE: 'Expense',
  PAYOUT: 'Rotation payout',
  DISTRIBUTION: 'Distribution',
  OPENING_BALANCE: 'Opening balance',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
  OTHER_INCOME: 'Other income',
};

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly finance: MemberFinanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async groupStatement(groupId: string, from: string, to: string, opts: { showMemberNames: boolean }): Promise<GroupStatement> {
    if (from > to) throw new UnprocessableEntityException('"From" must be before "to"');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
    const [opening, entries, loansOutstanding] = await Promise.all([
      this.ledger.cashBalance(groupId, { before: from }),
      this.prisma.journalEntry.findMany({
        where: { groupId, entryDate: { gte: dbDate(from), lte: dbDate(to) } },
        include: entryInclude,
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.ledger.accountBalance(groupId, 'LOANS_RECEIVABLE', { until: to }),
    ]);
    const s = { contributions: 0, repayments: 0, interest: 0, fines: 0, other: 0, expenses: 0, disbursed: 0, payouts: 0, distributions: 0 };
    let balance = opening;
    const transactions: LedgerLine[] = [];
    for (const e of entries) {
      const t = effectiveType(e);
      const cash = sumAccount(e, 'CASH');
      if (t === 'OPENING_BALANCE') {
        // Migrated balances: only the cash part moves the cashbook. Imported
        // loan books post receivables against opening equity with no cash.
        s.other += cash;
      } else {
        s.contributions -= sumAccount(e, 'MEMBER_CONTRIBUTIONS');
        s.interest -= sumAccount(e, 'INTEREST_INCOME');
        s.fines -= sumAccount(e, 'FINE_INCOME');
        s.other -= sumAccount(e, 'OTHER_INCOME');
        s.expenses += sumAccount(e, 'EXPENSES');
        s.payouts += sumAccount(e, 'PAYOUTS');
        s.distributions += sumAccount(e, 'DISTRIBUTIONS');
        const receivable = sumAccount(e, 'LOANS_RECEIVABLE');
        if (t === 'LOAN_DISBURSEMENT') s.disbursed += receivable;
        else s.repayments -= receivable;
      }
      if (cash === 0) continue;
      balance += cash;
      transactions.push({
        id: e.id,
        date: isoDate(e.entryDate),
        type: e.type === 'REVERSAL' ? `Reversal of ${TYPE_LABEL[t] ?? t}` : (TYPE_LABEL[e.type] ?? e.type),
        description: e.description,
        reference: e.reference,
        inflowCents: cash > 0 ? cash : 0,
        outflowCents: cash < 0 ? -cash : 0,
        balanceCents: balance,
        memberName: opts.showMemberNames ? (e.membership?.user.fullName ?? null) : null,
      });
    }
    const closing = await this.ledger.cashBalance(groupId, { until: to });
    return {
      groupId,
      groupName: group.name,
      from,
      to,
      openingBalanceCents: opening,
      contributionsCents: s.contributions,
      loanRepaymentsCents: s.repayments,
      interestReceivedCents: s.interest,
      finesReceivedCents: s.fines,
      otherIncomeCents: s.other,
      expensesCents: s.expenses,
      loansDisbursedCents: s.disbursed,
      payoutsCents: s.payouts,
      distributionsCents: s.distributions,
      closingBalanceCents: closing,
      loansOutstandingCents: loansOutstanding,
      transactions,
      generatedAt: new Date().toISOString(),
    };
  }

  async publish(groupId: string, from: string, to: string, actor: MembershipContext, meta: RequestMeta) {
    if (to > today()) throw new UnprocessableEntityException('Statements can only be published for completed periods');
    const snapshot = await this.groupStatement(groupId, from, to, { showMemberNames: false });
    const p = await this.prisma.publishedStatement.create({ data: { groupId, periodFrom: dbDate(from), periodTo: dbDate(to), snapshot: snapshot as unknown as Prisma.InputJsonValue, publishedById: actor.userId } });
    await this.audit.log({ groupId, actorUserId: actor.userId, action: 'statement.published', entityType: 'PublishedStatement', entityId: p.id, after: { from, to, closing: snapshot.closingBalanceCents }, meta });
    const users = await this.notifications.groupUserIds(groupId);
    await this.notifications.notify(users, { groupId, type: 'STATEMENT_PUBLISHED', title: 'Group statement published', body: `The financial statement for ${from} to ${to} is now available.`, data: { statementId: p.id } });
    return { id: p.id };
  }

  async published(groupId: string) {
    const rows = await this.prisma.publishedStatement.findMany({ where: { groupId }, orderBy: { publishedAt: 'desc' }, take: 60 });
    return rows.map((r) => {
      const snap = r.snapshot as unknown as GroupStatement;
      return { id: r.id, from: isoDate(r.periodFrom), to: isoDate(r.periodTo), publishedAt: r.publishedAt.toISOString(), closingBalanceCents: snap.closingBalanceCents };
    });
  }

  async publishedOne(groupId: string, id: string, viewer: MembershipContext): Promise<GroupStatement> {
    const r = await this.prisma.publishedStatement.findFirst({ where: { id, groupId } });
    if (!r) throw new NotFoundException('Statement not found');
    const snap = r.snapshot as unknown as GroupStatement;
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { settings: true } });
    // Member names are withheld unless the viewer may see member financials.
    const names = viewer.permissions.includes(Permission.MEMBERS_VIEW_FINANCIALS) || readSettings(group.settings).membersCanViewMemberBalances;
    return names ? snap : { ...snap, transactions: snap.transactions.map((t) => ({ ...t, memberName: null })) };
  }

  /** One statement across every Chama the user belongs to, from each group's authoritative ledger. */
  async personal(userId: string, from: string, to: string): Promise<PersonalStatement> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });
    const memberships = await this.prisma.membership.findMany({ where: { userId }, include: { group: { select: { name: true } } } });
    const groups: PersonalGroupLine[] = [];
    for (const m of memberships) {
      const entries = await this.prisma.journalEntry.findMany({
        where: { groupId: m.groupId, membershipId: m.id, entryDate: { gte: dbDate(from), lte: dbDate(to) } },
        include: entryInclude,
      });
      const line: PersonalGroupLine = {
        groupId: m.groupId,
        groupName: m.group.name,
        role: m.role as GroupRole,
        contributionsCents: 0,
        outstandingContributionsCents: (await this.finance.outstandingObligations(m.groupId, [m.id])).get(m.id) ?? 0,
        loansReceivedCents: 0,
        loanRepaymentsCents: 0,
        interestPaidCents: 0,
        loanBalanceCents: (await this.finance.loanBalances(m.groupId, [m.id])).get(m.id) ?? 0,
        finesPaidCents: 0,
        payoutsReceivedCents: 0,
        distributionsReceivedCents: 0,
        shares: m.shares,
      };
      // Each journal entry is counted exactly once, classified by account.
      for (const e of entries) {
        const t = effectiveType(e);
        line.contributionsCents -= sumAccount(e, 'MEMBER_CONTRIBUTIONS');
        line.interestPaidCents -= sumAccount(e, 'INTEREST_INCOME');
        line.finesPaidCents -= sumAccount(e, 'FINE_INCOME');
        line.payoutsReceivedCents += sumAccount(e, 'PAYOUTS');
        line.distributionsReceivedCents += sumAccount(e, 'DISTRIBUTIONS');
        const receivable = sumAccount(e, 'LOANS_RECEIVABLE');
        if (t === 'LOAN_DISBURSEMENT' || t === 'OPENING_BALANCE') line.loansReceivedCents += receivable;
        else line.loanRepaymentsCents -= receivable;
      }
      const touched = entries.length > 0 || line.outstandingContributionsCents > 0 || line.loanBalanceCents > 0 || m.status !== 'EXITED';
      if (touched) groups.push(line);
    }
    const keys = ['contributionsCents', 'outstandingContributionsCents', 'loansReceivedCents', 'loanRepaymentsCents', 'interestPaidCents', 'loanBalanceCents', 'finesPaidCents', 'payoutsReceivedCents', 'distributionsReceivedCents'] as const;
    const totals = Object.fromEntries(keys.map((k) => [k, groups.reduce((a, g) => a + g[k], 0)])) as PersonalStatement['totals'];
    const upcoming = await this.finance.obligationItems({ membershipIds: memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.id), from: today(), to: addDays(today(), 60) });
    return {
      userName: user.fullName,
      from,
      to,
      groups,
      totals,
      upcoming: upcoming.filter((u) => u.outstandingCents > 0),
      generatedAt: new Date().toISOString(),
      notes: [
        'Loans received are borrowed money owed back to the group; they are not income.',
        'Payouts and distributions are shown separately from contributions; returned capital is not profit.',
        'Only confirmed transactions are included. Pending payments appear once an officer verifies them.',
      ],
    };
  }
}
