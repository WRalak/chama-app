import { Frequency, InterestMethod } from '../enums';
import { IsoDate, periodDate } from '../dates';
import { allocateByWeights, applyBps, assertCents, Cents, MoneyError } from '../money';

export interface LoanTerms {
  principalCents: Cents;
  /** Interest rate in basis points per repayment period (ONE_OFF: total). 1000 = 10%. */
  rateBps: number;
  method: InterestMethod;
  installments: number;
  frequency: Frequency;
  /** Date of the first installment. */
  firstDueDate: IsoDate;
}

export interface ScheduledInstallment {
  number: number;
  dueDate: IsoDate;
  openingBalanceCents: Cents;
  principalCents: Cents;
  interestCents: Cents;
  totalCents: Cents;
  closingBalanceCents: Cents;
}

export interface LoanSchedule {
  method: InterestMethod;
  principalCents: Cents;
  totalInterestCents: Cents;
  totalRepayableCents: Cents;
  installments: ScheduledInstallment[];
}

export const MAX_LOAN_INSTALLMENTS = 120;

function validate(terms: LoanTerms) {
  assertCents(terms.principalCents, 'principal');
  if (terms.principalCents <= 0) throw new MoneyError('Principal must be greater than zero');
  if (!Number.isInteger(terms.rateBps) || terms.rateBps < 0 || terms.rateBps > 100000) {
    throw new MoneyError('Rate must be between 0 and 1000% (0–100000 bps)');
  }
  if (!Number.isInteger(terms.installments) || terms.installments < 1 || terms.installments > MAX_LOAN_INSTALLMENTS) {
    throw new MoneyError(`Installments must be between 1 and ${MAX_LOAN_INSTALLMENTS}`);
  }
}

function build(
  terms: LoanTerms,
  principalParts: Cents[],
  interestFor: (index: number, openingBalance: Cents) => Cents,
): LoanSchedule {
  let balance = terms.principalCents;
  const installments: ScheduledInstallment[] = principalParts.map((principal, i) => {
    const opening = balance;
    const interest = interestFor(i, opening);
    balance = opening - principal;
    return {
      number: i + 1,
      dueDate: periodDate(terms.firstDueDate, terms.frequency, i),
      openingBalanceCents: opening,
      principalCents: principal,
      interestCents: interest,
      totalCents: principal + interest,
      closingBalanceCents: balance,
    };
  });
  const totalInterestCents = installments.reduce((a, b) => a + b.interestCents, 0);
  return {
    method: terms.method,
    principalCents: terms.principalCents,
    totalInterestCents,
    totalRepayableCents: terms.principalCents + totalInterestCents,
    installments,
  };
}

/** Simulates an annuity with integer interest; returns the final balance. */
function amortizedResidual(principal: Cents, rateBps: number, n: number, payment: Cents): number {
  let balance = principal;
  for (let i = 0; i < n; i++) {
    const interest = applyBps(balance, rateBps);
    balance = balance + interest - payment;
  }
  return balance;
}

/**
 * Smallest whole-cent installment that clears the loan within `n` periods.
 * Found by integer binary search so the result is identical on every
 * platform (no Math.pow).
 */
