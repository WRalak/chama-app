import { Frequency } from '../enums';
import { formatDate, IsoDate, periodDate } from '../dates';
import { allocateByWeights, assertCents, Cents, formatKes, MoneyError } from '../money';

/**
 * Merry-go-round engine. Everything here is pure and deterministic, so the
 * API, the admin dashboard and the phone compute identical schedules, and a
 * random draw can be re-verified by anyone who has the published seed.
 */

export const ROTATION_ORDER_METHODS = ['AGREED', 'RANDOM_DRAW', 'CARRY_OVER'] as const;
export type RotationOrderMethod = (typeof ROTATION_ORDER_METHODS)[number];

export const ROTATION_APPROVAL_MODES = ['OFFICERS', 'MEMBER_VOTE'] as const;
export type RotationApprovalMode = (typeof ROTATION_APPROVAL_MODES)[number];

export interface RotationPlanInput {
  startDate: IsoDate;
  frequency: Frequency;
  contributionCents: Cents;
  /** Member ids in payout order (flattened: round 1 slot 1, round 1 slot 2, …). */
  order: string[];
  /** Recipients paid in each round. The member count must be a multiple of it. */
  recipientsPerRound?: number;
  /** Whether a round's recipients also contribute in their own round. */
  recipientContributes: boolean;
  /** Round number of the first planned round (used when re-planning after an amendment). */
  firstRound?: number;
  /** Total members contributing per round; defaults to `order.length`. */
  contributorCount?: number;
}

export interface RotationRound {
  round: number;
  payoutDate: IsoDate;
  recipients: string[];
  expectedCollectionCents: Cents;
  /** Each recipient's share of the expected collection (sums exactly). */
  expectedShares: Cents[];
}

export interface RotationSlot {
  round: number;
  slot: number;
  recipientMemberId: string;
  payoutDate: IsoDate;
  expectedCents: Cents;
}

export class RotationError extends MoneyError {}

function assertUnique(ids: readonly string[], what = 'payout order') {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) throw new RotationError(`The ${what} contains an empty member`);
    if (seen.has(id)) throw new RotationError(`Each member can only appear once in the ${what}`);
    seen.add(id);
  }
}

export function planRotation(input: RotationPlanInput): RotationRound[] {
  assertCents(input.contributionCents);
  if (input.contributionCents <= 0) throw new RotationError('Contribution must be greater than zero');
  const k = input.recipientsPerRound ?? 1;
  if (!Number.isInteger(k) || k < 1) throw new RotationError('Recipients per round must be a whole number of at least 1');
  assertUnique(input.order);
  const firstRound = input.firstRound ?? 1;
  if (firstRound === 1 && input.order.length < 2) throw new RotationError('A rotation needs at least two members');
  if (input.order.length % k !== 0) {
    throw new RotationError(`${input.order.length} members cannot be split evenly into rounds of ${k}. Every round must pay the same number of recipients.`);
  }
  if (firstRound === 1 && input.order.length / k < 2) throw new RotationError('A rotation needs at least two rounds');
  const contributors = input.contributorCount ?? input.order.length;
  const payers = input.recipientContributes ? contributors : contributors - k;
  if (payers <= 0) throw new RotationError('Nobody would contribute to the payout');
  const expected = input.contributionCents * payers;
  assertCents(expected, 'expected collection');
  const shares = allocateByWeights(expected, Array.from({ length: k }, () => 1));
  const rounds: RotationRound[] = [];
  for (let i = 0; i < input.order.length / k; i++) {
    const round = firstRound + i;
    rounds.push({
      round,
      payoutDate: periodDate(input.startDate, input.frequency, round - 1),
      recipients: input.order.slice(i * k, i * k + k),
      expectedCollectionCents: expected,
      expectedShares: shares,
    });
  }
  return rounds;
}

export function flattenRotation(rounds: readonly RotationRound[]): RotationSlot[] {
  return rounds.flatMap((r) =>
    r.recipients.map((m, i) => ({ round: r.round, slot: i + 1, recipientMemberId: m, payoutDate: r.payoutDate, expectedCents: r.expectedShares[i] })),
  );
}

