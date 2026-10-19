import { DistributionMethod } from '../enums';
import { allocateByWeights, assertCents, Cents, MoneyError } from '../money';

export interface DistributionMemberInput {
  memberId: string;
  name?: string;
  /** Confirmed contributions in the distribution period. */
  contributedCents: Cents;
  /** Whole shares held (for SHARE_BASED). */
  shares: number;
  /** Outstanding loan balance; can be offset against the member's allocation. */
  outstandingLoanCents: Cents;
}

export interface DistributionInput {
  method: DistributionMethod;
  /** Confirmed cash at bank / M-Pesa / hand per the ledger. */
  availableCashCents: Cents;
  /** Money the group owes (unpaid approved expenses, payables). */
  liabilitiesCents: Cents;
  /** Amount the group resolved to keep (reserve, welfare fund). */
  retainedCents: Cents;
  /**
   * Optional cap: distribute at most this amount (e.g. only profits). When
   * omitted the full distributable amount is used.
   */
  amountToDistributeCents?: Cents;
  offsetOutstandingLoans: boolean;
  members: DistributionMemberInput[];
}

export interface DistributionAllocation {
  memberId: string;
  name?: string;
  weight: number;
  grossCents: Cents;
  loanOffsetCents: Cents;
  netPayableCents: Cents;
}

export interface DistributionResult {
  method: DistributionMethod;
  availableCashCents: Cents;
  outstandingLoansCents: Cents;
  liabilitiesCents: Cents;
  retainedCents: Cents;
  /** Cash − liabilities − retained. Outstanding loans are NOT cash and are never distributable. */
  distributableCents: Cents;
  distributedCents: Cents;
  allocations: DistributionAllocation[];
  warnings: string[];
}

export function computeDistribution(input: DistributionInput): DistributionResult {
  [input.availableCashCents, input.liabilitiesCents, input.retainedCents].forEach((v) => assertCents(v));
  if (input.members.length === 0) throw new MoneyError('A distribution needs at least one member');
  const warnings: string[] = [];
  const outstandingLoansCents = input.members.reduce((a, m) => a + assertCents(m.outstandingLoanCents), 0);
  const distributableCents = Math.max(input.availableCashCents - input.liabilitiesCents - input.retainedCents, 0);
  if (input.availableCashCents - input.liabilitiesCents - input.retainedCents < 0) {
    warnings.push('Liabilities and retained funds exceed available cash; nothing is distributable.');
  }
  let toDistribute = distributableCents;
  if (input.amountToDistributeCents !== undefined) {
    assertCents(input.amountToDistributeCents);
    if (input.amountToDistributeCents > distributableCents) {
      warnings.push('Requested amount exceeds the distributable amount and was capped.');
    }
    toDistribute = Math.min(input.amountToDistributeCents, distributableCents);
  }

  // Stable order makes remainder allocation reproducible.
  const members = [...input.members].sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  const weights = members.map((m) => {
    switch (input.method) {
      case 'EQUAL':
        return 1;
      case 'CONTRIBUTION_PROPORTIONAL':
        return Math.max(assertCents(m.contributedCents), 0);
      case 'SHARE_BASED':
        if (!Number.isInteger(m.shares) || m.shares < 0) throw new MoneyError('Shares must be whole numbers');
        return m.shares;
    }
  });
  if (weights.every((w) => w === 0)) {
    warnings.push('No member has a positive weight for this method; nothing was allocated.');
  }
  const gross = allocateByWeights(toDistribute, weights);
  const allocations = members.map((m, i) => {
    const loanOffsetCents = input.offsetOutstandingLoans ? Math.min(m.outstandingLoanCents, gross[i]) : 0;
    return {
      memberId: m.memberId,
      name: m.name,
      weight: weights[i],
      grossCents: gross[i],
      loanOffsetCents,
      netPayableCents: gross[i] - loanOffsetCents,
    };
  });
  return {
    method: input.method,
    availableCashCents: input.availableCashCents,
    outstandingLoansCents,
    liabilitiesCents: input.liabilitiesCents,
    retainedCents: input.retainedCents,
    distributableCents,
    distributedCents: gross.reduce((a, b) => a + b, 0),
    allocations,
    warnings,
  };
}
