/**
 * Subscription rules shared by the API (which enforces them) and the apps (which explain them).
 * Plan definitions, prices and entitlements live in the database and are edited by platform
 * staff; this file only defines their shape and the pure rules applied to them.
 */
import { divRound } from './money';

/** Paid capabilities a plan can include. Reading records, statements and reports is never a feature: it is always available. */
export const Feature = {
  /** Officers can record and approve new loans (existing loans can always be repaid and viewed). */
  LOANS: 'loans',
  CONTRIBUTION_REMINDERS: 'contribution_reminders',
  WHATSAPP_SUMMARIES: 'whatsapp_summaries',
  STATEMENT_IMPORT: 'statement_import',
  BULK_IMPORT: 'bulk_import',
  AI_ASSISTANT: 'ai_assistant',
  PRIORITY_SUPPORT: 'priority_support',
} as const;
export type Feature = (typeof Feature)[keyof typeof Feature];
export const FEATURES = Object.values(Feature) as [Feature, ...Feature[]];

export const FEATURE_LABELS: Record<Feature, string> = {
  loans: 'New loans',
  contribution_reminders: 'Contribution reminders',
  whatsapp_summaries: 'WhatsApp summaries',
  statement_import: 'Bank & M-Pesa statement import',
  bulk_import: 'Bulk data import',
  ai_assistant: 'AI assistant',
  priority_support: 'Priority support',
};

export interface Entitlements {
  features: Feature[];
  limits: { maxMembers: number };
}

export const PLAN_CODES = ['FREE', 'STARTER', 'STANDARD', 'PREMIUM'] as const;
export type BillingInterval = 'MONTH' | 'YEAR';
export const BILLING_INTERVALS = ['MONTH', 'YEAR'] as const;
export type SubscriptionStatusCode = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
export type BillingPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'DISPUTED';

/** Used only if the FREE plan row is missing: deny every paid feature. */
export const FALLBACK_FREE: Entitlements = { features: [], limits: { maxMembers: 15 } };

export interface PlanRule {
  code: string;
  name: string;
  tier: number;
  entitlements: Entitlements;
}

export interface SubscriptionState {
  planCode: string;
  status: SubscriptionStatusCode;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
}

export interface PromoState {
  planCode: string;
  startsAt: Date;
  endsAt: Date;
  revokedAt: Date | null;
}

export type AccessSource = 'PROMOTION' | 'TRIAL' | 'PAID' | 'GRACE' | 'FREE';

export interface EffectiveAccess {
  plan: PlanRule;
  source: AccessSource;
  /** When this access ends (null for Free). */
  until: Date | null;
}

/**
 * Decides which plan a group has right now. Dates are checked directly, so access ends on
 * time even if the background job that updates statuses has not run yet.
 * Order: the better of an active promotion and the subscription; otherwise Free.
 */
export function resolveAccess(now: Date, plans: readonly PlanRule[], sub: SubscriptionState | null, promos: readonly PromoState[], freeCode = 'FREE'): EffectiveAccess {
  const byCode = new Map(plans.map((p) => [p.code, p]));
  const free: PlanRule = byCode.get(freeCode) ?? { code: freeCode, name: 'Free', tier: 0, entitlements: FALLBACK_FREE };
  const candidates: EffectiveAccess[] = [];
  for (const p of promos) {
    const plan = byCode.get(p.planCode);
    if (plan && !p.revokedAt && p.startsAt <= now && now < p.endsAt) candidates.push({ plan, source: 'PROMOTION', until: p.endsAt });
  }
  if (sub) {
    const plan = byCode.get(sub.planCode);
    if (plan) {
      if (sub.status === 'TRIALING' && sub.trialEndsAt && now < sub.trialEndsAt) candidates.push({ plan, source: 'TRIAL', until: sub.trialEndsAt });
      else if ((sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.currentPeriodEnd && now < sub.currentPeriodEnd) candidates.push({ plan, source: 'PAID', until: sub.currentPeriodEnd });
      else if ((sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.graceEndsAt && now < sub.graceEndsAt) candidates.push({ plan, source: 'GRACE', until: sub.graceEndsAt });
    }
  }
  candidates.sort((a, b) => b.plan.tier - a.plan.tier);
  return candidates[0] ?? { plan: free, source: 'FREE', until: null };
}

export function hasFeature(e: Entitlements, f: Feature) {
  return e.features.includes(f);
}

/** The cheapest (lowest-tier) active plan that includes a feature, to tell users what to upgrade to. */
export function cheapestPlanWith(plans: readonly PlanRule[], f: Feature): PlanRule | null {
  return [...plans].sort((a, b) => a.tier - b.tier).find((p) => hasFeature(p.entitlements, f)) ?? null;
}

/** Monthly-equivalent of a recurring price, for MRR: annual prices count as 1/12 per month (rounded once). */
export function monthlyEquivalentMinor(amountMinor: number, interval: BillingInterval): number {
  return interval === 'YEAR' ? divRound(amountMinor, 12) : amountMinor;
}

/** Adds one billing interval in UTC, clamping the day (31 Jan + 1 month → 28/29 Feb). */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Credit for the unused part of the current paid period when upgrading, in the same currency:
 * paid × remaining ÷ length, rounded half away from zero. Zero when nothing remains.
 */
export function prorationCreditMinor(paidMinor: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = periodEnd.getTime() - now.getTime();
  if (paidMinor <= 0 || total <= 0 || remaining <= 0) return 0;
  // Work in whole seconds so the integer division stays within safe integers.
  const t = Math.round(total / 1000);
  const r = Math.min(t, Math.round(remaining / 1000));
  return Number((BigInt(paidMinor) * BigInt(r) * 2n + BigInt(t)) / (2n * BigInt(t)));
}

/** "2547****5678": enough for support to recognise a payer, not enough to contact them. */
export function maskPayerPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length < 8 ? '****' : `${d.slice(0, 4)}****${d.slice(-4)}`;
}

export const BILLING_STATUS_LABELS: Record<BillingPaymentStatus, string> = {
  PENDING: 'Waiting for payment',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
  DISPUTED: 'Disputed',
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatusCode, string> = {
  TRIALING: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue (grace period)',
  EXPIRED: 'Expired — on Free',
  CANCELLED: 'Cancelled — on Free',
};
