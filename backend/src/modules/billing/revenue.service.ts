import { Injectable } from '@nestjs/common';
import { BillingPaymentStatus } from '@prisma/client';
import { convertMinor, convertMinorInverse, divRound, monthlyEquivalentMinor, MoneyByCurrency, RevenueReport, todayInNairobi } from '@chamahub/shared';
import { n } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';

const PAID: BillingPaymentStatus[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED'];
const CHURN_EVENTS = ['expired', 'cancelled', 'access_revoked_by_refund'];

function add(map: Map<string, number>, currency: string, amount: number) {
  map.set(currency, (map.get(currency) ?? 0) + amount);
}
const list = (m: Map<string, number>): MoneyByCurrency[] => [...m.entries()].filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor }));

/**
 * Owner revenue reporting, computed from records only:
 * - cash: verified subscription payments (never pending ones), minus refunds and provider fees;
 * - recurring revenue (MRR/ARR): the contracted price of subscriptions paid for the current
 *   period — a run-rate, not cash;
 * - costs: what staff recorded plus measured AI usage;
 * - consolidation: only with recorded exchange rates, listed with their date and source.
 * Every figure keeps its source currency; consolidated totals say whether any currency was left out.
 */
@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async report(q: { from?: string; to?: string; livemode: 'live' | 'test' }): Promise<RevenueReport> {
    const today = todayInNairobi();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    const start = new Date(`${from}T00:00:00Z`);
    const endExclusive = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
    const livemode = q.livemode === 'live';
    const now = new Date();
    const reporting = (await this.settings.get()).reportingCurrency;
    const notes: string[] = [];

    /* cash */
    const paid = await this.prisma.billingPayment.findMany({ where: { livemode, status: { in: PAID }, paidAt: { gte: start, lt: endExclusive }, amountMinor: { gt: 0 } }, select: { currency: true, amountMinor: true, feeMinor: true, groupId: true } });
    const gross = new Map<string, number>();
    const fees = new Map<string, number>();
    for (const p of paid) {
      add(gross, p.currency, n(p.amountMinor));
      if (p.feeMinor !== null) add(fees, p.currency, n(p.feeMinor));
    }
    const refundsRows = await this.prisma.billingRefund.findMany({ where: { status: 'SUCCEEDED', createdAt: { gte: start, lt: endExclusive }, payment: { livemode } }, select: { currency: true, amountMinor: true } });
    const refunds = new Map<string, number>();
    for (const r of refundsRows) add(refunds, r.currency, n(r.amountMinor));
    const net = new Map<string, number>();
    for (const c of new Set([...gross.keys(), ...refunds.keys(), ...fees.keys()])) net.set(c, (gross.get(c) ?? 0) - (refunds.get(c) ?? 0) - (fees.get(c) ?? 0));
    if (paid.some((p) => p.feeMinor === null)) notes.push('Some providers do not report fees (M-Pesa, manual): their fees are not deducted unless recorded as a Payment fees cost.');

    const pendingRows = await this.prisma.billingPayment.findMany({ where: { livemode, status: 'PENDING' }, select: { currency: true, amountMinor: true } });
    const pending = new Map<string, number>();
    for (const p of pendingRows) add(pending, p.currency, n(p.amountMinor));
    const [failedCount, renewalFailures, disputedRows] = await Promise.all([
      this.prisma.billingPayment.count({ where: { livemode, status: { in: ['FAILED', 'CANCELLED'] }, createdAt: { gte: start, lt: endExclusive } } }),
      this.prisma.billingPayment.count({ where: { livemode, purpose: 'RENEWAL', status: { in: ['FAILED', 'CANCELLED'] }, createdAt: { gte: start, lt: endExclusive } } }),
      this.prisma.billingPayment.findMany({ where: { livemode, status: 'DISPUTED' }, select: { currency: true, amountMinor: true } }),
    ]);
    const disputed = new Map<string, number>();
    for (const d of disputedRows) add(disputed, d.currency, n(d.amountMinor));

    /* recurring: subscriptions whose current period was bought with a verified payment in this mode */
    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } },
      include: { plan: { select: { code: true, name: true } }, group: { select: { countryCode: true } }, payments: { where: { livemode, status: { in: PAID } }, select: { periodEnd: true, status: true } } },
    });
    const funded = (s: (typeof subs)[number]) => !!s.currentPeriodEnd && s.payments.some((p) => p.periodEnd?.getTime() === s.currentPeriodEnd!.getTime() && p.status !== 'REFUNDED');
    const paying = subs.filter((s) => s.status === 'ACTIVE' && s.currentPeriodEnd! > now && funded(s) && s.amountMinor !== null && s.currency && s.interval);
    const mrr = new Map<string, number>();
    const payingByCurrency = new Map<string, number>();
    const byPlan = new Map<string, { planName: string; groups: number; mrr: Map<string, number> }>();
    const byCountry = new Map<string, { groups: number; mrr: Map<string, number> }>();
    for (const s of paying) {
      const m = monthlyEquivalentMinor(n(s.amountMinor), s.interval!);
      add(mrr, s.currency!, m);
      add(payingByCurrency, s.currency!, 1);
      const bp = byPlan.get(s.plan.code) ?? { planName: s.plan.name, groups: 0, mrr: new Map() };
      bp.groups++;
      add(bp.mrr, s.currency!, m);
      byPlan.set(s.plan.code, bp);
      const bc = byCountry.get(s.group.countryCode) ?? { groups: 0, mrr: new Map() };
      bc.groups++;
      add(bc.mrr, s.currency!, m);
      byCountry.set(s.group.countryCode, bc);
    }
    const arr = new Map([...mrr].map(([c, v]) => [c, v * 12]));
    const arppg = new Map([...mrr].map(([c, v]) => [c, divRound(v, payingByCurrency.get(c)!)]));

    /* groups by what they have right now (precedence: paying, grace, promotion, trial, free) */
    const [totalGroups, promoGroups] = await Promise.all([
      this.prisma.group.count({ where: { status: 'ACTIVE' } }),
      this.prisma.promotionalGrant.findMany({ where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, select: { groupId: true }, distinct: ['groupId'] }),
    ]);
    const payingIds = new Set(paying.map((s) => s.groupId));
    const graceIds = new Set(subs.filter((s) => s.status === 'PAST_DUE' && s.graceEndsAt && s.graceEndsAt > now && !payingIds.has(s.groupId)).map((s) => s.groupId));
    const promoIds = new Set(promoGroups.map((p) => p.groupId).filter((id) => !payingIds.has(id) && !graceIds.has(id)));
    const trialIds = new Set(subs.filter((s) => s.status === 'TRIALING' && s.trialEndsAt && s.trialEndsAt > now && !payingIds.has(s.groupId) && !graceIds.has(s.groupId) && !promoIds.has(s.groupId)).map((s) => s.groupId));

    const firstPaid = await this.prisma.billingPayment.groupBy({ by: ['groupId'], where: { livemode, status: { in: PAID }, amountMinor: { gt: 0 } }, _min: { paidAt: true } });
    const newPaying = firstPaid.filter((f) => f._min.paidAt && f._min.paidAt >= start && f._min.paidAt < endExclusive).length;

    /* renewals & churn */
    const [dueNext30Days, renewOk, renewFailed, atStart, churnEvents] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 30 * 86_400_000) } } }),
      this.prisma.billingPayment.count({ where: { livemode, purpose: 'RENEWAL', status: { in: PAID }, paidAt: { gte: start, lt: endExclusive } } }),
      Promise.resolve(renewalFailures),
      this.prisma.billingPayment.findMany({ where: { livemode, status: { in: PAID }, periodStart: { lte: start }, periodEnd: { gt: start }, amountMinor: { gt: 0 } }, select: { groupId: true }, distinct: ['groupId'] }),
      this.prisma.subscriptionEvent.findMany({ where: { type: { in: CHURN_EVENTS }, fromStatus: { in: ['ACTIVE', 'PAST_DUE'] }, createdAt: { gte: start, lt: endExclusive } }, select: { groupId: true }, distinct: ['groupId'] }),
    ]);
    const baseIds = new Set(atStart.map((a) => a.groupId));
    const churned = churnEvents.filter((e) => baseIds.has(e.groupId) && !payingIds.has(e.groupId)).length;
    const churnRate = baseIds.size ? churned / baseIds.size : null;

    /* costs */
    const costRows = livemode ? await this.prisma.operatingCost.findMany({ where: { incurredOn: { gte: start, lt: endExclusive } } }) : [];
    const byCat = new Map<string, Map<string, number>>();
    for (const c of costRows) {
      const m = byCat.get(c.category) ?? new Map<string, number>();
      add(m, c.currency, n(c.amountMinor));
      byCat.set(c.category, m);
    }
    const costs: RevenueReport['costs']['byCategory'] = [...byCat.entries()].map(([category, m]) => ({ category, amount: list(m), measured: false }));
    if (livemode) {
      const ai = await this.prisma.aiUsage.aggregate({ where: { createdAt: { gte: start, lt: endExclusive } }, _sum: { costMicroUsd: true } });
      const aiCents = divRound(ai._sum.costMicroUsd ?? 0, 10_000);
      if (byCat.has('AI')) notes.push('AI cost uses the recorded AI invoices; measured usage is shown separately and not added, to avoid counting it twice.');
      if (aiCents > 0) costs.push({ category: byCat.has('AI') ? 'AI_MEASURED_INFO' : 'AI_MEASURED', amount: [{ currency: 'USD', amountMinor: aiCents }], measured: true });
    } else {
      notes.push('Test mode: costs are not shown against test payments.');
    }
    const totalCosts = new Map<string, number>();
    for (const c of costs) if (c.category !== 'AI_MEASURED_INFO') for (const a of c.amount) add(totalCosts, a.currency, a.amountMinor);
    const acquisition = byCat.get('ACQUISITION');
    const cac = acquisition && newPaying > 0 ? list(new Map([...acquisition].map(([cur, v]) => [cur, divRound(v, newPaying)]))) : [];
    if (!acquisition) notes.push('Customer acquisition cost appears once acquisition costs are recorded.');

    /* consolidation */
    const used = new Map<string, { from: string; to: string; rate: string; asOf: string; source: string }>();
    const missing = new Set<string>();
    const rateFor = async (cur: string) => {
      const direct = await this.prisma.exchangeRate.findFirst({ where: { baseCurrency: cur, quoteCurrency: reporting, asOf: { lt: endExclusive } }, orderBy: { asOf: 'desc' } });
      if (direct) return { kind: 'direct' as const, rate: direct.rate.toString(), asOf: direct.asOf.toISOString().slice(0, 10), source: direct.source };
      const inverse = await this.prisma.exchangeRate.findFirst({ where: { baseCurrency: reporting, quoteCurrency: cur, asOf: { lt: endExclusive } }, orderBy: { asOf: 'desc' } });
      if (inverse) return { kind: 'inverse' as const, rate: inverse.rate.toString(), asOf: inverse.asOf.toISOString().slice(0, 10), source: inverse.source };
      return null;
    };
    const cache = new Map<string, Awaited<ReturnType<typeof rateFor>>>();
    const consolidate = async (amounts: Map<string, number>) => {
      let total = 0;
      let complete = true;
      for (const [cur, v] of amounts) {
        if (cur === reporting) {
          total += v;
          continue;
        }
        if (!cache.has(cur)) cache.set(cur, await rateFor(cur));
        const r = cache.get(cur);
        if (!r) {
          complete = false;
          missing.add(cur);
          continue;
        }
        const conv = r.kind === 'direct' ? convertMinor(v, cur, reporting, r.rate, r.asOf) : convertMinorInverse(v, cur, reporting, r.rate, r.asOf);
        used.set(cur, { from: cur, to: reporting, rate: conv.rate, asOf: r.asOf, source: r.source });
        total += conv.amountMinor;
      }
      return { amountMinor: total, complete };
    };
    const cashNet = await consolidate(net);
    const mrrC = await consolidate(mrr);
    const arrC = await consolidate(arr);
    const costsC = await consolidate(totalCosts);
    const profit = { amountMinor: cashNet.amountMinor - costsC.amountMinor, complete: cashNet.complete && costsC.complete };
    if (missing.size) notes.push(`No exchange rate recorded for ${[...missing].join(', ')} → ${reporting}: those amounts are shown in their own currency and left out of consolidated totals.`);
    notes.push('Recurring revenue is the contracted monthly price of paid plans (annual plans count one twelfth); it is not cash received. Trials and promotional access count as zero.');

    return {
      period: { from, to },
      livemode,
      reportingCurrency: reporting,
      generatedAt: now.toISOString(),
      cash: { gross: list(gross), refunds: list(refunds), fees: list(fees), net: list(net), paymentsCount: paid.length },
      pending: { count: pendingRows.length, amount: list(pending) },
      failed: { count: failedCount, renewalFailures },
      disputed: { count: disputedRows.length, amount: list(disputed) },
      recurring: {
        mrr: list(mrr),
        arr: list(arr),
        arppg: list(arppg),
        byPlan: [...byPlan.entries()].map(([planCode, v]) => ({ planCode, planName: v.planName, groups: v.groups, mrr: list(v.mrr) })),
        byCountry: [...byCountry.entries()].map(([countryCode, v]) => ({ countryCode, groups: v.groups, mrr: list(v.mrr) })),
      },
      groups: { total: totalGroups, paying: payingIds.size, trialing: trialIds.size, promotional: promoIds.size, inGrace: graceIds.size, free: Math.max(0, totalGroups - payingIds.size - graceIds.size - promoIds.size - trialIds.size), newPaying },
      renewals: { dueNext30Days, succeededInPeriod: renewOk, failedInPeriod: renewFailed },
      churn: { payingAtStart: baseIds.size, churned, churnRate, retentionRate: churnRate === null ? null : 1 - churnRate },
      costs: { byCategory: costs, cacPerNewPayingGroup: cac },
      consolidated: { cashNet, mrr: mrrC, arr: arrC, costs: costsC, estimatedOperatingProfit: profit, conversions: [...used.values()], missingRates: [...missing] },
      notes,
    };
  }
}
