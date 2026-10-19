import { Injectable } from '@nestjs/common';
import { ObligationItem } from '@chamahub/shared';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { n } from '../../common/money';
import { dbDate, isoDate, today } from '../../common/dates';
import { obligationStatus } from './obligations.service';
import { readSettings } from './policies';

export interface MemberBalances {
  contributedCents: number;
  outstandingCents: number;
  loanBalanceCents: number;
  finesOutstandingCents: number;
}

/** Read-side aggregates for members, always derived from authoritative records. */
@Injectable()
export class MemberFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirmed contributions (net of reversals) straight from the ledger. */
  async savingsByMembership(groupId: string, membershipIds?: string[], range?: { from?: string; to?: string }, tx?: Tx) {
    const client = tx ?? this.prisma;
    const lines = await client.journalLine.groupBy({
      by: ['entryId'],
      where: { account: 'MEMBER_CONTRIBUTIONS', entry: this.entryWhere(groupId, membershipIds, range) },
      _sum: { amountCents: true },
    });
    if (lines.length === 0) return new Map<string, number>();
    const entries = await client.journalEntry.findMany({
      where: { id: { in: lines.map((l) => l.entryId) } },
      select: { id: true, membershipId: true },
    });
    const owner = new Map(entries.map((e) => [e.id, e.membershipId]));
    const totals = new Map<string, number>();
    for (const l of lines) {
      const m = owner.get(l.entryId);
      if (!m) continue;
      totals.set(m, (totals.get(m) ?? 0) - n(l._sum.amountCents));
    }
    return totals;
  }

  private entryWhere(groupId: string, membershipIds?: string[], range?: { from?: string; to?: string }) {
    return {
      groupId,
      ...(membershipIds ? { membershipId: { in: membershipIds } } : { membershipId: { not: null } }),
      ...(range?.from || range?.to
        ? { entryDate: { ...(range.from ? { gte: dbDate(range.from) } : {}), ...(range.to ? { lte: dbDate(range.to) } : {}) } }
        : {}),
    };
  }

  async outstandingObligations(groupId: string, membershipIds?: string[], tx?: Tx) {
    const client = tx ?? this.prisma;
    const rows = await client.contributionObligation.groupBy({
      by: ['membershipId'],
      where: {
        groupId,
        ...(membershipIds ? { membershipId: { in: membershipIds } } : {}),
        status: { notIn: ['PAID', 'WAIVED'] },
        dueDate: { lte: dbDate(today()) },
      },
      _sum: { amountCents: true, paidCents: true },
    });
    return new Map(rows.map((r) => [r.membershipId, n(r._sum.amountCents) - n(r._sum.paidCents)]));
  }

  /** Outstanding principal + interest across disbursed loans. */
  async loanBalances(groupId: string, membershipIds?: string[], tx?: Tx) {
    const client = tx ?? this.prisma;
    const loans = await client.loan.findMany({
      where: { groupId, status: 'DISBURSED', ...(membershipIds ? { membershipId: { in: membershipIds } } : {}) },
      select: { membershipId: true, installments: { select: { principalCents: true, interestCents: true, principalPaidCents: true, interestPaidCents: true } } },
    });
    const totals = new Map<string, number>();
    for (const l of loans) {
      const owed = l.installments.reduce((a, i) => a + n(i.principalCents) + n(i.interestCents) - n(i.principalPaidCents) - n(i.interestPaidCents), 0);
      totals.set(l.membershipId, (totals.get(l.membershipId) ?? 0) + owed);
    }
    return totals;
  }

  async outstandingPrincipal(groupId: string, membershipId: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    const r = await client.loanInstallment.aggregate({
      where: { loan: { groupId, membershipId, status: 'DISBURSED' } },
      _sum: { principalCents: true, principalPaidCents: true },
    });
    return n(r._sum.principalCents) - n(r._sum.principalPaidCents);
  }

  async finesOutstanding(groupId: string, membershipIds?: string[], tx?: Tx) {
    const client = tx ?? this.prisma;
    const rows = await client.fine.groupBy({
      by: ['membershipId'],
      where: { groupId, status: { in: ['OUTSTANDING', 'PARTIAL'] }, ...(membershipIds ? { membershipId: { in: membershipIds } } : {}) },
      _sum: { amountCents: true, paidCents: true },
    });
    return new Map(rows.map((r) => [r.membershipId, n(r._sum.amountCents) - n(r._sum.paidCents)]));
  }

  async balances(groupId: string, membershipIds?: string[]): Promise<Map<string, MemberBalances>> {
    const [savings, outstanding, loans, fines] = await Promise.all([
      this.savingsByMembership(groupId, membershipIds),
      this.outstandingObligations(groupId, membershipIds),
      this.loanBalances(groupId, membershipIds),
      this.finesOutstanding(groupId, membershipIds),
    ]);
    const ids = membershipIds ?? [...new Set([...savings.keys(), ...outstanding.keys(), ...loans.keys(), ...fines.keys()])];
    return new Map(
      ids.map((id) => [
        id,
        {
          contributedCents: savings.get(id) ?? 0,
          outstandingCents: outstanding.get(id) ?? 0,
          loanBalanceCents: loans.get(id) ?? 0,
          finesOutstandingCents: fines.get(id) ?? 0,
        },
      ]),
    );
  }

  /** Obligations for a set of memberships (possibly across groups) as API items. */
  async obligationItems(where: { membershipIds: string[]; from?: string; to?: string; statuses?: string[] }): Promise<ObligationItem[]> {
    const rows = await this.prisma.contributionObligation.findMany({
      where: {
        membershipId: { in: where.membershipIds },
        ...(where.from || where.to ? { dueDate: { ...(where.from ? { gte: dbDate(where.from) } : {}), ...(where.to ? { lte: dbDate(where.to) } : {}) } } : {}),
      },
      orderBy: { dueDate: 'asc' },
      include: {
        group: { select: { name: true, settings: true } },
        schedule: { select: { name: true } },
        membership: { select: { user: { select: { fullName: true } } } },
      },
    });
    const pending = await this.prisma.payment.groupBy({
      by: ['targetId'],
      where: { status: 'PENDING', purpose: 'CONTRIBUTION', targetId: { in: rows.map((r) => r.id) } },
      _sum: { amountCents: true },
    });
    const pendingBy = new Map(pending.map((p) => [p.targetId, n(p._sum.amountCents)]));
    const t = today();
    const items = rows.map((o) => {
      const status = obligationStatus(o, t, readSettings(o.group.settings).graceDays);
      const amount = n(o.amountCents);
      const paid = n(o.paidCents);
      return {
        id: o.id,
        groupId: o.groupId,
        groupName: o.group.name,
        membershipId: o.membershipId,
        memberName: o.membership.user.fullName,
        scheduleName: o.schedule.name,
        periodLabel: o.periodLabel,
        dueDate: isoDate(o.dueDate),
        amountCents: amount,
        paidCents: paid,
        pendingCents: pendingBy.get(o.id) ?? 0,
        outstandingCents: status === 'WAIVED' ? 0 : Math.max(amount - paid, 0),
        status,
      } satisfies ObligationItem;
    });
    return where.statuses ? items.filter((i) => where.statuses!.includes(i.status)) : items;
  }
}
