import { Frequency } from '../enums';
import { IsoDate, periodDate } from '../dates';
import { assertCents, Cents, MoneyError } from '../money';

export interface RotationPlanInput {
  startDate: IsoDate;
  frequency: Frequency;
  contributionCents: Cents;
  /** Member ids in payout order. */
  order: string[];
  /** Whether the round's recipient also contributes in their own round. */
  recipientContributes: boolean;
}

export interface RotationRound {
  round: number;
  recipientMemberId: string;
  payoutDate: IsoDate;
  expectedCollectionCents: Cents;
}

export function planRotation(input: RotationPlanInput): RotationRound[] {
  assertCents(input.contributionCents);
  if (input.contributionCents <= 0) throw new MoneyError('Contribution must be greater than zero');
  if (input.order.length < 2) throw new MoneyError('A rotation needs at least two members');
  if (new Set(input.order).size !== input.order.length) {
    throw new MoneyError('Each member can only appear once in the payout order');
  }
  const contributors = input.recipientContributes ? input.order.length : input.order.length - 1;
  return input.order.map((memberId, i) => ({
    round: i + 1,
    recipientMemberId: memberId,
    payoutDate: periodDate(input.startDate, input.frequency, i),
    expectedCollectionCents: input.contributionCents * contributors,
  }));
}

export interface RoundCollectionState {
  expectedCollectionCents: Cents;
  confirmedCollectionCents: Cents;
}

/**
 * A round may only be approved for payout when the confirmed collection
 * covers the expected amount, unless officers explicitly approve a
 * shortfall (which is recorded with a reason).
 */
export function roundShortfall(state: RoundCollectionState): Cents {
  return Math.max(state.expectedCollectionCents - state.confirmedCollectionCents, 0);
}
