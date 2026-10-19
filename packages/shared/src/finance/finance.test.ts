import { describe, expect, it } from 'vitest';
import { allocateRepayment, checkLoanEligibility, computeLoanSchedule } from './loans';
import { computeDistribution } from './distribution';
import { planRotation, roundShortfall } from './rotation';

const base = { frequency: 'MONTHLY' as const, firstDueDate: '2026-02-01' };

describe('loan schedules', () => {
  it('flat rate: 10,000 at 10%/month over 3 months', () => {
    const s = computeLoanSchedule({ ...base, principalCents: 1_000_000, rateBps: 1000, method: 'FLAT', installments: 3 });
    expect(s.totalInterestCents).toBe(300_000);
    expect(s.totalRepayableCents).toBe(1_300_000);
    expect(s.installments.map((i) => i.principalCents)).toEqual([333_334, 333_333, 333_333]);
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01']);
    expect(s.installments.at(-1)!.closingBalanceCents).toBe(0);
  });

  it('one-off interest charges the rate once', () => {
    const s = computeLoanSchedule({ ...base, principalCents: 1_000_000, rateBps: 1000, method: 'ONE_OFF', installments: 4 });
    expect(s.totalInterestCents).toBe(100_000);
  });

  it('reducing balance charges interest on the opening balance', () => {
    const s = computeLoanSchedule({ ...base, principalCents: 1_200_000, rateBps: 100, method: 'REDUCING_BALANCE', installments: 3 });
    expect(s.installments.map((i) => i.interestCents)).toEqual([12_000, 8_000, 4_000]);
    expect(s.totalInterestCents).toBe(24_000);
  });

  it('amortized installments are level and clear the loan exactly', () => {
    const s = computeLoanSchedule({ ...base, principalCents: 10_000_000, rateBps: 150, method: 'AMORTIZED', installments: 12 });
    const totals = s.installments.map((i) => i.totalCents);
    // Standard annuity at 1.5% for 12 periods ≈ 9,167.99 per month.
    expect(totals[0]).toBeGreaterThanOrEqual(916_799);
    expect(totals[0]).toBeLessThanOrEqual(916_800);
    expect(new Set(totals.slice(0, -1)).size).toBe(1);
    expect(totals.at(-1)!).toBeLessThanOrEqual(totals[0]);
    expect(s.installments.at(-1)!.closingBalanceCents).toBe(0);
    expect(s.installments.reduce((a, i) => a + i.principalCents, 0)).toBe(10_000_000);
  });

  it('zero-rate amortized loan', () => {
    const s = computeLoanSchedule({ ...base, principalCents: 1000, rateBps: 0, method: 'AMORTIZED', installments: 3 });
    expect(s.totalInterestCents).toBe(0);
  });

  it('is deterministic', () => {
    const t = { ...base, principalCents: 987_654, rateBps: 333, method: 'AMORTIZED' as const, installments: 7 };
    expect(computeLoanSchedule(t)).toEqual(computeLoanSchedule(t));
  });

  it('validates terms', () => {
    expect(() => computeLoanSchedule({ ...base, principalCents: 0, rateBps: 100, method: 'FLAT', installments: 1 })).toThrow();
    expect(() => computeLoanSchedule({ ...base, principalCents: 100.5, rateBps: 100, method: 'FLAT', installments: 1 })).toThrow();
    expect(() => computeLoanSchedule({ ...base, principalCents: 100, rateBps: 100, method: 'FLAT', installments: 0 })).toThrow();
  });
});

describe('repayment allocation', () => {
  const inst = [
    { id: 'a', principalDueCents: 1000, interestDueCents: 100, principalPaidCents: 0, interestPaidCents: 0 },
    { id: 'b', principalDueCents: 1000, interestDueCents: 100, principalPaidCents: 0, interestPaidCents: 0 },
  ];
  it('pays interest first, oldest installment first', () => {
    const r = allocateRepayment(inst, 1200);
    expect(r.allocations).toEqual([
      { installmentId: 'a', interestCents: 100, principalCents: 1000 },
      { installmentId: 'b', interestCents: 100, principalCents: 0 },
    ]);
    expect(r.unallocatedCents).toBe(0);
  });
  it('reports overpayment instead of absorbing it', () => {
    expect(allocateRepayment(inst, 3000).unallocatedCents).toBe(800);
  });
});

describe('eligibility', () => {
  const policy = { interestMethod: 'FLAT' as const, rateBps: 1000, maxInstallments: 6, maxMultipleOfSavingsBps: 30000, maxPrincipalCents: 0, requiredApprovals: 2, allowSelfApproval: false };
  it('limits to 3x savings less outstanding loans', () => {
    const r = checkLoanEligibility({ policy, requestedCents: 2_000_000, installments: 3, memberSavingsCents: 500_000, memberOutstandingLoanCents: 0 });
    expect(r.limitCents).toBe(1_500_000);
    expect(r.eligible).toBe(false);
    const ok = checkLoanEligibility({ policy, requestedCents: 1_000_000, installments: 3, memberSavingsCents: 500_000, memberOutstandingLoanCents: 400_000 });
    expect(ok.limitCents).toBe(1_100_000);
    expect(ok.eligible).toBe(true);
  });
});

describe('distribution', () => {
  const members = [
    { memberId: 'm2', contributedCents: 300_000, shares: 3, outstandingLoanCents: 50_000 },
    { memberId: 'm1', contributedCents: 100_000, shares: 1, outstandingLoanCents: 0 },
  ];
  it('excludes liabilities, retained funds and loans from distributable cash', () => {
    const r = computeDistribution({ method: 'EQUAL', availableCashCents: 1_000_000, liabilitiesCents: 100_000, retainedCents: 200_000, offsetOutstandingLoans: false, members });
    expect(r.distributableCents).toBe(700_000);
    expect(r.outstandingLoansCents).toBe(50_000);
    expect(r.allocations.map((a) => a.grossCents)).toEqual([350_000, 350_000]);
  });
  it('proportional with loan offset', () => {
    const r = computeDistribution({ method: 'CONTRIBUTION_PROPORTIONAL', availableCashCents: 400_001, liabilitiesCents: 0, retainedCents: 0, offsetOutstandingLoans: true, members });
    expect(r.allocations.find((a) => a.memberId === 'm2')).toMatchObject({ grossCents: 300_001, loanOffsetCents: 50_000, netPayableCents: 250_001 });
    expect(r.distributedCents).toBe(400_001);
  });
  it('caps requested amount and warns', () => {
    const r = computeDistribution({ method: 'SHARE_BASED', availableCashCents: 100, liabilitiesCents: 200, retainedCents: 0, offsetOutstandingLoans: false, members });
    expect(r.distributableCents).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('rotation', () => {
  it('plans payouts in order', () => {
    const r = planRotation({ startDate: '2026-01-31', frequency: 'MONTHLY', contributionCents: 500_000, order: ['a', 'b', 'c'], recipientContributes: true });
    expect(r.map((x) => x.payoutDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(r[0].expectedCollectionCents).toBe(1_500_000);
    expect(roundShortfall({ expectedCollectionCents: 1_500_000, confirmedCollectionCents: 1_000_000 })).toBe(500_000);
  });
  it('rejects duplicates', () => {
    expect(() => planRotation({ startDate: '2026-01-01', frequency: 'WEEKLY', contributionCents: 1, order: ['a', 'a'], recipientContributes: true })).toThrow();
  });
});
