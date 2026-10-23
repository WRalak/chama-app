import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { BillingInterval, BillingPayment, Plan, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  addInterval,
  BillingPaymentRow,
  BillingReceipt,
  CheckoutResult,
  formatMoney,
  formatDate,
  GroupRole,
  maskPayerPhone,
  Permission,
  PlanOffer,
  prorationCreditMinor,
  resolvePermissions,
  RolePolicy,
  SpecialRole,
  SubscriptionSummary,
} from '@chamahub/shared';
import { AuditService } from '../../common/audit.service';
import { big, n } from '../../common/money';
import { RequestMeta } from '../../common/request';
import { env } from '../../config/env';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { EntitlementService, toPlanRule } from './entitlements.service';
import { BillingProvider, ProviderStatus, WebhookRejectedError, WebhookRequest } from './providers/provider';
import { ProviderRegistry } from './providers/registry';

type PaymentWithPlan = BillingPayment & { plan: Pick<Plan, 'code' | 'name'> };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const TERMINAL_OK: BillingPayment['status'][] = ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'DISPUTED'];
/** How long an unconfirmed charge stays open before it is marked failed. */
const PENDING_TTL_MS: Record<string, number> = { MANUAL: 14 * 86_400_000, PAYSTACK: 2 * 86_400_000 };
const DEFAULT_PENDING_TTL_MS = 24 * 3600_000;

