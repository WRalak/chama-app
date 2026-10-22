import { describe, expect, it } from 'vitest';
import { addInterval, cheapestPlanWith, monthlyEquivalentMinor, PlanRule, prorationCreditMinor, resolveAccess } from './billing';
import { convertMinor, convertMinorInverse, formatMoney, minorToDecimalString, parseMoney, totalsByCurrency } from './currency';
import { missingTranslations, normaliseLocale, t } from './i18n';
import { MoneyError } from './money';

describe('currency precision', () => {
  it('formats each currency with its own minor units', () => {
    expect(formatMoney(123450, 'KES')).toBe('KSh 1,234.50');
    expect(formatMoney(5000, 'UGX')).toBe('USh 5,000');
    expect(formatMoney(1250, 'KWD')).toBe('KD 1.250');
    expect(formatMoney(-99, 'USD', { code: true })).toBe('-USD 0.99');
    expect(formatMoney(100000, 'KES', { compact: true })).toBe('KSh 1,000');
  });

  it('parses without floating point and rejects extra decimals', () => {
    expect(parseMoney('1,234.5', 'KES')).toBe(123450);
    expect(parseMoney('KSh 0.1', 'KES')).toBe(10);
    expect(parseMoney('5,000', 'UGX')).toBe(5000);
    expect(parseMoney('1.25', 'KWD')).toBe(1250);
    expect(() => parseMoney('10.5', 'UGX')).toThrow(MoneyError);
    expect(() => parseMoney('1.234', 'KES')).toThrow(MoneyError);
    // 0.1 + 0.2 style errors cannot happen: every step is integer.
    expect(parseMoney('0.1', 'USD') + parseMoney('0.2', 'USD')).toBe(parseMoney('0.3', 'USD'));
  });

  it('exports plain decimals', () => {
    expect(minorToDecimalString(123450, 'KES')).toBe('1234.50');
    expect(minorToDecimalString(7, 'KWD')).toBe('0.007');
    expect(minorToDecimalString(5000, 'UGX')).toBe('5000');
  });

  it('never adds different currencies', () => {
    expect(totalsByCurrency([{ currency: 'KES', amountMinor: 100 }, { currency: 'USD', amountMinor: 5 }, { currency: 'KES', amountMinor: 50 }])).toEqual({ KES: 150, USD: 5 });
  });

  it('converts only with an explicit dated rate, exactly, rounding once', () => {
    expect(() => convertMinor(100, 'USD', 'KES', null, null)).toThrow(/No exchange rate/);
    // US$ 10.00 at 129.4512 = KSh 1,294.51 (1294.512 rounded half up)
    expect(convertMinor(1000, 'USD', 'KES', '129.4512', '2026-10-01')).toEqual({ amountMinor: 129451, from: 'USD', to: 'KES', rate: '129.4512', asOf: '2026-10-01' });
    // KSh 1,000.00 at 0.00772 = US$ 7.72
    expect(convertMinor(100000, 'KES', 'USD', '0.00772', '2026-10-01').amountMinor).toBe(772);
    // 0-decimal to 2-decimal: USh 37,000 at 0.0349 = KSh 1,291.30
    expect(convertMinor(37000, 'UGX', 'KES', '0.0349', '2026-10-01').amountMinor).toBe(129130);
    expect(convertMinor(500, 'KES', 'KES', null, null).amountMinor).toBe(500);
    // KSh 1,294.51 back to USD with the USD→KES rate: 1294.51 / 129.4512 = 9.99996… → US$ 10.00
    expect(convertMinorInverse(129451, 'KES', 'USD', '129.4512', '2026-10-01')).toMatchObject({ amountMinor: 1000, rate: '1/129.4512' });
  });
});

const plans: PlanRule[] = [
  { code: 'FREE', name: 'Free', tier: 0, entitlements: { features: [], limits: { maxMembers: 15 } } },
  { code: 'STARTER', name: 'Starter', tier: 10, entitlements: { features: ['loans', 'contribution_reminders'], limits: { maxMembers: 30 } } },
  { code: 'PREMIUM', name: 'Premium', tier: 30, entitlements: { features: ['loans', 'contribution_reminders', 'ai_assistant'], limits: { maxMembers: 500 } } },
];
const now = new Date('2026-10-22T12:00:00Z');
const day = 86_400_000;
const at = (d: number) => new Date(now.getTime() + d * day);

