import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  billingCaseSchema,
  billingCaseUpdateSchema,
  exchangeRateSchema,
  LAUNCH_READY_CURRENCIES,
  operatingCostSchema,
  paginationSchema,
  planPriceSchema,
  planUpsertSchema,
  PlatformPermission,
  promoGrantSchema,
  promoRevokeSchema,
  ProviderHealthRow,
  providerAvailabilitySchema,
  refundSchema,
  regionSchema,
  revenueQuerySchema,
} from '@chamahub/shared';
import { z } from 'zod';
import { CurrentStaff, PlatformApi, ReqMeta, RequirePlatform } from '../../common/decorators';
import { big, n } from '../../common/money';
import { paginate, skipTake } from '../../common/pagination';
import { RequestMeta, StaffContext } from '../../common/request';
import { PlatformAuditService } from '../platform-auth/platform-audit.service';
import { ZodPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService, toPaymentRow } from './billing.service';
import { EntitlementService, toPlanRule } from './entitlements.service';
import { ProviderRegistry } from './providers/registry';
import { RevenueService } from './revenue.service';

const PP = PlatformPermission;
const groupQuery = paginationSchema.extend({ q: z.string().trim().max(80).optional() });
const paymentQuery = paginationSchema.extend({
  q: z.string().trim().max(40).optional(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED']).optional(),
  provider: z.string().trim().max(30).optional(),
  livemode: z.enum(['live', 'test']).optional(),
});

/**
 * Platform billing administration. Billing staff see plans, subscription status and billing
 * payments, never a group's contributions, loans or ledger. Each area has its own permission:
 * viewing billing, managing it (promotions, cases), refunds, revenue, and finance records.
 */
@PlatformApi()
@Controller('platform')
export class PlatformBillingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementService,
    private readonly revenue: RevenueService,
    private readonly providers: ProviderRegistry,
  ) {}

  /* ---------------- groups ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/groups')
  async groups(@Query(new ZodPipe(groupQuery)) q: z.infer<typeof groupQuery>) {
    const where: Prisma.GroupWhereInput = q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { id: q.q }] } : {};
    const [rows, total] = await Promise.all([
      this.prisma.group.findMany({ where, include: { _count: { select: { memberships: { where: { status: 'ACTIVE' } } } }, subscription: { include: { plan: { select: { code: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.group.count({ where }),
    ]);
    const items = await Promise.all(
      rows.map(async (g) => {
        const access = await this.entitlements.access(g.id);
        return {
          id: g.id,
          name: g.name,
          type: g.type,
          status: g.status,
          countryCode: g.countryCode,
          currency: g.currency,
          members: g._count.memberships,
          createdAt: g.createdAt.toISOString(),
          subscription: g.subscription ? { planCode: g.subscription.plan.code, planName: g.subscription.plan.name, status: g.subscription.status, currentPeriodEnd: g.subscription.currentPeriodEnd?.toISOString() ?? null, trialEndsAt: g.subscription.trialEndsAt?.toISOString() ?? null } : null,
          access: { planCode: access.plan.code, planName: access.plan.name, source: access.source, until: access.until?.toISOString() ?? null },
        };
      }),
    );
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Billing view of one group: plan, payments, promotions and history. No group finances. */
  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  // The parameter is not named groupId on purpose: staff are not members, so the group guard must not apply.
  @Get('billing/groups/:id')
  async group(@Param('id') groupId: string) {
    const [summary, events, cases, group] = await Promise.all([
      this.billing.summary(groupId, true),
      this.prisma.subscriptionEvent.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.billingCase.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { type: true, status: true, createdAt: true, timezone: true, locale: true } }),
    ]);
    const actors = await this.names(events.map((e) => e.actorUserId));
    return {
      ...summary,
      group,
      events: events.map((e) => ({ id: e.id, type: e.type, fromPlan: e.fromPlan, toPlan: e.toPlan, fromStatus: e.fromStatus, toStatus: e.toStatus, paymentId: e.paymentId, reason: e.reason, actor: e.actorUserId ? (actors.get(e.actorUserId) ?? 'Staff') : 'System', meta: e.meta, createdAt: e.createdAt.toISOString() })),
      cases: cases.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })),
    };
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_BILLING)
  @Post('billing/groups/:id/promotions')
  grant(@Param('id') groupId: string, @Body(new ZodPipe(promoGrantSchema)) body: z.infer<typeof promoGrantSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.audited(staff, meta, 'platform.promotion_granted', 'Group', groupId, body.reason, () => this.billing.grantPromotion(groupId, body, staff.accountId, meta), { plan: body.planCode, endsAt: body.endsAt });
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_BILLING)
  @HttpCode(200)
  @Post('billing/groups/:id/promotions/:promoId/revoke')
  revoke(@Param('id') groupId: string, @Param('promoId') id: string, @Body(new ZodPipe(promoRevokeSchema)) body: z.infer<typeof promoRevokeSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.audited(staff, meta, 'platform.promotion_revoked', 'PromotionalGrant', id, body.reason, () => this.billing.revokePromotion(groupId, id, body.reason, staff.accountId, meta));
  }

  /* ---------------- payments ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/payments')
  async payments(@Query(new ZodPipe(paymentQuery)) q: z.infer<typeof paymentQuery>) {
    const where: Prisma.BillingPaymentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.provider ? { provider: q.provider } : {}),
      ...(q.livemode ? { livemode: q.livemode === 'live' } : {}),
      ...(q.q ? { OR: [{ reference: { contains: q.q, mode: 'insensitive' } }, { receiptNumber: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.billingPayment.findMany({ where, include: { plan: { select: { code: true, name: true } }, group: { select: { id: true, name: true, countryCode: true } } }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.billingPayment.count({ where }),
    ]);
    return paginate(rows.map((p) => ({ ...toPaymentRow(p), group: p.group })), total, q.page, q.pageSize);
  }

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/payments/:id/receipt')
  receipt(@Param('id') id: string) {
    return this.billing.receipt(null, id);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_BILLING)
  @HttpCode(200)
  @Post('billing/payments/:id/reconcile')
  async reconcile(@Param('id') id: string, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const status = await this.billing.reconcile(id);
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.billing_reconciled', targetType: 'BillingPayment', targetId: id, after: { status }, meta });
    return this.billing.paymentRow(id);
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_FINANCE)
  @HttpCode(200)
  @Post('billing/payments/:id/confirm-manual')
  async confirmManual(@Param('id') id: string, @Body(new ZodPipe(z.object({ bankReference: z.string().trim().min(4).max(60) }))) body: { bankReference: string }, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    await this.audited(staff, meta, 'platform.billing_manual_confirmed', 'BillingPayment', id, null, () => this.billing.confirmManual(id, body, staff.accountId, meta), { bankReference: body.bankReference });
    return this.billing.paymentRow(id);
  }

  @RequirePlatform(PP.PLATFORM_REFUND)
  @Post('billing/payments/:id/refund')
  refund(@Param('id') id: string, @Body(new ZodPipe(refundSchema)) body: z.infer<typeof refundSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    return this.audited(staff, meta, 'platform.billing_refund', 'BillingPayment', id, body.reason, () => this.billing.refund(id, body, staff.accountId, meta), { amountMinor: body.amountMinor });
  }

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/events')
  async events(@Query(new ZodPipe(z.object({ provider: z.string().max(30).optional() }))) q: { provider?: string }) {
    const rows = await this.prisma.billingEvent.findMany({ where: q.provider ? { provider: q.provider } : {}, include: { payment: { select: { reference: true } } }, orderBy: { receivedAt: 'desc' }, take: 100 });
    return rows.map((e) => ({ id: e.id, provider: e.provider, providerEventId: e.providerEventId, type: e.type, reference: e.payment?.reference ?? null, livemode: e.livemode, signatureValid: e.signatureValid, result: e.result, receivedAt: e.receivedAt.toISOString(), processedAt: e.processedAt?.toISOString() ?? null, payload: e.payload }));
  }

  /* ---------------- providers ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/providers')
  async providerHealth(): Promise<ProviderHealthRow[]> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const availability = await this.prisma.billingProviderAvailability.findMany({ orderBy: [{ provider: 'asc' }, { countryCode: 'asc' }] });
    return Promise.all(
      this.providers.list().map(async (p) => {
        const h = p.health();
        const [lastHook, lastOk, pending, ok, failed, rejected] = await Promise.all([
          this.prisma.billingEvent.findFirst({ where: { provider: p.code, signatureValid: true }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
          this.prisma.billingPayment.findFirst({ where: { provider: p.code, status: 'SUCCEEDED' }, orderBy: { paidAt: 'desc' }, select: { paidAt: true } }),
          this.prisma.billingPayment.count({ where: { provider: p.code, status: 'PENDING' } }),
          this.prisma.billingPayment.count({ where: { provider: p.code, status: 'SUCCEEDED', paidAt: { gte: since } } }),
          this.prisma.billingPayment.count({ where: { provider: p.code, status: { in: ['FAILED', 'CANCELLED'] }, createdAt: { gte: since } } }),
          this.prisma.billingEvent.count({ where: { provider: p.code, signatureValid: false, receivedAt: { gte: since } } }),
        ]);
        return {
          code: p.code,
          name: p.displayName,
          ...h,
          availability: availability.filter((a) => a.provider === p.code).map((a) => ({ countryCode: a.countryCode, currency: a.currency, methods: a.methods, recurring: a.recurring, refunds: a.refunds, enabled: a.enabled })),
          lastWebhookAt: lastHook?.receivedAt.toISOString() ?? null,
          lastSuccessAt: lastOk?.paidAt?.toISOString() ?? null,
          pending,
          succeeded7d: ok,
          failed7d: failed,
          rejectedWebhooks7d: rejected,
        };
      }),
    );
  }

  @RequirePlatform(PP.PLATFORM_CONFIGURE)
  @Put('billing/providers/availability')
  async availability(@Body(new ZodPipe(providerAvailabilitySchema)) body: z.infer<typeof providerAvailabilitySchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    if (!this.providers.get(body.provider)) throw new UnprocessableEntityException('Unknown provider');
    const before = await this.prisma.billingProviderAvailability.findUnique({ where: { provider_countryCode_currency: { provider: body.provider, countryCode: body.countryCode, currency: body.currency } } });
    const row = await this.prisma.billingProviderAvailability.upsert({ where: { provider_countryCode_currency: { provider: body.provider, countryCode: body.countryCode, currency: body.currency } }, create: body, update: body });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.provider_availability_changed', targetType: 'BillingProviderAvailability', targetId: row.id, before, after: body, meta });
    return row;
  }

  /* ---------------- cases ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('billing/cases')
  async cases(@Query(new ZodPipe(z.object({ status: z.enum(['OPEN', 'WAITING', 'RESOLVED']).optional() }))) q: { status?: 'OPEN' | 'WAITING' | 'RESOLVED' }) {
    const rows = await this.prisma.billingCase.findMany({ where: q.status ? { status: q.status } : { status: { not: 'RESOLVED' } }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const groups = new Map((await this.prisma.group.findMany({ where: { id: { in: rows.map((r) => r.groupId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
    const people = await this.names(rows.flatMap((r) => [r.createdById, r.assignedToId]));
    return rows.map((c) => ({ ...c, groupName: c.groupId ? (groups.get(c.groupId) ?? null) : null, createdBy: people.get(c.createdById) ?? (c.createdById === 'system' ? 'System' : 'Staff'), assignedTo: c.assignedToId ? (people.get(c.assignedToId) ?? null) : null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }));
  }

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Post('billing/cases')
  async createCase(@Body(new ZodPipe(billingCaseSchema)) body: z.infer<typeof billingCaseSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const c = await this.billing.openCase(body, staff.accountId);
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.billing_case_opened', targetType: 'BillingCase', targetId: c.id, after: { subject: body.subject }, meta });
    return { id: c.id };
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_BILLING)
  @Patch('billing/cases/:id')
  async updateCase(@Param('id') id: string, @Body(new ZodPipe(billingCaseUpdateSchema)) body: z.infer<typeof billingCaseUpdateSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const before = await this.prisma.billingCase.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Case not found');
    if (body.status === 'RESOLVED' && !(body.resolution ?? before.resolution)) throw new UnprocessableEntityException('Write how the case was resolved.');
    const c = await this.prisma.billingCase.update({ where: { id }, data: { status: body.status, resolution: body.resolution ?? undefined, assignedToId: body.assignToMe ? staff.accountId : undefined } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.billing_case_updated', targetType: 'BillingCase', targetId: id, before: { status: before.status }, after: { status: c.status, resolution: c.resolution }, meta });
    return { ok: true };
  }

  /* ---------------- plans & prices ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('plans')
  async plans() {
    const rows = await this.prisma.plan.findMany({ include: { prices: { orderBy: [{ countryCode: 'asc' }, { interval: 'asc' }] }, _count: { select: { subscriptions: true } } }, orderBy: [{ active: 'desc' }, { tier: 'asc' }] });
    return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description, tier: p.tier, entitlements: toPlanRule(p).entitlements, active: p.active, isPublic: p.isPublic, subscribers: p._count.subscriptions, prices: p.prices.map((r) => ({ id: r.id, countryCode: r.countryCode, currency: r.currency, interval: r.interval, amountMinor: n(r.amountMinor), active: r.active, updatedAt: r.updatedAt.toISOString() })) }));
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_PLANS)
  @Put('plans/:code')
  async upsertPlan(@Param('code') code: string, @Body(new ZodPipe(planUpsertSchema)) body: z.infer<typeof planUpsertSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    if (body.code !== code.toUpperCase()) throw new UnprocessableEntityException('The plan code in the URL and body differ.');
    if (body.code === 'FREE' && (!body.active || body.tier !== 0)) throw new UnprocessableEntityException('The Free plan must stay active at tier 0: groups fall back to it.');
    const before = await this.prisma.plan.findUnique({ where: { code: body.code } });
    const data = { name: body.name, description: body.description ?? null, tier: body.tier, entitlements: body.entitlements as unknown as Prisma.InputJsonValue, active: body.active, isPublic: body.isPublic };
    const p = await this.prisma.plan.upsert({ where: { code: body.code }, create: { code: body.code, ...data }, update: data });
    await this.audit.log({ actorAccountId: staff.accountId, action: before ? 'platform.plan_updated' : 'platform.plan_created', targetType: 'Plan', targetId: p.id, before, after: body, meta });
    this.entitlements.invalidate();
    return { id: p.id };
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_PLANS)
  @Put('plan-prices')
  async upsertPrice(@Body(new ZodPipe(planPriceSchema)) body: z.infer<typeof planPriceSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const plan = await this.prisma.plan.findUnique({ where: { code: body.planCode } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.tier === 0 && body.amountMinor > 0) throw new UnprocessableEntityException('The Free plan has no price.');
    const key = { planId_countryCode_currency_interval: { planId: plan.id, countryCode: body.countryCode, currency: body.currency, interval: body.interval } };
    const before = await this.prisma.planPrice.findUnique({ where: key });
    // Existing subscriptions keep the price they paid (stored on the subscription); new checkouts use this one.
    const row = await this.prisma.planPrice.upsert({ where: key, create: { planId: plan.id, countryCode: body.countryCode, currency: body.currency, interval: body.interval, amountMinor: big(body.amountMinor), active: body.active }, update: { amountMinor: big(body.amountMinor), active: body.active } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.price_changed', targetType: 'PlanPrice', targetId: row.id, before: before ? { amountMinor: n(before.amountMinor), active: before.active } : null, after: body, meta });
    return { id: row.id };
  }

  /* ---------------- regions ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_BILLING)
  @Get('regions')
  async regions() {
    const [rows, counts] = await Promise.all([this.prisma.region.findMany({ orderBy: [{ available: 'desc' }, { name: 'asc' }] }), this.prisma.group.groupBy({ by: ['countryCode'], _count: { _all: true } })]);
    const c = new Map(counts.map((x) => [x.countryCode, x._count._all]));
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString(), groups: c.get(r.countryCode) ?? 0, launchReady: LAUNCH_READY_CURRENCIES.includes(r.defaultCurrency) }));
  }

  @RequirePlatform(PP.PLATFORM_CONFIGURE)
  @Put('regions/:countryCode')
  async upsertRegion(@Param('countryCode') countryCode: string, @Body(new ZodPipe(regionSchema)) body: z.infer<typeof regionSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    if (body.countryCode !== countryCode.toUpperCase()) throw new UnprocessableEntityException('The country in the URL and body differ.');
    if ((body.available || body.billingAvailable) && !LAUNCH_READY_CURRENCIES.includes(body.defaultCurrency)) {
      throw new ConflictException(`${body.defaultCurrency} is not launch-ready: notifications, PDFs and AI answers still format amounts in KES. Finish that work before opening ${body.name}.`);
    }
    if (body.billingAvailable && !(await this.prisma.billingProviderAvailability.count({ where: { countryCode: body.countryCode, enabled: true } }))) {
      throw new ConflictException('Enable at least one payment provider for this country before selling subscriptions there.');
    }
    const before = await this.prisma.region.findUnique({ where: { countryCode: body.countryCode } });
    const row = await this.prisma.region.upsert({ where: { countryCode: body.countryCode }, create: { ...body, notes: body.notes ?? null }, update: { ...body, notes: body.notes ?? null } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.region_changed', targetType: 'Region', targetId: row.countryCode, before, after: body, meta });
    return row;
  }

  /* ---------------- revenue & finance ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_REVENUE)
  @Get('revenue')
  report(@Query(new ZodPipe(revenueQuerySchema)) q: z.infer<typeof revenueQuerySchema>) {
    return this.revenue.report(q);
  }

  @RequirePlatform(PP.PLATFORM_VIEW_REVENUE)
  @Get('finance/exchange-rates')
  async rates() {
    const rows = await this.prisma.exchangeRate.findMany({ orderBy: [{ asOf: 'desc' }, { baseCurrency: 'asc' }], take: 200 });
    const people = await this.names(rows.map((r) => r.createdById));
    return rows.map((r) => ({ id: r.id, baseCurrency: r.baseCurrency, quoteCurrency: r.quoteCurrency, rate: r.rate.toString(), asOf: r.asOf.toISOString().slice(0, 10), source: r.source, createdBy: people.get(r.createdById) ?? '', createdAt: r.createdAt.toISOString() }));
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_FINANCE)
  @Post('finance/exchange-rates')
  async addRate(@Body(new ZodPipe(exchangeRateSchema)) body: z.infer<typeof exchangeRateSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    try {
      const r = await this.prisma.exchangeRate.create({ data: { baseCurrency: body.baseCurrency, quoteCurrency: body.quoteCurrency, rate: new Prisma.Decimal(body.rate), asOf: new Date(`${body.asOf}T00:00:00Z`), source: body.source, createdById: staff.accountId } });
      await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.exchange_rate_recorded', targetType: 'ExchangeRate', targetId: r.id, after: body, meta });
      return { id: r.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('A rate for this pair and date is already recorded. Rates are never edited; record the next date instead.');
      throw err;
    }
  }

  @RequirePlatform(PP.PLATFORM_VIEW_REVENUE)
  @Get('finance/costs')
  async costs(@Query(new ZodPipe(z.object({ from: z.string().optional(), to: z.string().optional() }))) q: { from?: string; to?: string }) {
    const rows = await this.prisma.operatingCost.findMany({ where: { incurredOn: { gte: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, lte: q.to ? new Date(`${q.to}T00:00:00Z`) : undefined } }, orderBy: { incurredOn: 'desc' }, take: 500 });
    const people = await this.names(rows.map((r) => r.recordedById));
    return rows.map((r) => ({ id: r.id, category: r.category, description: r.description, currency: r.currency, amountMinor: n(r.amountMinor), incurredOn: r.incurredOn.toISOString().slice(0, 10), source: r.source, recordedBy: people.get(r.recordedById) ?? '', createdAt: r.createdAt.toISOString() }));
  }

  @RequirePlatform(PP.PLATFORM_MANAGE_FINANCE)
  @Post('finance/costs')
  async addCost(@Body(new ZodPipe(operatingCostSchema)) body: z.infer<typeof operatingCostSchema>, @CurrentStaff() staff: StaffContext, @ReqMeta() meta: RequestMeta) {
    const c = await this.prisma.operatingCost.create({ data: { category: body.category, description: body.description, currency: body.currency, amountMinor: big(body.amountMinor), incurredOn: new Date(`${body.incurredOn}T00:00:00Z`), source: body.source ?? null, recordedById: staff.accountId } });
    await this.audit.log({ actorAccountId: staff.accountId, action: 'platform.cost_recorded', targetType: 'OperatingCost', targetId: c.id, after: body, meta });
    return { id: c.id };
  }

  /* ---------------- product analytics (aggregates only) ---------------- */

  @RequirePlatform(PP.PLATFORM_VIEW_STATS)
  @Get('analytics')
  async analytics() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byType, byCountry, members, aiQuestions, aiGroups, statementImports, loans, payments, activeGroups] = await Promise.all([
      this.prisma.group.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.group.groupBy({ by: ['countryCode'], _count: { _all: true } }),
      this.prisma.membership.count({ where: { status: 'ACTIVE' } }),
      this.prisma.aiUsage.count({ where: { createdAt: { gte: since } } }),
      this.prisma.aiUsage.groupBy({ by: ['groupId'], where: { createdAt: { gte: since } } }),
      this.prisma.statementImport.count({ where: { createdAt: { gte: since } } }),
      this.prisma.loan.count({ where: { createdAt: { gte: since } } }),
      this.prisma.payment.count({ where: { createdAt: { gte: since } } }),
      this.prisma.journalEntry.groupBy({ by: ['groupId'], where: { createdAt: { gte: since } } }),
    ]);
    // Counts only: no amounts, no group names, so nothing about any group's money is exposed.
    return {
      groupsByType: byType.map((x) => ({ type: x.type, groups: x._count._all })),
      groupsByCountry: byCountry.map((x) => ({ countryCode: x.countryCode, groups: x._count._all })),
      activeMembers: members,
      last30Days: { activeGroups: activeGroups.length, aiQuestions, groupsUsingAi: aiGroups.length, statementImports, loansCreated: loans, paymentsRecorded: payments },
    };
  }

  /** Staff (platform accounts) or, for checkout events, the group officer who paid. */
  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x && x !== 'system' && x !== 'provider'))];
    if (!unique.length) return new Map<string, string>();
    const [staff, users] = await Promise.all([
      this.prisma.platformAccount.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } }),
      this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } }),
    ]);
    return new Map([...users, ...staff].map((u) => [u.id, u.fullName]));
  }

  /** Runs a staff action and records it in the platform audit trail, including when it fails. */
  private async audited<T>(staff: StaffContext, meta: RequestMeta, action: string, targetType: string, targetId: string, reason: string | null, run: () => Promise<T>, after?: Record<string, unknown>): Promise<T> {
    try {
      const out = await run();
      await this.audit.log({ actorAccountId: staff.accountId, action, targetType, targetId, reason, after, meta });
      return out;
    } catch (err) {
      await this.audit.log({ actorAccountId: staff.accountId, action, targetType, targetId, reason, after, outcome: 'FAILURE', meta });
      throw err;
    }
  }
}

/** Countries where groups can be created, for the "create a group" form. Signed-in users only. */
@Controller('regions')
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async available() {
    const rows = await this.prisma.region.findMany({ where: { available: true }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ countryCode: r.countryCode, name: r.name, currency: r.defaultCurrency, timezone: r.defaultTimezone, locale: r.defaultLocale, billingAvailable: r.billingAvailable }));
  }
}
