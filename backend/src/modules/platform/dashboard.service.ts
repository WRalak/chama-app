import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformDashboard, SupportStatus } from '@chamahub/shared';
import { PrismaService } from '../../prisma/prisma.service';

type Bucket = PlatformDashboard['range']['bucket'];

/**
 * Owner dashboard figures, all computed from real records. Revenue counts only verified,
 * live-mode payments; test payments, pending checkouts and refunds are reported separately and
 * currencies are never added together.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async build(from: Date, to: Date, includeRevenue: boolean): Promise<PlatformDashboard> {
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    const bucket: Bucket = days <= 31 ? 'day' : days <= 182 ? 'week' : 'month';
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const now = new Date();

    const [users, groups, activeGroups30d, newUsers, newGroups, paying, trial, activeHelpers, openCases, critical] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.group.count({ where: { status: { not: 'ARCHIVED' } } }),
      this.prisma.group.count({ where: { status: 'ACTIVE', journalEntries: { some: { createdAt: { gte: since30 } } } } }),
      this.prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.group.count({ where: { createdAt: { gte: from, lt: to } } }),
      // Paying = a paid plan on a period that was actually paid for (trials and promotions excluded).
      this.prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, amountMinor: { gt: 0 }, plan: { tier: { gt: 0 } }, group: { status: { not: 'ARCHIVED' } } } }),
      this.prisma.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gt: now }, group: { status: { not: 'ARCHIVED' } } } }),
      this.prisma.platformAccount.count({ where: { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], assignedCases: { some: {} } } }),
      this.prisma.supportCase.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      // Critical = unresolved urgent cases and unresolved security reports.
      this.prisma.supportCase.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] }, OR: [{ priority: 'URGENT' }, { category: 'SECURITY' }] } }),
    ]);

    const registrations = await this.registrations(from, to, bucket);
    const planRows = await this.prisma.$queryRaw<{ plan: string; groups: bigint }[]>`
      SELECT COALESCE(CASE WHEN s.status IN ('ACTIVE','PAST_DUE','TRIALING') THEN p.name END, 'Free') AS plan, COUNT(*) AS groups
      FROM groups g
      LEFT JOIN subscriptions s ON s."groupId" = g.id
      LEFT JOIN plans p ON p.id = s."planId"
      WHERE g.status <> 'ARCHIVED'
      GROUP BY 1 ORDER BY 2 DESC`;
    const support = await this.support(from, to);
    const activeStatusGroups = await this.prisma.group.count({ where: { status: 'ACTIVE' } });

    return {
      range: { from: from.toISOString(), to: to.toISOString(), bucket },
      totals: {
        users,
        groups,
        activeGroups30d,
        newUsers,
        newGroups,
        payingGroups: paying,
        trialGroups: trial,
        freeGroups: Math.max(0, groups - paying - trial),
        activeHelpers,
        openSupportCases: openCases,
        criticalIncidents: critical,
      },
      registrations,
      groupActivity: { active: activeGroups30d, inactive: Math.max(0, activeStatusGroups - activeGroups30d) },
      planDistribution: planRows.map((r) => ({ plan: r.plan, groups: Number(r.groups) })),
      support,
      revenue: includeRevenue ? await this.revenue(from, to) : null,
    };
  }

  private async registrations(from: Date, to: Date, bucket: Bucket) {
    const unit = Prisma.raw(`'${bucket}'`);
    const [u, g] = await Promise.all([
      this.prisma.$queryRaw<{ period: Date; n: bigint }[]>`SELECT date_trunc(${unit}, "createdAt") AS period, COUNT(*) AS n FROM users WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`,
      this.prisma.$queryRaw<{ period: Date; n: bigint }[]>`SELECT date_trunc(${unit}, "createdAt") AS period, COUNT(*) AS n FROM groups WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`,
    ]);
    const map = new Map<string, { users: number; groups: number }>();
    for (const p of periods(from, to, bucket)) map.set(p, { users: 0, groups: 0 });
    for (const r of u) {
      const slot = map.get(key(r.period));
      if (slot) slot.users = Number(r.n);
    }
    for (const r of g) {
      const slot = map.get(key(r.period));
      if (slot) slot.groups = Number(r.n);
    }
    return [...map.entries()].map(([period, v]) => ({ period, ...v }));
  }

  private async support(from: Date, to: Date): Promise<PlatformDashboard['support']> {
    const [byStatus, times, weeklyOpened, weeklyResolved] = await Promise.all([
      this.prisma.supportCase.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ first: number | null; resolve: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 3600) FILTER (WHERE "firstResponseAt" IS NOT NULL) AS first,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600) FILTER (WHERE "resolvedAt" IS NOT NULL) AS resolve
        FROM support_cases WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`,
      this.prisma.$queryRaw<{ period: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt") AS period, COUNT(*) AS n FROM support_cases WHERE "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`,
      this.prisma.$queryRaw<{ period: Date; n: bigint }[]>`SELECT date_trunc('week', "resolvedAt") AS period, COUNT(*) AS n FROM support_cases WHERE "resolvedAt" >= ${from} AND "resolvedAt" < ${to} GROUP BY 1`,
    ]);
    const weeks = new Map<string, { opened: number; resolved: number }>();
    for (const p of periods(from, to, 'week')) weeks.set(p, { opened: 0, resolved: 0 });
    for (const r of weeklyOpened) {
      const slot = weeks.get(key(r.period));
      if (slot) slot.opened = Number(r.n);
    }
    for (const r of weeklyResolved) {
      const slot = weeks.get(key(r.period));
      if (slot) slot.resolved = Number(r.n);
    }
    const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    return {
      byStatus: byStatus.map((s) => ({ status: s.status as SupportStatus, count: s._count._all })),
      medianFirstResponseHours: round(times[0]?.first),
      medianResolutionHours: round(times[0]?.resolve),
      weekly: [...weeks.entries()].map(([period, v]) => ({ period, ...v })),
    };
  }

  private async revenue(from: Date, to: Date): Promise<NonNullable<PlatformDashboard['revenue']>> {
    const [collected, refunded, pending] = await Promise.all([
      this.prisma.$queryRaw<{ period: Date; currency: string; amount: bigint }[]>`
        SELECT date_trunc('month', "paidAt") AS period, currency, SUM("amountMinor") AS amount
        FROM billing_payments
        WHERE livemode AND status IN ('SUCCEEDED','REFUNDED','PARTIALLY_REFUNDED') AND "paidAt" >= ${from} AND "paidAt" < ${to}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ period: Date; currency: string; amount: bigint }[]>`
        SELECT date_trunc('month', r."createdAt") AS period, r.currency, SUM(r."amountMinor") AS amount
        FROM billing_refunds r JOIN billing_payments p ON p.id = r."paymentId"
        WHERE p.livemode AND r.status = 'SUCCEEDED' AND r."createdAt" >= ${from} AND r."createdAt" < ${to}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ currency: string; amount: bigint; n: bigint }[]>`
        SELECT currency, SUM("amountMinor") AS amount, COUNT(*) AS n FROM billing_payments WHERE livemode AND status = 'PENDING' GROUP BY 1`,
    ]);
    const rows = new Map<string, { period: string; currency: string; collected: number; refunded: number }>();
    const at = (period: Date, currency: string) => {
      const k = `${key(period)}|${currency}`;
      if (!rows.has(k)) rows.set(k, { period: key(period), currency, collected: 0, refunded: 0 });
      return rows.get(k)!;
    };
    for (const r of collected) at(r.period, r.currency).collected = Number(r.amount);
    for (const r of refunded) at(r.period, r.currency).refunded = Number(r.amount);
    return {
      byMonth: [...rows.values()].sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency)),
      pending: pending.map((p) => ({ currency: p.currency, amountMinor: Number(p.amount), count: Number(p.n) })),
    };
  }
}

const key = (d: Date) => d.toISOString().slice(0, 10);

/** Every bucket start between from and to (UTC), so charts show empty periods as zero instead of skipping them. */
function periods(from: Date, to: Date, bucket: Bucket): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), bucket === 'month' ? 1 : from.getUTCDate()));
  if (bucket === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday, like date_trunc('week')
  while (d < to && out.length < 400) {
    out.push(key(d));
    if (bucket === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (bucket === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}