/* ---------- order methods ---------- */

/** cyrb128: a small, well-distributed string hash (public domain). */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32 PRNG returning unsigned 32-bit integers. */
function uint32Stream(seed: string): () => number {
  let [a, b, c, d] = hash128(seed);
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/** Unbiased integer in [0, max) by rejection sampling (no floating point). */
function uniformInt(next: () => number, max: number): number {
  const range = 0x100000000;
  const limit = range - (range % max);
  for (;;) {
    const r = next();
    if (r < limit) return r % max;
  }
}

/**
 * Random draw that anyone can re-run: members are sorted by id, then
 * shuffled (Fisher–Yates) with a PRNG seeded by `seed`. The seed is
 * generated by the server, stored with the cycle and shown to members.
 */
export function drawOrder(memberIds: readonly string[], seed: string): string[] {
  assertUnique(memberIds, 'draw');
  if (!seed || seed.length < 8) throw new RotationError('The draw needs a seed of at least 8 characters');
  const out = [...memberIds].sort();
  const next = uint32Stream(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = uniformInt(next, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Keeps the previous cycle's order for members still taking part; members
 * who were not in it are appended in the order given (e.g. by join date).
 */
export function carryOverOrder(previousOrder: readonly string[], participants: readonly string[]): string[] {
  assertUnique(participants, 'participant list');
  const set = new Set(participants);
  const kept = previousOrder.filter((m) => set.has(m));
  const keptSet = new Set(kept);
  return [...kept, ...participants.filter((m) => !keptSet.has(m))];
}

/* ---------- amendments ---------- */

export const ROTATION_AMENDMENT_KINDS = ['REORDER', 'ADD_MEMBERS', 'REMOVE_MEMBER', 'REPLACE_MEMBER'] as const;
export type RotationAmendmentKind = (typeof ROTATION_AMENDMENT_KINDS)[number];

export type RotationAmendment =
  | { kind: 'REORDER'; order: string[] }
  | { kind: 'ADD_MEMBERS'; memberIds: string[] }
  | { kind: 'REMOVE_MEMBER'; memberId: string }
  | { kind: 'REPLACE_MEMBER'; memberId: string; replacementId: string };

export interface RotationOrderState {
  recipientsPerRound: number;
  /** Recipients of rounds already in payout (approved, processing, paid…), flattened. */
  locked: string[];
  /** Recipients of rounds that can still change, flattened in order. */
  movable: string[];
}

export interface AmendmentResult {
  movable: string[];
  joined: string[];
  left: string[];
}

/**
 * Applies an amendment to the part of the schedule that has not entered
 * payout. Locked rounds never change: a member who has been approved for
 * or received a payout cannot be removed or moved.
 */
export function amendRotationOrder(state: RotationOrderState, change: RotationAmendment): AmendmentResult {
  const k = state.recipientsPerRound;
  const all = [...state.locked, ...state.movable];
  const inSchedule = new Set(all);
  const lockedSet = new Set(state.locked);
  const requireMovable = (id: string) => {
    if (lockedSet.has(id)) throw new RotationError('This member’s payout is already approved or paid, so their position can no longer change. They remain bound by the cycle until it closes.');
    if (!inSchedule.has(id)) throw new RotationError('That member is not in this rotation');
  };
  switch (change.kind) {
    case 'REORDER': {
      assertUnique(change.order);
      if (change.order.length !== state.movable.length || [...change.order].sort().join('|') !== [...state.movable].sort().join('|')) {
        throw new RotationError('The new order must contain exactly the recipients of rounds not yet in payout');
      }
      if (change.order.every((m, i) => m === state.movable[i])) throw new RotationError('The proposed order is the same as the current one');
      return { movable: [...change.order], joined: [], left: [] };
    }
    case 'ADD_MEMBERS': {
      assertUnique(change.memberIds, 'list of new members');
      if (change.memberIds.length === 0 || change.memberIds.length % k !== 0) {
        throw new RotationError(`Add members in groups of ${k} so every round pays the same number of recipients`);
      }
      for (const id of change.memberIds) if (inSchedule.has(id)) throw new RotationError('A member being added is already in this rotation');
      return { movable: [...state.movable, ...change.memberIds], joined: [...change.memberIds], left: [] };
    }
    case 'REMOVE_MEMBER': {
      if (k !== 1) throw new RotationError('With several recipients per round, replace the leaving member instead so rounds stay even');
      requireMovable(change.memberId);
      const movable = state.movable.filter((m) => m !== change.memberId);
      if (state.locked.length + movable.length < 2) throw new RotationError('A rotation needs at least two members; close or cancel it instead');
      return { movable, joined: [], left: [change.memberId] };
    }
    case 'REPLACE_MEMBER': {
      requireMovable(change.memberId);
      if (inSchedule.has(change.replacementId)) throw new RotationError('The replacement is already in this rotation');
      return { movable: state.movable.map((m) => (m === change.memberId ? change.replacementId : m)), joined: [change.replacementId], left: [change.memberId] };
    }
  }
}

/* ---------- payout readiness ---------- */

export const MISSED_CONTRIBUTION_POLICIES = ['PAY_CONFIRMED_WITH_REASON', 'HOLD_UNTIL_COMPLETE'] as const;
export type MissedContributionPolicy = (typeof MISSED_CONTRIBUTION_POLICIES)[number];

export type ReadinessCheckKey = 'TURN' | 'DATE' | 'COLLECTION' | 'RECONCILIATION' | 'DISPUTES' | 'RECIPIENT_LIABILITIES' | 'FUNDS' | 'AMENDMENTS';
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ReadinessCheck {
  key: ReadinessCheckKey;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface PayoutReadinessInput {
  cycleActive: boolean;
  /** The earliest round that has not been fully paid, or null if none. */
  earliestOpenRound: number | null;
  round: number;
  payoutDate: IsoDate;
  today: IsoDate;
  allowEarlyPayout: boolean;
  /** Round totals (all recipients of the round). */
  expectedCents: Cents;
  confirmedCents: Cents;
  /** Already paid out (or in processing) to other recipients of this round. */
  alreadyPaidOutCents: Cents;
  recipientsInRound: number;
  /** 0-based position of this recipient within the round. */
  slotIndex: number;
  missedContributionPolicy: MissedContributionPolicy;
  pendingPaymentCount: number;
  pendingPaymentCents: Cents;
  openDisputes: number;
  recipientLiabilitiesCents: Cents;
  holdWhenRecipientInArrears: boolean;
  /** Ledger cash minus payouts sent but not yet confirmed. */
  availableCashCents: Cents;
  pendingAmendment: boolean;
}

export interface PayoutReadiness {
  ready: boolean;
  /** A shortfall that policy allows only with a recorded reason. */
  needsShortfallReason: boolean;
  shortfallCents: Cents;
  /** What this recipient would be paid now: their share of the confirmed collection. */
  payableCents: Cents;
  checks: ReadinessCheck[];
}

/** This recipient's share of a round's confirmed money (shares sum exactly). */
export function recipientShare(confirmedCents: Cents, recipients: number, slotIndex: number): Cents {
  return allocateByWeights(Math.max(confirmedCents, 0), Array.from({ length: recipients }, () => 1))[slotIndex] ?? 0;
}

export function assessPayoutReadiness(i: PayoutReadinessInput): PayoutReadiness {
  const checks: ReadinessCheck[] = [];
  const add = (key: ReadinessCheckKey, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });

  if (!i.cycleActive) add('TURN', 'Scheduled payout', 'FAIL', 'The rotation is not active (it is awaiting approval, closed or cancelled).');
  else if (i.earliestOpenRound !== null && i.earliestOpenRound < i.round) add('TURN', 'Scheduled payout', 'FAIL', `Round ${i.earliestOpenRound} must be paid first. Rounds are never skipped; propose an amendment instead.`);
  else add('TURN', 'Scheduled payout', 'PASS', `Round ${i.round} is next in the approved schedule.`);

  if (i.payoutDate <= i.today) add('DATE', 'Payout date', 'PASS', `Due on ${formatDate(i.payoutDate)}.`);
  else add('DATE', 'Payout date', i.allowEarlyPayout ? 'WARN' : 'FAIL', i.allowEarlyPayout ? `Scheduled for ${formatDate(i.payoutDate)}; the group allows early payouts.` : `Scheduled for ${formatDate(i.payoutDate)}. The group does not allow early payouts.`);

  const shortfall = Math.max(i.expectedCents - i.confirmedCents, 0);
  let needsReason = false;
  if (i.confirmedCents <= 0) add('COLLECTION', 'Confirmed contributions', 'FAIL', 'No confirmed contributions for this round yet.');
  else if (shortfall === 0) add('COLLECTION', 'Confirmed contributions', 'PASS', `${formatKes(i.confirmedCents)} of ${formatKes(i.expectedCents)} confirmed.`);
  else if (i.missedContributionPolicy === 'HOLD_UNTIL_COMPLETE') add('COLLECTION', 'Confirmed contributions', 'FAIL', `Short by ${formatKes(shortfall)}. Group rules hold the payout until the round is fully collected.`);
  else {
    needsReason = true;
    add('COLLECTION', 'Confirmed contributions', 'WARN', `Short by ${formatKes(shortfall)}. Group rules allow paying the confirmed amount if officers record a reason.`);
  }

  if (i.pendingPaymentCount > 0) add('RECONCILIATION', 'Payments under reconciliation', 'FAIL', `${i.pendingPaymentCount} payment(s) totalling ${formatKes(i.pendingPaymentCents)} are not yet verified. Verify or reject them first; unverified claims are never paid out.`);
  else add('RECONCILIATION', 'Payments under reconciliation', 'PASS', 'No unverified payments for this round.');

  if (i.openDisputes > 0) add('DISPUTES', 'Open discrepancies', 'FAIL', `${i.openDisputes} open dispute(s) affect this round or recipient. Resolve them first.`);
  else add('DISPUTES', 'Open discrepancies', 'PASS', 'No open disputes.');

  if (i.recipientLiabilitiesCents > 0) {
    add('RECIPIENT_LIABILITIES', 'Recipient’s outstanding obligations', i.holdWhenRecipientInArrears ? 'FAIL' : 'WARN', `The recipient owes ${formatKes(i.recipientLiabilitiesCents)} in overdue contributions, fines or loan installments.${i.holdWhenRecipientInArrears ? ' Group rules hold the payout until this is cleared.' : ' Shown for the approvers; no deduction is made automatically.'}`);
  } else add('RECIPIENT_LIABILITIES', 'Recipient’s outstanding obligations', 'PASS', 'Nothing overdue.');

  if (i.pendingAmendment) add('AMENDMENTS', 'Schedule amendments', 'FAIL', 'A schedule amendment is awaiting approval.');
  else add('AMENDMENTS', 'Schedule amendments', 'PASS', 'No pending amendments.');

  const roundPayable = Math.max(i.confirmedCents, 0);
  const share = recipientShare(roundPayable, i.recipientsInRound, i.slotIndex);
  const payable = Math.max(Math.min(share, roundPayable - i.alreadyPaidOutCents), 0);
  if (payable <= 0) add('FUNDS', 'Group funds', 'FAIL', 'Nothing is available to pay this recipient.');
  else if (i.availableCashCents < payable) add('FUNDS', 'Group funds', 'FAIL', `Available cash ${formatKes(i.availableCashCents)} is less than the payout of ${formatKes(payable)}.`);
  else add('FUNDS', 'Group funds', 'PASS', `${formatKes(i.availableCashCents)} available.`);

  return { ready: checks.every((c) => c.status !== 'FAIL'), needsShortfallReason: needsReason, shortfallCents: shortfall, payableCents: payable, checks };
}

/**
 * A round may only be approved for payout when the confirmed collection
 * covers the expected amount, unless officers explicitly approve a
 * shortfall (which is recorded with a reason).
 */
export interface RoundCollectionState {
  expectedCollectionCents: Cents;
  confirmedCollectionCents: Cents;
}

export function roundShortfall(state: RoundCollectionState): Cents {
  return Math.max(state.expectedCollectionCents - state.confirmedCollectionCents, 0);
}
