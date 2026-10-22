import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { cheapestPlanWith, EffectiveAccess, Entitlements, FALLBACK_FREE, Feature, FEATURE_LABELS, PlanRule, resolveAccess } from '@chamahub/shared';
import { PrismaService } from '../../prisma/prisma.service';

export type Tx = Pick<PrismaService, 'plan' | 'subscription' | 'promotionalGrant' | 'membership' | 'invitation'>;

/** 402 with enough detail for the apps to explain which plan unlocks the feature. */
export class PaymentRequiredException extends HttpException {
  constructor(message: string, details: Record<string, unknown>) {
    super({ message, details }, HttpStatus.PAYMENT_REQUIRED);
  }
}

export function toPlanRule(p: { code: string; name: string; tier: number; entitlements: unknown }): PlanRule {
  const e = (p.entitlements ?? {}) as Partial<Entitlements>;
  return { code: p.code, name: p.name, tier: p.tier, entitlements: { features: Array.isArray(e.features) ? (e.features as Feature[]) : [], limits: { maxMembers: e.limits?.maxMembers ?? FALLBACK_FREE.limits.maxMembers } } };
}

/**
 * The single place that decides what a group's plan allows. Every paid feature is checked here
 * on the server; the apps only use the result to explain and to hide buttons.
 * Reading records, statements and reports is never checked: it stays available on every plan.
 */
@Injectable()
export class EntitlementService {
  private cache = new Map<string, { at: number; access: EffectiveAccess }>();
  private plansCache: { at: number; plans: PlanRule[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidate(groupId?: string) {
    if (groupId) this.cache.delete(groupId);
    else this.cache.clear();
    this.plansCache = null;
  }

  async plans(): Promise<PlanRule[]> {
    if (this.plansCache && Date.now() - this.plansCache.at < 30_000) return this.plansCache.plans;
    // Inactive (legacy) plans still apply to groups that hold them, so all plans are loaded.
    const rows = await this.prisma.plan.findMany();
    const plans = rows.map(toPlanRule);
    this.plansCache = { at: Date.now(), plans };
    return plans;
  }

  async access(groupId: string, now = new Date()): Promise<EffectiveAccess> {
    const hit = this.cache.get(groupId);
    if (hit && Date.now() - hit.at < 15_000 && (!hit.access.until || hit.access.until > now)) return hit.access;
    const [plans, sub, promos] = await Promise.all([
      this.plans(),
      this.prisma.subscription.findUnique({ where: { groupId }, include: { plan: { select: { code: true } } } }),
      this.prisma.promotionalGrant.findMany({ where: { groupId, revokedAt: null, endsAt: { gt: now } }, include: { plan: { select: { code: true } } } }),
    ]);
    const access = resolveAccess(
      now,
      plans,
      sub ? { planCode: sub.plan.code, status: sub.status, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd, graceEndsAt: sub.graceEndsAt } : null,
      promos.map((p) => ({ planCode: p.plan.code, startsAt: p.startsAt, endsAt: p.endsAt, revokedAt: p.revokedAt })),
    );
    this.cache.set(groupId, { at: Date.now(), access });
    return access;
  }

  async has(groupId: string, feature: Feature) {
    return (await this.access(groupId)).plan.entitlements.features.includes(feature);
  }

  async assertFeature(groupId: string, feature: Feature) {
    const access = await this.access(groupId);
    if (access.plan.entitlements.features.includes(feature)) return;
    const needed = cheapestPlanWith((await this.plans()).filter((p) => p.tier > 0), feature);
    throw new PaymentRequiredException(`${FEATURE_LABELS[feature]} is not included in your group's ${access.plan.name} plan.${needed ? ` It is available on ${needed.name}.` : ''} Your records stay available on every plan.`, {
      code: 'FEATURE_NOT_IN_PLAN',
      feature,
      currentPlan: access.plan.code,
      requiredPlan: needed?.code ?? null,
    });
  }

  /**
   * Members a group may add. Counts active members plus pending invitations when inviting,
   * so a group cannot invite past its limit and then have invitations fail.
   */
  async assertCanAddMembers(groupId: string, adding: number, opts: { countPendingInvitations: boolean; tx?: Tx } = { countPendingInvitations: false }) {
    const db = opts.tx ?? this.prisma;
    const access = await this.access(groupId);
    const max = access.plan.entitlements.limits.maxMembers;
    const [active, pending] = await Promise.all([
      db.membership.count({ where: { groupId, status: 'ACTIVE' } }),
      opts.countPendingInvitations ? db.invitation.count({ where: { groupId, status: 'PENDING', expiresAt: { gt: new Date() } } }) : Promise.resolve(0),
    ]);
    if (active + pending + adding <= max) return;
    const bigger = (await this.plans()).filter((p) => p.tier > access.plan.tier && p.entitlements.limits.maxMembers >= active + pending + adding).sort((a, b) => a.tier - b.tier)[0];
    throw new PaymentRequiredException(`The ${access.plan.name} plan allows up to ${max} members${pending ? ` (including pending invitations)` : ''}.${bigger ? ` ${bigger.name} allows ${bigger.entitlements.limits.maxMembers}.` : ''}`, {
      code: 'MEMBER_LIMIT',
      currentPlan: access.plan.code,
      requiredPlan: bigger?.code ?? null,
      limit: max,
      current: active + pending,
    });
  }
}