export function toPaymentRow(p: PaymentWithPlan): BillingPaymentRow {
  return {
    id: p.id,
    reference: p.reference,
    planCode: p.plan.code,
    planName: p.plan.name,
    interval: p.interval,
    purpose: p.purpose,
    provider: p.provider,
    livemode: p.livemode,
    currency: p.currency,
    priceMinor: n(p.priceMinor),
    creditMinor: n(p.creditMinor),
    amountMinor: n(p.amountMinor),
    refundedMinor: n(p.refundedMinor),
    feeMinor: p.feeMinor === null ? null : n(p.feeMinor),
    status: p.status,
    failureReason: p.failureReason,
    receiptNumber: p.receiptNumber,
    payerHint: p.payerHint,
    periodStart: iso(p.periodStart),
    periodEnd: iso(p.periodEnd),
    paidAt: iso(p.paidAt),
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * ChamaHub's own subscription billing. Completely separate from a group's money: nothing here
 * touches the ledger, contributions, loans or payouts.
 *
 * A payment becomes SUCCEEDED only after the provider's status API confirms it with the expected
 * amount and currency, and that transition happens exactly once (a conditional update), so
 * duplicate webhooks, retries and the reconciliation job can never activate a plan twice.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
    private readonly entitlements: EntitlementService,
    private readonly providers: ProviderRegistry,
  ) {}

  /* ------------------------------------------------------------------ catalogue & summary */

  private async groupOrThrow(groupId: string) {
    const g = await this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, countryCode: true, currency: true } });
    if (!g) throw new NotFoundException('Group not found');
    return g;
  }

  /** The price that applies to a group: its country first, then the "*" default; its currency first. */
  private async priceFor(planId: string, countryCode: string, currency: string, interval: BillingInterval) {
    const rows = await this.prisma.planPrice.findMany({ where: { planId, interval, active: true, countryCode: { in: [countryCode, '*'] } } });
    const rank = (r: { countryCode: string; currency: string }) => (r.countryCode === countryCode ? 0 : 2) + (r.currency === currency ? 0 : 1);
    return rows.sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }

  async catalogue(groupId: string): Promise<PlanOffer[]> {
    const g = await this.groupOrThrow(groupId);
    const plans = await this.prisma.plan.findMany({ where: { active: true, isPublic: true }, include: { prices: { where: { active: true, countryCode: { in: [g.countryCode, '*'] } } } }, orderBy: { tier: 'asc' } });
    return plans.map((p) => {
      const rule = toPlanRule(p);
      const prices = (['MONTH', 'YEAR'] as const)
        .map((interval) => {
          const rows = p.prices.filter((r) => r.interval === interval).sort((a, b) => (a.countryCode === g.countryCode ? 0 : 1) - (b.countryCode === g.countryCode ? 0 : 1) || (a.currency === g.currency ? 0 : 1) - (b.currency === g.currency ? 0 : 1));
          return rows[0] ? { interval, currency: rows[0].currency, amountMinor: n(rows[0].amountMinor) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      return { code: p.code, name: p.name, description: p.description, tier: p.tier, features: rule.entitlements.features, maxMembers: rule.entitlements.limits.maxMembers, prices };
    });
  }

  /** Providers that can take a subscription payment for this country and currency right now. */
  async providersFor(countryCode: string, currency: string) {
    const rows = await this.prisma.billingProviderAvailability.findMany({ where: { countryCode, currency, enabled: true } });
    return rows
      .map((r) => ({ row: r, provider: this.providers.get(r.provider) }))
      .filter((x): x is { row: typeof x.row; provider: BillingProvider } => !!x.provider && x.provider.configured())
      .map((x) => ({ code: x.provider.code, name: x.provider.displayName, methods: x.row.methods, livemode: x.provider.livemode(), refunds: x.row.refunds }));
  }

  async summary(groupId: string, canManage: boolean): Promise<SubscriptionSummary> {
    const g = await this.groupOrThrow(groupId);
    const [access, sub, promos, members, pending, payments, region] = await Promise.all([
      this.entitlements.access(groupId),
      this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: true } }),
      this.prisma.promotionalGrant.findMany({ where: { groupId }, include: { plan: { select: { code: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.membership.count({ where: { groupId, status: 'ACTIVE' } }),
      this.prisma.invitation.count({ where: { groupId, status: 'PENDING', expiresAt: { gt: new Date() } } }),
      canManage ? this.prisma.billingPayment.findMany({ where: { groupId }, include: { plan: { select: { code: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }) : Promise.resolve([]),
      this.prisma.region.findUnique({ where: { countryCode: g.countryCode } }),
    ]);
    const scheduled = sub?.scheduledPlanId ? await this.prisma.plan.findUnique({ where: { id: sub.scheduledPlanId }, select: { code: true } }) : null;
    return {
      groupId,
      groupName: g.name,
      countryCode: g.countryCode,
      currency: g.currency,
      access: { planCode: access.plan.code, planName: access.plan.name, source: access.source, until: iso(access.until), features: access.plan.entitlements.features, maxMembers: access.plan.entitlements.limits.maxMembers },
      subscription: sub
        ? {
            planCode: sub.plan.code,
            planName: sub.plan.name,
            status: sub.status,
            interval: sub.interval,
            currency: sub.currency,
            amountMinor: sub.amountMinor === null ? null : n(sub.amountMinor),
            trialEndsAt: iso(sub.trialEndsAt),
            currentPeriodStart: iso(sub.currentPeriodStart),
            currentPeriodEnd: iso(sub.currentPeriodEnd),
            graceEndsAt: iso(sub.graceEndsAt),
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            scheduledPlanCode: scheduled?.code ?? null,
            scheduledInterval: sub.scheduledInterval,
          }
        : null,
      promotions: promos.map((p) => ({ id: p.id, planCode: p.plan.code, planName: p.plan.name, reason: p.reason, startsAt: p.startsAt.toISOString(), endsAt: p.endsAt.toISOString(), revokedAt: iso(p.revokedAt) })),
      usage: { members, pendingInvitations: pending },
      canManage,
      providers: canManage && region?.billingAvailable ? (await this.providersFor(g.countryCode, g.currency)).map(({ refunds: _r, ...p }) => p) : [],
      payments: payments.map(toPaymentRow),
    };
  }

  /* ------------------------------------------------------------------ checkout */

  private async newReference() {
    for (;;) {
      const ref = `CHB-${randomBytes(5).toString('hex').toUpperCase()}`;
      if (!(await this.prisma.billingPayment.findUnique({ where: { reference: ref }, select: { id: true } }))) return ref;
    }
  }

  async checkout(groupId: string, input: { planCode: string; interval: BillingInterval; provider: string; phone?: string; email?: string; idempotencyKey: string }, actorUserId: string, meta: RequestMeta): Promise<CheckoutResult> {
    const existing = await this.prisma.billingPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { plan: { select: { code: true, name: true } } } });
    if (existing) {
      if (existing.groupId !== groupId) throw new ConflictException('This request key was already used.');
      return { payment: toPaymentRow(existing), action: { type: 'NONE', message: 'This payment was already started.' } };
    }
    const g = await this.groupOrThrow(groupId);
    const region = await this.prisma.region.findUnique({ where: { countryCode: g.countryCode } });
    if (!region?.billingAvailable) throw new UnprocessableEntityException(`ChamaHub subscriptions are not sold in ${region?.name ?? g.countryCode} yet.`);
    const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.active || !plan.isPublic || plan.tier === 0) throw new UnprocessableEntityException('Choose a paid plan.');
    const price = await this.priceFor(plan.id, g.countryCode, g.currency, input.interval);
    if (!price) throw new UnprocessableEntityException(`${plan.name} is not sold ${input.interval === 'YEAR' ? 'annually' : 'monthly'} in this country.`);

    const available = await this.providersFor(g.countryCode, price.currency);
    if (!available.some((p) => p.code === input.provider)) throw new UnprocessableEntityException('That payment method is not available for this group.');
    const provider = this.providers.get(input.provider)!;

    const pendingCount = await this.prisma.billingPayment.count({ where: { groupId, status: 'PENDING' } });
    if (pendingCount >= 3) throw new ConflictException('This group already has payments waiting for confirmation. Wait for them to finish or fail, then try again.');

    // What kind of purchase is this, and is there unused paid time to credit?
    const sub = await this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: true } });
    const now = new Date();
    const paidNow = !!sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && !!sub.currentPeriodEnd && sub.currentPeriodEnd > now;
    let purpose: 'NEW' | 'UPGRADE' | 'RENEWAL' = 'NEW';
    let credit = 0;
    if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) {
      if (plan.tier > sub.plan.tier) {
        purpose = paidNow ? 'UPGRADE' : 'NEW';
        if (paidNow && sub.currentPeriodStart && sub.amountMinor !== null && sub.currency === price.currency) {
          credit = Math.min(n(price.amountMinor), prorationCreditMinor(n(sub.amountMinor), sub.currentPeriodStart, sub.currentPeriodEnd!, now));
        }
      } else if (plan.tier === sub.plan.tier) {
        purpose = 'RENEWAL';
      } else if (paidNow) {
        throw new UnprocessableEntityException(`Your ${sub.plan.name} plan is paid until ${formatDate(sub.currentPeriodEnd!.toISOString().slice(0, 10))}. Schedule the change to ${plan.name} instead; it starts when the current period ends.`);
      }
    }
    const priceMinor = n(price.amountMinor);
    const amountMinor = priceMinor - credit;

    const payment = await this.prisma.billingPayment.create({
      data: {
        reference: await this.newReference(),
        groupId,
        subscriptionId: sub?.id ?? null,
        planId: plan.id,
        interval: input.interval,
        purpose,
        provider: amountMinor === 0 ? 'CREDIT' : provider.code,
        livemode: amountMinor === 0 ? env().NODE_ENV === 'production' : provider.livemode(),
        currency: price.currency,
        priceMinor: big(priceMinor),
        creditMinor: big(credit),
        amountMinor: big(amountMinor),
        idempotencyKey: input.idempotencyKey,
        initiatedById: actorUserId,
        payerHint: input.phone ? maskPayerPhone(input.phone) : input.email ? input.email.replace(/^(.).*(@.*)$/, '$1***$2') : null,
      },
      include: { plan: { select: { code: true, name: true } } },
    });
    await this.event({ groupId, type: 'checkout_started', toPlan: plan.code, paymentId: payment.id, actorUserId, meta: { interval: input.interval, purpose, provider: payment.provider, amountMinor, creditMinor: credit, currency: price.currency } });
    await this.audit.log({ groupId, actorUserId, action: 'billing.checkout_started', entityType: 'BillingPayment', entityId: payment.id, after: { plan: plan.code, interval: input.interval, amountMinor, currency: price.currency, provider: payment.provider }, reference: payment.reference, meta });

    if (amountMinor === 0) {
      // Fully covered by unused time: nothing to collect.
      await this.applyStatus(payment.id, { status: 'SUCCEEDED', amountMinor: 0, currency: price.currency, paidAt: now }, 'credit');
      const done = await this.paymentRow(payment.id);
      return { payment: done, action: { type: 'NONE', message: 'Covered by the unused part of your current plan. Your new plan is active.' } };
    }

    try {
      const r = await provider.initiate({ reference: payment.reference, amountMinor, currency: price.currency, description: `ChamaHub ${plan.name} (${input.interval === 'YEAR' ? 'annual' : 'monthly'})`, phone: input.phone, email: input.email });
      if (r.providerRef) await this.prisma.billingPayment.update({ where: { id: payment.id }, data: { providerRef: r.providerRef } });
      return { payment: await this.paymentRow(payment.id), action: r.action };
    } catch (err) {
      await this.prisma.billingPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: err instanceof Error ? err.message.slice(0, 300) : 'Could not start payment' } });
      throw err instanceof ServiceUnavailableException || err instanceof UnprocessableEntityException ? err : new ServiceUnavailableException('The payment could not be started. Nothing was charged.');
    }
  }

  async paymentRow(id: string) {
    return toPaymentRow(await this.prisma.billingPayment.findUniqueOrThrow({ where: { id }, include: { plan: { select: { code: true, name: true } } } }));
  }

  async payments(groupId: string) {
    const rows = await this.prisma.billingPayment.findMany({ where: { groupId }, include: { plan: { select: { code: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(toPaymentRow);
  }

  /** A payment of this group; while pending, ask the provider (at most every 20 s). */
  async payment(groupId: string, id: string) {
    const p = await this.prisma.billingPayment.findFirst({ where: { id, groupId } });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status === 'PENDING' && (!p.lastCheckedAt || Date.now() - p.lastCheckedAt.getTime() > 20_000)) await this.reconcile(p.id).catch((e) => this.logger.warn(`reconcile ${p.reference}: ${e}`));
    return this.paymentRow(id);
  }

  /* ------------------------------------------------------------------ verification & state machine */

  /** Asks the provider for the trusted status of a payment and applies it. */
  async reconcile(paymentId: string) {
    const p = await this.prisma.billingPayment.findUniqueOrThrow({ where: { id: paymentId } });
    const provider = this.providers.get(p.provider);
    if (!provider) return p.status;
    const status = await provider.fetchStatus({ reference: p.reference, providerRef: p.providerRef, amountMinor: n(p.amountMinor), currency: p.currency });
    await this.prisma.billingPayment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date() } });
    await this.applyStatus(p.id, status, 'status_check');
    return status.status;
  }

  /**
   * The only place a payment's status changes in response to a provider. Each transition is a
   * conditional update on the expected current status, so it happens once however many times
   * it is called.
   */
  async applyStatus(paymentId: string, s: ProviderStatus, source: 'status_check' | 'credit' | 'staff', staff?: { userId: string; providerRef?: string; meta?: RequestMeta }) {
    const p = await this.prisma.billingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { plan: true } });
    if (s.status === 'SUCCEEDED') {
      if ((s.amountMinor !== undefined && s.amountMinor !== n(p.amountMinor)) || (s.currency !== undefined && s.currency !== p.currency)) {
        // Never activate on a mismatch: hold it for a person to look at.
        await this.openCase({ groupId: p.groupId, paymentId: p.id, subject: `Amount mismatch on ${p.reference}`, details: `Provider reported ${s.amountMinor} ${s.currency}; expected ${n(p.amountMinor)} ${p.currency}. Not activated.`, priority: 'HIGH' });
        await this.event({ groupId: p.groupId, type: 'payment_mismatch', paymentId: p.id, reason: 'Provider amount or currency did not match' });
        return 'MISMATCH';
      }
      const receipt = await this.nextReceiptNumber();
      const done = await this.prisma.financial(async (tx) => {
        const claimed = await tx.billingPayment.updateMany({
          where: { id: p.id, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
          data: { status: 'SUCCEEDED', paidAt: s.paidAt ?? new Date(), feeMinor: s.feeMinor !== undefined ? big(s.feeMinor) : undefined, providerRef: p.providerRef ?? staff?.providerRef ?? s.providerRef ?? undefined, receiptNumber: receipt, failureReason: null },
        });
        if (claimed.count !== 1) return false;
        await this.activate(tx, p, staff?.userId ?? null, source);
        return true;
      });
      if (done) {
        this.entitlements.invalidate(p.groupId);
        if (staff) await this.audit.log({ groupId: p.groupId, actorUserId: null, action: 'platform.billing_manual_confirmed', entityType: 'BillingPayment', entityId: p.id, reference: staff.providerRef ?? null, meta: staff.meta });
        await this.notifyOfficers(p.groupId, `Payment received: ChamaHub ${p.plan.name}`, `${formatMoney(n(p.amountMinor), p.currency)} received (receipt ${receipt}). Thank you.`, `billing:paid:${p.id}`);
      }
      return done ? 'SUCCEEDED' : 'ALREADY';
    }
    if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      const r = await this.prisma.billingPayment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: s.status, failureReason: s.failureReason?.slice(0, 300) ?? (s.status === 'CANCELLED' ? 'Cancelled' : 'Failed') } });
      if (r.count === 1) {
        await this.event({ groupId: p.groupId, type: p.purpose === 'RENEWAL' ? 'renewal_payment_failed' : 'payment_failed', paymentId: p.id, toPlan: p.plan.code, reason: s.failureReason ?? s.status });
        await this.notifyOfficers(p.groupId, 'ChamaHub payment did not go through', `The ${formatMoney(n(p.amountMinor), p.currency)} payment for ${p.plan.name} ${s.status === 'CANCELLED' ? 'was cancelled' : 'failed'}. Nothing was charged. You can try again from Plan & billing.`, `billing:failed:${p.id}`);
      }
      return s.status;
    }
    if (s.status === 'DISPUTED') {
      const r = await this.prisma.billingPayment.updateMany({ where: { id: p.id, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } }, data: { status: 'DISPUTED' } });
      if (r.count === 1) {
        await this.event({ groupId: p.groupId, type: 'payment_disputed', paymentId: p.id });
        await this.openCase({ groupId: p.groupId, paymentId: p.id, subject: `Payment disputed: ${p.reference}`, details: 'The payer disputed this charge with their provider. Access is unchanged until the dispute is resolved.', priority: 'HIGH' });
      }
      return 'DISPUTED';
    }
    if (s.status === 'REFUNDED' && TERMINAL_OK.includes(p.status) && p.status !== 'REFUNDED') {
      // Refunded at the provider (outside ChamaHub): record the full remaining amount.
      await this.recordRefund(p.id, n(p.amountMinor) - n(p.refundedMinor), 'Refunded at the payment provider', null, 'SUCCEEDED', null);
      return 'REFUNDED';
    }
    return p.status;
  }

  private async nextReceiptNumber() {
    const [{ nextval }] = await this.prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('billing_receipt_seq')`;
    return `CHB-R-${new Date().getUTCFullYear()}-${String(nextval).padStart(6, '0')}`;
  }

  /** Applies a verified payment to the subscription, inside the transaction that marked it paid. */
  private async activate(tx: Tx, p: BillingPayment & { plan: Plan }, actorUserId: string | null, source: string) {
    const now = new Date();
    const sub = await tx.subscription.findUnique({ where: { groupId: p.groupId }, include: { plan: true } });
    let start = now;
    if (p.purpose === 'RENEWAL' && sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.currentPeriodEnd && sub.currentPeriodEnd > now) start = sub.currentPeriodEnd; // renewing early extends
    const end = addInterval(start, p.interval);
    const data = {
      planId: p.planId,
      status: 'ACTIVE' as const,
      interval: p.interval,
      currency: p.currency,
      amountMinor: p.priceMinor,
      currentPeriodStart: start > now ? (sub?.currentPeriodStart ?? now) : start,
      currentPeriodEnd: end,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      scheduledPlanId: null,
      scheduledInterval: null,
      remindersSent: [],
    };
    const saved = sub ? await tx.subscription.update({ where: { id: sub.id }, data }) : await tx.subscription.create({ data: { groupId: p.groupId, ...data } });
    await tx.billingPayment.update({ where: { id: p.id }, data: { subscriptionId: saved.id, periodStart: start, periodEnd: end } });
    await tx.subscriptionEvent.create({
      data: {
        groupId: p.groupId,
        type: p.purpose === 'UPGRADE' ? 'upgraded' : p.purpose === 'RENEWAL' ? 'renewed' : 'activated',
        fromPlan: sub?.plan.code ?? null,
        toPlan: p.plan.code,
        fromStatus: sub?.status ?? null,
        toStatus: 'ACTIVE',
        paymentId: p.id,
        actorUserId,
        meta: { source, periodStart: start.toISOString(), periodEnd: end.toISOString(), amountMinor: n(p.amountMinor), currency: p.currency, livemode: p.livemode },
      },
    });
  }

  /* ------------------------------------------------------------------ webhooks */

  async handleWebhook(providerCode: string, req: WebhookRequest): Promise<unknown> {
    const provider = this.providers.get(providerCode);
    if (!provider?.parseWebhook) throw new NotFoundException('Unknown provider');
    let events;
    try {
      events = provider.parseWebhook(req);
    } catch (err) {
      // Keep a record of rejected deliveries for security monitoring (no payload stored).
      await this.prisma.billingEvent.create({ data: { provider: provider.code, providerEventId: `rejected:${randomBytes(8).toString('hex')}`, type: 'rejected', livemode: false, signatureValid: false, payload: { reason: err instanceof Error ? err.message : 'rejected' }, result: 'rejected', processedAt: new Date() } });
      if (err instanceof WebhookRejectedError) throw new BadRequestException('Webhook rejected');
      throw new BadRequestException('Malformed webhook');
    }
    for (const e of events) {
      const payment = e.reference
        ? await this.prisma.billingPayment.findUnique({ where: { reference: e.reference } })
        : e.providerRef
          ? await this.prisma.billingPayment.findUnique({ where: { provider_providerRef: { provider: provider.code, providerRef: e.providerRef } } })
          : null;
      let stored;
      try {
        stored = await this.prisma.billingEvent.create({ data: { provider: provider.code, providerEventId: e.eventId, type: e.type, paymentId: payment?.id ?? null, livemode: e.livemode, signatureValid: true, payload: e.payload as Prisma.InputJsonValue } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // duplicate delivery: already handled
        throw err;
      }
      let result: string;
      if (!payment) result = 'no_matching_payment';
      else if (payment.livemode !== e.livemode) result = 'mode_mismatch_ignored';
      else {
        // The webhook only tells us to look; the provider's status API decides.
        result = `checked:${await this.reconcile(payment.id)}`;
      }
      await this.prisma.billingEvent.update({ where: { id: stored.id }, data: { result, processedAt: new Date() } });
    }
    return provider.webhookAck?.() ?? { received: true };
  }

  /** Development/test only: makes the sandbox "provider" settle a charge and send its signed webhook. */
  async simulateSandbox(groupId: string, paymentId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED') {
    if (env().NODE_ENV === 'production') throw new NotFoundException();
    const p = await this.prisma.billingPayment.findFirst({ where: { id: paymentId, groupId, provider: 'SANDBOX' } });
    if (!p) throw new NotFoundException('Sandbox payment not found');
    const sandbox = this.providers.sandbox;
    sandbox.settle(p.reference, outcome);
    const hook = sandbox.signedWebhook({ id: `evt_${randomBytes(6).toString('hex')}`, type: 'charge.updated', reference: p.reference });
    await this.handleWebhook('SANDBOX', { rawBody: hook.body, headers: { 'x-sandbox-signature': hook.signature }, query: {} });
    return this.paymentRow(p.id);
  }

  /* ------------------------------------------------------------------ plan changes */

  async changePlan(groupId: string, input: { planCode: string; interval: BillingInterval }, actorUserId: string, meta: RequestMeta) {
    const sub = await this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: true } });
    const target = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!target || !target.active) throw new UnprocessableEntityException('Choose an available plan.');
    const now = new Date();
    const paid = !!sub && sub.status === 'ACTIVE' && !!sub.currentPeriodEnd && sub.currentPeriodEnd > now;
    if (!paid) throw new UnprocessableEntityException('There is no paid period to change. Choose a plan and pay to start it.');
    if (target.tier > sub!.plan.tier) throw new UnprocessableEntityException('Upgrades start immediately: use "Upgrade" to pay the difference.');
    if (target.tier === 0) return this.cancel(groupId, { reason: 'Downgrade to Free' }, actorUserId, meta);
    if (target.id === sub!.planId && input.interval === sub!.interval) throw new UnprocessableEntityException('That is already your plan.');
    await this.prisma.subscription.update({ where: { id: sub!.id }, data: { scheduledPlanId: target.id, scheduledInterval: input.interval, cancelAtPeriodEnd: false } });
    await this.event({ groupId, type: 'change_scheduled', fromPlan: sub!.plan.code, toPlan: target.code, actorUserId, meta: { interval: input.interval, effective: sub!.currentPeriodEnd!.toISOString() } });
    await this.audit.log({ groupId, actorUserId, action: 'billing.change_scheduled', entityType: 'Subscription', entityId: sub!.id, after: { plan: target.code, interval: input.interval }, meta });
    return { ok: true, effectiveAt: sub!.currentPeriodEnd!.toISOString() };
  }

  async cancel(groupId: string, input: { reason?: string }, actorUserId: string, meta: RequestMeta) {
    const sub = await this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: true } });
    if (!sub || !['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status)) throw new UnprocessableEntityException('There is nothing to cancel.');
    const now = new Date();
    if (sub.status === 'TRIALING' || sub.status === 'PAST_DUE') {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: now, graceEndsAt: null, cancelAtPeriodEnd: false } });
      await this.event({ groupId, type: 'cancelled', fromPlan: sub.plan.code, fromStatus: sub.status, toStatus: 'CANCELLED', actorUserId, reason: input.reason });
    } else {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, cancelledAt: now, scheduledPlanId: null, scheduledInterval: null } });
      await this.event({ groupId, type: 'cancel_scheduled', fromPlan: sub.plan.code, actorUserId, reason: input.reason, meta: { effective: sub.currentPeriodEnd?.toISOString() } });
    }
    this.entitlements.invalidate(groupId);
    await this.audit.log({ groupId, actorUserId, action: 'billing.cancelled', entityType: 'Subscription', entityId: sub.id, reason: input.reason ?? null, meta });
    return { ok: true, accessUntil: sub.status === 'ACTIVE' ? sub.currentPeriodEnd?.toISOString() ?? null : now.toISOString() };
  }

  async resume(groupId: string, actorUserId: string, meta: RequestMeta) {
    const sub = await this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: true } });
    if (!sub || sub.status !== 'ACTIVE' || !(sub.cancelAtPeriodEnd || sub.scheduledPlanId)) throw new UnprocessableEntityException('There is no scheduled cancellation or change to undo.');
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false, cancelledAt: null, scheduledPlanId: null, scheduledInterval: null } });
    await this.event({ groupId, type: 'resumed', toPlan: sub.plan.code, actorUserId });
    await this.audit.log({ groupId, actorUserId, action: 'billing.resumed', entityType: 'Subscription', entityId: sub.id, meta });
    return { ok: true };
  }

  /** New groups: a trial of the configured plan when trials are enabled. */
  async startTrial(tx: Tx, groupId: string) {
    const s = await this.settings.get();
    if (!s.trialEnabled || s.trialDays <= 0) return;
    const plan = await tx.plan.findUnique({ where: { code: s.trialPlanCode } });
    if (!plan || !plan.active) return;
    const ends = new Date(Date.now() + s.trialDays * 86_400_000);
    await tx.subscription.create({ data: { groupId, planId: plan.id, status: 'TRIALING', trialEndsAt: ends } });
    await tx.subscriptionEvent.create({ data: { groupId, type: 'trial_started', toPlan: plan.code, toStatus: 'TRIALING', meta: { trialEndsAt: ends.toISOString() } } });
  }

  /* ------------------------------------------------------------------ lifecycle job */

  /** Trials, period ends, grace, scheduled changes, renewal reminders and pending-payment reconciliation. */
  async lifecycle(now = new Date()) {
    const s = await this.settings.get();
    const counts = { trialsEnded: 0, renewalsDue: 0, expired: 0, cancelled: 0, reminders: 0, reconciled: 0, pendingExpired: 0 };

    for (const sub of await this.prisma.subscription.findMany({ where: { status: 'TRIALING', trialEndsAt: { lte: now } }, include: { plan: true } })) {
      if ((await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'TRIALING' }, data: { status: 'EXPIRED' } })).count) {
        counts.trialsEnded++;
        await this.event({ groupId: sub.groupId, type: 'trial_ended', fromPlan: sub.plan.code, fromStatus: 'TRIALING', toStatus: 'EXPIRED' });
        await this.notifyOfficers(sub.groupId, 'Your ChamaHub trial has ended', `Your group is now on Free. All your records stay available. Choose a plan in Plan & billing to keep ${sub.plan.name} features.`, `billing:trial-ended:${sub.id}`);
      }
    }

    for (const sub of await this.prisma.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } }, include: { plan: true } })) {
      if (sub.cancelAtPeriodEnd) {
        if ((await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } })).count) {
          counts.cancelled++;
          await this.event({ groupId: sub.groupId, type: 'cancelled', fromPlan: sub.plan.code, fromStatus: 'ACTIVE', toStatus: 'CANCELLED', reason: 'Cancelled at period end' });
          await this.notifyOfficers(sub.groupId, 'ChamaHub plan ended', 'Your cancellation has taken effect and your group is on Free. All your records stay available.', `billing:cancelled:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`);
        }
        continue;
      }
      const grace = new Date(sub.currentPeriodEnd!.getTime() + s.graceDays * 86_400_000);
      let nextPlan = sub.plan;
      let price: { amountMinor: bigint; currency: string } | null = null;
      if (sub.scheduledPlanId) {
        nextPlan = (await this.prisma.plan.findUnique({ where: { id: sub.scheduledPlanId } })) ?? sub.plan;
        const g = await this.prisma.group.findUniqueOrThrow({ where: { id: sub.groupId }, select: { countryCode: true, currency: true } });
        price = await this.priceFor(nextPlan.id, g.countryCode, g.currency, sub.scheduledInterval ?? sub.interval ?? 'MONTH');
      }
      const updated = await this.prisma.subscription.updateMany({
        where: { id: sub.id, status: 'ACTIVE' },
        data: { status: 'PAST_DUE', graceEndsAt: grace, ...(sub.scheduledPlanId ? { planId: nextPlan.id, interval: sub.scheduledInterval ?? sub.interval, amountMinor: price?.amountMinor ?? sub.amountMinor, currency: price?.currency ?? sub.currency, scheduledPlanId: null, scheduledInterval: null } : {}) },
      });
      if (updated.count) {
        counts.renewalsDue++;
        await this.event({ groupId: sub.groupId, type: 'renewal_due', fromPlan: sub.plan.code, toPlan: nextPlan.code, fromStatus: 'ACTIVE', toStatus: 'PAST_DUE', meta: { graceEndsAt: grace.toISOString() } });
        await this.notifyOfficers(sub.groupId, 'ChamaHub renewal payment needed', `Your ${nextPlan.name} plan period has ended. Paid features keep working until ${formatDate(grace.toISOString().slice(0, 10))}. Renew in Plan & billing; your records stay available either way.`, `billing:due:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`);
      }
    }

    for (const sub of await this.prisma.subscription.findMany({ where: { status: 'PAST_DUE', graceEndsAt: { lte: now } }, include: { plan: true } })) {
      if ((await this.prisma.subscription.updateMany({ where: { id: sub.id, status: 'PAST_DUE' }, data: { status: 'EXPIRED' } })).count) {
        counts.expired++;
        await this.event({ groupId: sub.groupId, type: 'expired', fromPlan: sub.plan.code, fromStatus: 'PAST_DUE', toStatus: 'EXPIRED', reason: 'Grace period ended without payment' });
        await this.notifyOfficers(sub.groupId, 'ChamaHub plan expired', `No renewal payment was received, so your group is now on Free. Every record, statement and report stays available. Renew any time in Plan & billing.`, `billing:expired:${sub.id}:${sub.graceEndsAt?.toISOString()}`);
      }
    }

    const days = [...s.renewalReminderDays].sort((a, b) => b - a);
    for (const sub of await this.prisma.subscription.findMany({ where: { status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + (days[0] ?? 0) * 86_400_000) } }, include: { plan: true } })) {
      const left = (sub.currentPeriodEnd!.getTime() - now.getTime()) / 86_400_000;
      const due = days.filter((d) => left <= d && !sub.remindersSent.includes(d));
      if (!due.length) continue;
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { remindersSent: [...sub.remindersSent, ...due] } });
      counts.reminders++;
      await this.notifyOfficers(sub.groupId, `ChamaHub ${sub.plan.name} renews soon`, `Your plan period ends on ${formatDate(sub.currentPeriodEnd!.toISOString().slice(0, 10))}${sub.amountMinor !== null && sub.currency ? `. Renewal: ${formatMoney(n(sub.amountMinor), sub.currency)}` : ''}. Pay in Plan & billing to avoid interruption.`, `billing:remind:${sub.id}:${sub.currentPeriodEnd!.toISOString()}:${Math.min(...due)}`);
    }

    for (const p of await this.prisma.billingPayment.findMany({ where: { status: 'PENDING', createdAt: { lte: new Date(now.getTime() - 60_000) }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(now.getTime() - 5 * 60_000) } }] }, take: 100 })) {
      try {
        const st = await this.reconcile(p.id);
        counts.reconciled++;
        if (st === 'PENDING' && now.getTime() - p.createdAt.getTime() > (PENDING_TTL_MS[p.provider] ?? DEFAULT_PENDING_TTL_MS)) {
          await this.applyStatus(p.id, { status: 'FAILED', failureReason: 'Expired: no confirmation from the provider' }, 'status_check');
          counts.pendingExpired++;
        }
      } catch (err) {
        this.logger.warn(`reconcile ${p.reference} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (Object.values(counts).some((v) => v > 0)) this.entitlements.invalidate();
    return counts;
  }

  /* ------------------------------------------------------------------ staff actions */

  async grantPromotion(groupId: string, input: { planCode: string; endsAt: string; reason: string }, staffId: string, meta: RequestMeta) {
    await this.groupOrThrow(groupId);
    const plan = await this.prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || plan.tier === 0) throw new UnprocessableEntityException('Choose a paid plan.');
    const endsAt = new Date(input.endsAt);
    if (endsAt <= new Date()) throw new UnprocessableEntityException('The end date must be in the future.');
    if (endsAt.getTime() - Date.now() > 366 * 86_400_000) throw new UnprocessableEntityException('Promotional access can last at most a year.');
    const g = await this.prisma.promotionalGrant.create({ data: { groupId, planId: plan.id, reason: input.reason, endsAt, grantedById: staffId } });
    await this.event({ groupId, type: 'promotion_granted', toPlan: plan.code, actorUserId: staffId, reason: input.reason, meta: { endsAt: endsAt.toISOString() } });
    await this.audit.log({ groupId, actorUserId: null, action: 'platform.promotion_granted', entityType: 'PromotionalGrant', entityId: g.id, after: { plan: plan.code, endsAt: endsAt.toISOString() }, reason: input.reason, meta });
    this.entitlements.invalidate(groupId);
    return { id: g.id };
  }

  async revokePromotion(groupId: string, promoId: string, reason: string, staffId: string, meta: RequestMeta) {
    const g = await this.prisma.promotionalGrant.findFirst({ where: { id: promoId, groupId }, include: { plan: true } });
    if (!g) throw new NotFoundException('Promotion not found');
    if (g.revokedAt) throw new ConflictException('Already revoked');
    await this.prisma.promotionalGrant.update({ where: { id: g.id }, data: { revokedAt: new Date(), revokedById: staffId, revokeReason: reason } });
    await this.event({ groupId, type: 'promotion_revoked', fromPlan: g.plan.code, actorUserId: staffId, reason });
    await this.audit.log({ groupId, actorUserId: null, action: 'platform.promotion_revoked', entityType: 'PromotionalGrant', entityId: g.id, reason, meta });
    this.entitlements.invalidate(groupId);
    return { ok: true };
  }

  /** Bank transfers: finance staff confirm after seeing the money on ChamaHub's statement. */
  async confirmManual(paymentId: string, input: { bankReference: string }, staffId: string, meta: RequestMeta) {
    const p = await this.prisma.billingPayment.findUnique({ where: { id: paymentId } });
    if (!p || p.provider !== 'MANUAL') throw new NotFoundException('Manual payment not found');
    if (p.status !== 'PENDING') throw new ConflictException(`This payment is already ${p.status.toLowerCase()}.`);
    await this.prisma.billingPayment.update({ where: { id: p.id }, data: { providerRef: input.bankReference } });
    return this.applyStatus(p.id, { status: 'SUCCEEDED', amountMinor: n(p.amountMinor), currency: p.currency, paidAt: new Date() }, 'staff', { userId: staffId, providerRef: input.bankReference, meta });
  }

  async refund(paymentId: string, input: { amountMinor: number; reason: string }, staffId: string, meta: RequestMeta) {
    const p = await this.prisma.billingPayment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('Payment not found');
    if (!['SUCCEEDED', 'PARTIALLY_REFUNDED', 'DISPUTED'].includes(p.status)) throw new UnprocessableEntityException('Only paid payments can be refunded.');
    const left = n(p.amountMinor) - n(p.refundedMinor);
    if (input.amountMinor > left) throw new UnprocessableEntityException(`At most ${formatMoney(left, p.currency)} can still be refunded.`);
    const provider = this.providers.get(p.provider);
    let outcome: { providerRef: string | null; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' } = { providerRef: null, status: 'SUCCEEDED' };
    if (p.provider !== 'MANUAL' && p.provider !== 'CREDIT') {
      if (!provider?.refund) throw new UnprocessableEntityException(`${provider?.displayName ?? p.provider} refunds are not available through ChamaHub. Refund the payer directly, then record it as a manual refund.`);
      outcome = await provider.refund({ reference: p.reference, providerRef: p.providerRef, currency: p.currency }, input.amountMinor, input.reason);
      if (outcome.status === 'FAILED') throw new ServiceUnavailableException('The provider refused the refund. Nothing was changed.');
    }
    const refund = await this.recordRefund(p.id, input.amountMinor, input.reason, outcome.providerRef, outcome.status, staffId);
    await this.audit.log({ groupId: p.groupId, actorUserId: null, action: 'platform.billing_refund', entityType: 'BillingPayment', entityId: p.id, after: { amountMinor: input.amountMinor, currency: p.currency, status: outcome.status }, reason: input.reason, reference: p.reference, meta });
    return refund;
  }

  /**
   * Records a refund. When it completes and the whole payment is refunded, the paid period that
   * payment bought ends now (the group drops to Free unless something else gives access).
   */
  private async recordRefund(paymentId: string, amountMinor: number, reason: string, providerRef: string | null, status: 'PENDING' | 'SUCCEEDED' | 'FAILED', staffId: string | null) {
    return this.prisma.financial(async (tx) => {
      const p = await tx.billingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { plan: true } });
      const refund = await tx.billingRefund.create({ data: { paymentId, amountMinor: big(amountMinor), currency: p.currency, reason, provider: p.provider, providerRef, status, createdById: staffId ?? 'provider' } });
      if (status !== 'SUCCEEDED') return { id: refund.id, status };
      const refunded = n(p.refundedMinor) + amountMinor;
      const full = refunded >= n(p.amountMinor);
      await tx.billingPayment.update({ where: { id: p.id }, data: { refundedMinor: big(refunded), status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      await tx.subscriptionEvent.create({ data: { groupId: p.groupId, type: full ? 'refunded' : 'partially_refunded', paymentId: p.id, actorUserId: staffId, reason, meta: { amountMinor, currency: p.currency } } });
      if (full) {
        const sub = await tx.subscription.findUnique({ where: { groupId: p.groupId } });
        if (sub && p.periodEnd && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() === p.periodEnd.getTime()) {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED', currentPeriodEnd: new Date(), graceEndsAt: null } });
          await tx.subscriptionEvent.create({ data: { groupId: p.groupId, type: 'access_revoked_by_refund', fromPlan: p.plan.code, fromStatus: sub.status, toStatus: 'EXPIRED', paymentId: p.id, actorUserId: staffId, reason } });
        }
      }
      this.entitlements.invalidate(p.groupId);
      return { id: refund.id, status };
    });
  }

  async receipt(groupId: string | null, paymentId: string): Promise<BillingReceipt> {
    const p = await this.prisma.billingPayment.findFirst({ where: { id: paymentId, ...(groupId ? { groupId } : {}) }, include: { plan: true, group: { select: { name: true } }, events: { select: { payload: true }, take: 5 } } });
    if (!p || !p.receiptNumber) throw new NotFoundException('No receipt for this payment yet');
    const mpesa = this.providers.get('MPESA_DARAJA') as { receiptFromPayload?: (x: Record<string, unknown>) => string | undefined } | undefined;
    const providerReceipt = p.provider === 'MPESA_DARAJA' ? (p.events.map((e) => mpesa?.receiptFromPayload?.(e.payload as Record<string, unknown>)).find(Boolean) ?? null) : p.providerRef;
    return {
      receiptNumber: p.receiptNumber,
      reference: p.reference,
      issuedAt: (p.paidAt ?? p.updatedAt).toISOString(),
      seller: { name: env().BILLING_SELLER_NAME, address: env().BILLING_SELLER_ADDRESS ?? null, email: env().BILLING_SELLER_EMAIL ?? null, taxId: env().BILLING_SELLER_TAX_ID ?? null },
      groupName: p.group.name,
      description: `ChamaHub ${p.plan.name} plan, ${p.interval === 'YEAR' ? 'annual' : 'monthly'}${p.purpose === 'UPGRADE' ? ' (upgrade)' : p.purpose === 'RENEWAL' ? ' (renewal)' : ''}`,
      periodStart: iso(p.periodStart),
      periodEnd: iso(p.periodEnd),
      currency: p.currency,
      priceMinor: n(p.priceMinor),
      creditMinor: n(p.creditMinor),
      amountMinor: n(p.amountMinor),
      refundedMinor: n(p.refundedMinor),
      provider: p.provider,
      providerReceipt: providerReceipt ?? null,
      livemode: p.livemode,
      status: p.status,
    };
  }

  /* ------------------------------------------------------------------ helpers */

  async openCase(input: { groupId?: string; paymentId?: string; subject: string; details: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' }, createdById = 'system') {
    return this.prisma.billingCase.create({ data: { groupId: input.groupId ?? null, paymentId: input.paymentId ?? null, subject: input.subject, details: input.details, priority: input.priority ?? 'NORMAL', createdById } });
  }

  private async event(e: { groupId: string; type: string; fromPlan?: string | null; toPlan?: string | null; fromStatus?: string | null; toStatus?: string | null; paymentId?: string | null; actorUserId?: string | null; reason?: string | null; meta?: Record<string, unknown> }) {
    await this.prisma.subscriptionEvent.create({ data: { ...e, meta: e.meta as Prisma.InputJsonValue | undefined } });
  }

  /** Officers who can manage billing in this group (chairperson and treasurer by default). */
  private async notifyOfficers(groupId: string, title: string, body: string, dedupeKey: string) {
    const ms = await this.prisma.membership.findMany({ where: { groupId, status: 'ACTIVE', role: { not: 'MEMBER' } }, select: { userId: true, role: true, specialRoles: true, group: { select: { rolePolicy: true } } } });
    const users = ms.filter((m) => resolvePermissions(m.role as GroupRole, m.group.rolePolicy as RolePolicy | null, m.specialRoles as SpecialRole[]).includes(Permission.BILLING_MANAGE)).map((m) => m.userId);
    if (users.length) await this.notifications.notify(users, { groupId, type: 'BILLING', title, body, dedupeKey }).catch((e) => this.logger.warn(`notify failed: ${e}`));
  }
}