function amortizedPayment(principal: Cents, rateBps: number, n: number): Cents {
  let lo = Math.ceil(principal / n);
  let hi = lo;
  while (amortizedResidual(principal, rateBps, n, hi) > 0) hi *= 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (amortizedResidual(principal, rateBps, n, mid) > 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function computeLoanSchedule(terms: LoanTerms): LoanSchedule {
  validate(terms);
  const { principalCents: P, rateBps: r, installments: n } = terms;
  const equalPrincipal = allocateByWeights(P, Array(n).fill(1));

  switch (terms.method) {
    case 'FLAT': {
      const totalInterest = applyBps(P, r * n);
      const interestParts = allocateByWeights(totalInterest, Array(n).fill(1));
      return build(terms, equalPrincipal, (i) => interestParts[i]);
    }
    case 'ONE_OFF': {
      const totalInterest = applyBps(P, r);
      const interestParts = allocateByWeights(totalInterest, Array(n).fill(1));
      return build(terms, equalPrincipal, (i) => interestParts[i]);
    }
    case 'REDUCING_BALANCE':
      return build(terms, equalPrincipal, (_i, opening) => applyBps(opening, r));
    case 'AMORTIZED': {
      if (r === 0) return build(terms, equalPrincipal, () => 0);
      const payment = amortizedPayment(P, r, n);
      // Derive principal parts by walking the balance; the final
      // installment clears whatever remains so the loan closes exactly.
      const principalParts: Cents[] = [];
      let balance = P;
      for (let i = 0; i < n; i++) {
        const interest = applyBps(balance, r);
        const principal = i === n - 1 ? balance : Math.min(balance, payment - interest);
        principalParts.push(principal);
        balance -= principal;
      }
      return build(terms, principalParts, (_i, opening) => applyBps(opening, r));
    }
  }
}

export interface InstallmentBalance {
  id: string;
  principalDueCents: Cents;
  interestDueCents: Cents;
  principalPaidCents: Cents;
  interestPaidCents: Cents;
}

export interface RepaymentAllocation {
  installmentId: string;
  interestCents: Cents;
  principalCents: Cents;
}

/**
 * Allocates a repayment to installments oldest-first, interest before
 * principal within each installment. Anything left over is returned as
 * `unallocatedCents` so the caller can reject or hold it as a credit —
 * it is never silently absorbed.
 */
export function allocateRepayment(
  installments: readonly InstallmentBalance[],
  amountCents: Cents,
): { allocations: RepaymentAllocation[]; unallocatedCents: Cents } {
  assertCents(amountCents);
  if (amountCents <= 0) throw new MoneyError('Repayment must be greater than zero');
  let remaining = amountCents;
  const allocations: RepaymentAllocation[] = [];
  for (const inst of installments) {
    if (remaining === 0) break;
    const interestOwed = inst.interestDueCents - inst.interestPaidCents;
    const principalOwed = inst.principalDueCents - inst.principalPaidCents;
    const interest = Math.min(Math.max(interestOwed, 0), remaining);
    remaining -= interest;
    const principal = Math.min(Math.max(principalOwed, 0), remaining);
    remaining -= principal;
    if (interest > 0 || principal > 0) {
      allocations.push({ installmentId: inst.id, interestCents: interest, principalCents: principal });
    }
  }
  return { allocations, unallocatedCents: remaining };
}

export interface LoanPolicy {
  interestMethod: InterestMethod;
  rateBps: number;
  maxInstallments: number;
  /** Maximum loan as a multiple of the member's confirmed savings, in bps (30000 = 3×). 0 = no limit. */
  maxMultipleOfSavingsBps: number;
  maxPrincipalCents: Cents;
  requiredApprovals: number;
  allowSelfApproval: boolean;
}

export interface EligibilityInput {
  policy: LoanPolicy;
  requestedCents: Cents;
  installments: number;
  memberSavingsCents: Cents;
  memberOutstandingLoanCents: Cents;
}

export function checkLoanEligibility(input: EligibilityInput): { eligible: boolean; reasons: string[]; limitCents: Cents | null } {
  const reasons: string[] = [];
  const { policy } = input;
  let limit: Cents | null = null;
  if (policy.maxMultipleOfSavingsBps > 0) {
    limit = applyBps(input.memberSavingsCents, policy.maxMultipleOfSavingsBps) - input.memberOutstandingLoanCents;
  }
  if (policy.maxPrincipalCents > 0) {
    limit = limit === null ? policy.maxPrincipalCents : Math.min(limit, policy.maxPrincipalCents);
  }
  if (limit !== null && input.requestedCents > limit) {
    reasons.push(`Requested amount exceeds the current limit for this member`);
  }
  if (input.installments > policy.maxInstallments) {
    reasons.push(`Maximum repayment period is ${policy.maxInstallments} installments`);
  }
  if (input.requestedCents <= 0) reasons.push('Amount must be greater than zero');
  return { eligible: reasons.length === 0, reasons, limitCents: limit === null ? null : Math.max(limit, 0) };
}