describe('effective access', () => {
  it('falls back to Free with no subscription', () => {
    expect(resolveAccess(now, plans, null, []).source).toBe('FREE');
  });
  it('honours trial, paid period and grace by date even if status was not updated', () => {
    expect(resolveAccess(now, plans, { planCode: 'PREMIUM', status: 'TRIALING', trialEndsAt: at(1), currentPeriodEnd: null, graceEndsAt: null }, []).source).toBe('TRIAL');
    expect(resolveAccess(now, plans, { planCode: 'PREMIUM', status: 'TRIALING', trialEndsAt: at(-1), currentPeriodEnd: null, graceEndsAt: null }, []).source).toBe('FREE');
    expect(resolveAccess(now, plans, { planCode: 'STARTER', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(3), graceEndsAt: null }, []).plan.code).toBe('STARTER');
    expect(resolveAccess(now, plans, { planCode: 'STARTER', status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: at(-2), graceEndsAt: at(5) }, []).source).toBe('GRACE');
    expect(resolveAccess(now, plans, { planCode: 'STARTER', status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: at(-9), graceEndsAt: at(-2) }, []).source).toBe('FREE');
    expect(resolveAccess(now, plans, { planCode: 'STARTER', status: 'EXPIRED', trialEndsAt: null, currentPeriodEnd: at(5), graceEndsAt: null }, []).source).toBe('FREE');
  });
  it('uses the better of an active promotion and the subscription', () => {
    const sub = { planCode: 'STARTER', status: 'ACTIVE' as const, trialEndsAt: null, currentPeriodEnd: at(10), graceEndsAt: null };
    expect(resolveAccess(now, plans, sub, [{ planCode: 'PREMIUM', startsAt: at(-1), endsAt: at(5), revokedAt: null }]).source).toBe('PROMOTION');
    expect(resolveAccess(now, plans, sub, [{ planCode: 'PREMIUM', startsAt: at(-1), endsAt: at(5), revokedAt: at(-0.5) }]).plan.code).toBe('STARTER');
    expect(resolveAccess(now, plans, sub, [{ planCode: 'PREMIUM', startsAt: at(-9), endsAt: at(-1), revokedAt: null }]).plan.code).toBe('STARTER');
  });
  it('names the cheapest plan that includes a feature', () => {
    expect(cheapestPlanWith(plans, 'ai_assistant')?.code).toBe('PREMIUM');
    expect(cheapestPlanWith(plans, 'loans')?.code).toBe('STARTER');
  });
});

describe('billing arithmetic', () => {
  it('adds months without drifting past month ends', () => {
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'MONTH').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'YEAR').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
  it('credits the unused part of a period exactly', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    const end = new Date('2026-10-31T00:00:00Z');
    expect(prorationCreditMinor(300000, start, end, new Date('2026-10-16T00:00:00Z'))).toBe(150000);
    expect(prorationCreditMinor(100, start, end, new Date('2026-10-21T00:00:00Z'))).toBe(33);
    expect(prorationCreditMinor(300000, start, end, end)).toBe(0);
  });
  it('counts annual prices as one twelfth for MRR', () => {
    expect(monthlyEquivalentMinor(1199000, 'YEAR')).toBe(99917);
    expect(monthlyEquivalentMinor(99900, 'MONTH')).toBe(99900);
  });
});

describe('localisation', () => {
  it('translates, falls back to English, and interpolates', () => {
    expect(t('sw', 'nav.loans')).toBe('Mikopo');
    expect(t('sw-KE', 'tab.home')).toBe('Nyumbani');
    expect(t('fr', 'nav.loans')).toBe('Loans');
    expect(t('en', 'billing.upgradeTitle', { plan: 'Premium' })).toBe('Available on Premium');
    expect(normaliseLocale('SW_tz')).toBe('sw');
  });
  it('has a complete Swahili catalogue', () => {
    expect(missingTranslations('sw')).toEqual([]);
  });
});
