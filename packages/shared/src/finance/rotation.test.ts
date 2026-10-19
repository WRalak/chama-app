import { describe, expect, it } from 'vitest';
import {
  amendRotationOrder,
  assessPayoutReadiness,
  carryOverOrder,
  drawOrder,
  flattenRotation,
  PayoutReadinessInput,
  planRotation,
  recipientShare,
} from './rotation';

const base = { contributionCents: 100_000, recipientContributes: true } as const;

describe('planRotation dates', () => {
  it('pins month-end anchors: 31 Jan → 28 Feb → 31 Mar in a common year', () => {
    const r = planRotation({ ...base, startDate: '2026-01-31', frequency: 'MONTHLY', order: ['a', 'b', 'c', 'd'] });
    expect(r.map((x) => x.payoutDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('lands on 29 Feb in a leap year and returns to the 30th afterwards', () => {
    const r = planRotation({ ...base, startDate: '2027-12-30', frequency: 'MONTHLY', order: ['a', 'b', 'c', 'd'] });
    expect(r.map((x) => x.payoutDate)).toEqual(['2027-12-30', '2028-01-30', '2028-02-29', '2028-03-30']);
  });

  it('handles a cycle starting on 29 Feb', () => {
    const r = planRotation({ ...base, startDate: '2028-02-29', frequency: 'MONTHLY', order: ['a', 'b', 'c'] });
    expect(r.map((x) => x.payoutDate)).toEqual(['2028-02-29', '2028-03-29', '2028-04-29']);
    const q = planRotation({ ...base, startDate: '2028-02-29', frequency: 'QUARTERLY', order: ['a', 'b', 'c', 'd', 'e'] });
    expect(q.map((x) => x.payoutDate)).toEqual(['2028-02-29', '2028-05-29', '2028-08-29', '2028-11-29', '2029-02-28']);
  });

  it('weekly and bi-weekly cycles cross month, year and leap-day boundaries', () => {
    const w = planRotation({ ...base, startDate: '2028-02-22', frequency: 'WEEKLY', order: ['a', 'b', 'c'] });
    expect(w.map((x) => x.payoutDate)).toEqual(['2028-02-22', '2028-02-29', '2028-03-07']);
    const b = planRotation({ ...base, startDate: '2026-12-24', frequency: 'BIWEEKLY', order: ['a', 'b', 'c'] });
    expect(b.map((x) => x.payoutDate)).toEqual(['2026-12-24', '2027-01-07', '2027-01-21']);
  });

  it('re-plans later rounds from the original start date so dates never drift', () => {
    const full = planRotation({ ...base, startDate: '2026-01-31', frequency: 'MONTHLY', order: ['a', 'b', 'c', 'd'] });
    const tail = planRotation({ ...base, startDate: '2026-01-31', frequency: 'MONTHLY', order: ['c', 'd'], firstRound: 3, contributorCount: 4 });
    expect(tail.map((x) => [x.round, x.payoutDate])).toEqual(full.slice(2).map((x) => [x.round, x.payoutDate]));
  });
});

describe('planRotation amounts and validation', () => {
  it('expected collection depends on whether recipients contribute', () => {
    expect(planRotation({ ...base, startDate: '2026-01-01', frequency: 'WEEKLY', order: ['a', 'b', 'c'] })[0].expectedCollectionCents).toBe(300_000);
    expect(planRotation({ ...base, recipientContributes: false, startDate: '2026-01-01', frequency: 'WEEKLY', order: ['a', 'b', 'c'] })[0].expectedCollectionCents).toBe(200_000);
  });

  it('supports several recipients per round with exact shares', () => {
    const r = planRotation({ contributionCents: 100_001, recipientContributes: true, startDate: '2026-01-01', frequency: 'MONTHLY', order: ['a', 'b', 'c', 'd', 'e', 'f'], recipientsPerRound: 2 });
    expect(r).toHaveLength(3);
    expect(r[0].recipients).toEqual(['a', 'b']);
    expect(r[0].expectedCollectionCents).toBe(600_006);
    expect(r[0].expectedShares).toEqual([300_003, 300_003]);
    const slots = flattenRotation(r);
    expect(slots.map((s) => `${s.round}.${s.slot}:${s.recipientMemberId}`)).toEqual(['1.1:a', '1.2:b', '2.1:c', '2.2:d', '3.1:e', '3.2:f']);
    const odd = planRotation({ contributionCents: 1, recipientContributes: true, startDate: '2026-01-01', frequency: 'MONTHLY', order: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], recipientsPerRound: 3 });
    expect(odd[0].expectedShares.reduce((x, y) => x + y, 0)).toBe(9);
  });

  it('rejects duplicates, uneven rounds, too few members and bad amounts', () => {
    const p = { ...base, startDate: '2026-01-01', frequency: 'WEEKLY' as const };
    expect(() => planRotation({ ...p, order: ['a', 'b', 'a'] })).toThrow(/once/);
    expect(() => planRotation({ ...p, order: ['a'] })).toThrow(/two members/);
    expect(() => planRotation({ ...p, order: ['a', 'b', 'c'], recipientsPerRound: 2 })).toThrow(/evenly/);
    expect(() => planRotation({ ...p, order: ['a', 'b'], recipientsPerRound: 2 })).toThrow(/two rounds/);
    expect(() => planRotation({ ...p, order: ['a', 'b'], contributionCents: 0 })).toThrow();
    expect(() => planRotation({ ...p, order: ['a', 'b'], contributionCents: 10.5 })).toThrow();
    expect(() => planRotation({ ...p, order: ['a', ''] })).toThrow(/empty/);
  });
});

describe('order methods', () => {
  const members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

  it('a random draw is reproducible from its seed and independent of input order', () => {
    const a = drawOrder(members, 'seed-2026-upendo');
    expect(drawOrder([...members].reverse(), 'seed-2026-upendo')).toEqual(a);
    expect([...a].sort()).toEqual([...members].sort());
    expect(drawOrder(members, 'seed-2026-upendx')).not.toEqual(a);
  });

  it('draws are not biased toward any first position', () => {
    const firsts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const f = drawOrder(members, `seed-${i}-xyz`)[0];
      firsts.set(f, (firsts.get(f) ?? 0) + 1);
    }
    for (const m of members) expect(firsts.get(m)!).toBeGreaterThan(400); // expected 500 each
  });

  it('rejects weak seeds and duplicate members in a draw', () => {
    expect(() => drawOrder(members, 'short')).toThrow(/seed/);
    expect(() => drawOrder(['a', 'a'], 'long-enough-seed')).toThrow(/once/);
  });

  it('carry-over keeps the previous order, drops leavers and appends newcomers', () => {
    expect(carryOverOrder(['d', 'a', 'c', 'b'], ['a', 'b', 'c', 'e'])).toEqual(['a', 'c', 'b', 'e']);
    expect(carryOverOrder([], ['x', 'y'])).toEqual(['x', 'y']);
  });
});

describe('amendments', () => {
  const state = { recipientsPerRound: 1, locked: ['a'], movable: ['b', 'c', 'd'] };

  it('reorders only rounds that are not in payout', () => {
    expect(amendRotationOrder(state, { kind: 'REORDER', order: ['c', 'b', 'd'] }).movable).toEqual(['c', 'b', 'd']);
    expect(() => amendRotationOrder(state, { kind: 'REORDER', order: ['a', 'b', 'c'] })).toThrow(/exactly/);
    expect(() => amendRotationOrder(state, { kind: 'REORDER', order: ['b', 'c', 'd'] })).toThrow(/same/);
    expect(() => amendRotationOrder(state, { kind: 'REORDER', order: ['b', 'b', 'd'] })).toThrow(/once/);
  });

  it('removes a member who has not been paid, moving later members up', () => {
    expect(amendRotationOrder(state, { kind: 'REMOVE_MEMBER', memberId: 'c' })).toEqual({ movable: ['b', 'd'], joined: [], left: ['c'] });
  });

  it('never removes or moves a member whose payout is approved or paid', () => {
    expect(() => amendRotationOrder(state, { kind: 'REMOVE_MEMBER', memberId: 'a' })).toThrow(/already approved or paid/);
    expect(() => amendRotationOrder(state, { kind: 'REPLACE_MEMBER', memberId: 'a', replacementId: 'z' })).toThrow(/already approved or paid/);
    expect(() => amendRotationOrder(state, { kind: 'REMOVE_MEMBER', memberId: 'zz' })).toThrow(/not in this rotation/);
  });

  it('keeps at least two members', () => {
    expect(() => amendRotationOrder({ recipientsPerRound: 1, locked: [], movable: ['a', 'b'] }, { kind: 'REMOVE_MEMBER', memberId: 'a' })).toThrow(/two members/);
  });

  it('adds members at the end and rejects duplicates', () => {
    expect(amendRotationOrder(state, { kind: 'ADD_MEMBERS', memberIds: ['e'] }).movable).toEqual(['b', 'c', 'd', 'e']);
    expect(() => amendRotationOrder(state, { kind: 'ADD_MEMBERS', memberIds: ['b'] })).toThrow(/already/);
    expect(() => amendRotationOrder(state, { kind: 'ADD_MEMBERS', memberIds: ['a'] })).toThrow(/already/);
  });

  it('replaces a member in place; multi-recipient rounds stay even', () => {
    expect(amendRotationOrder(state, { kind: 'REPLACE_MEMBER', memberId: 'c', replacementId: 'z' }).movable).toEqual(['b', 'z', 'd']);
    const pairs = { recipientsPerRound: 2, locked: ['a', 'b'], movable: ['c', 'd', 'e', 'f'] };
    expect(() => amendRotationOrder(pairs, { kind: 'REMOVE_MEMBER', memberId: 'c' })).toThrow(/replace/);
    expect(() => amendRotationOrder(pairs, { kind: 'ADD_MEMBERS', memberIds: ['g'] })).toThrow(/groups of 2/);
    expect(amendRotationOrder(pairs, { kind: 'ADD_MEMBERS', memberIds: ['g', 'h'] }).movable).toHaveLength(6);
  });
});

describe('payout readiness', () => {
  const ok: PayoutReadinessInput = {
    cycleActive: true,
    earliestOpenRound: 2,
    round: 2,
    payoutDate: '2026-03-01',
    today: '2026-03-01',
    allowEarlyPayout: false,
    expectedCents: 500_000,
    confirmedCents: 500_000,
    alreadyPaidOutCents: 0,
    recipientsInRound: 1,
    slotIndex: 0,
    missedContributionPolicy: 'PAY_CONFIRMED_WITH_REASON',
    pendingPaymentCount: 0,
    pendingPaymentCents: 0,
    openDisputes: 0,
    recipientLiabilitiesCents: 0,
    holdWhenRecipientInArrears: false,
    availableCashCents: 900_000,
    pendingAmendment: false,
  };
  const status = (r: ReturnType<typeof assessPayoutReadiness>, key: string) => r.checks.find((c) => c.key === key)!.status;

  it('is ready when every condition holds', () => {
    const r = assessPayoutReadiness(ok);
    expect(r).toMatchObject({ ready: true, payableCents: 500_000, shortfallCents: 0, needsShortfallReason: false });
  });

  it('never skips a round and never pays an inactive cycle', () => {
    expect(status(assessPayoutReadiness({ ...ok, earliestOpenRound: 1 }), 'TURN')).toBe('FAIL');
    expect(assessPayoutReadiness({ ...ok, cycleActive: false }).ready).toBe(false);
  });

  it('blocks early payouts unless the group allows them', () => {
    expect(assessPayoutReadiness({ ...ok, today: '2026-02-28' }).ready).toBe(false);
    const early = assessPayoutReadiness({ ...ok, today: '2026-02-28', allowEarlyPayout: true });
    expect(early.ready).toBe(true);
    expect(status(early, 'DATE')).toBe('WARN');
  });

  it('applies the missed-contribution policy', () => {
    const short = { ...ok, confirmedCents: 400_000 };
    const pay = assessPayoutReadiness(short);
    expect(pay).toMatchObject({ ready: true, needsShortfallReason: true, shortfallCents: 100_000, payableCents: 400_000 });
    expect(assessPayoutReadiness({ ...short, missedContributionPolicy: 'HOLD_UNTIL_COMPLETE' }).ready).toBe(false);
    expect(assessPayoutReadiness({ ...ok, confirmedCents: 0 }).ready).toBe(false);
  });

  it('never pays out on unverified payments or open disputes', () => {
    expect(status(assessPayoutReadiness({ ...ok, pendingPaymentCount: 1, pendingPaymentCents: 100_000 }), 'RECONCILIATION')).toBe('FAIL');
    expect(assessPayoutReadiness({ ...ok, openDisputes: 1 }).ready).toBe(false);
    expect(assessPayoutReadiness({ ...ok, pendingAmendment: true }).ready).toBe(false);
  });

  it('flags recipient arrears, holding the payout only if the group says so', () => {
    expect(status(assessPayoutReadiness({ ...ok, recipientLiabilitiesCents: 20_000 }), 'RECIPIENT_LIABILITIES')).toBe('WARN');
    expect(assessPayoutReadiness({ ...ok, recipientLiabilitiesCents: 20_000, holdWhenRecipientInArrears: true }).ready).toBe(false);
  });

  it('checks available funds', () => {
    expect(status(assessPayoutReadiness({ ...ok, availableCashCents: 499_999 }), 'FUNDS')).toBe('FAIL');
  });

  it('splits multi-recipient rounds exactly and never overpays the round', () => {
    expect([0, 1, 2].map((s) => recipientShare(100, 3, s))).toEqual([34, 33, 33]);
    const pair = { ...ok, recipientsInRound: 2, expectedCents: 1_000_000, confirmedCents: 1_000_000 };
    expect(assessPayoutReadiness({ ...pair, slotIndex: 0 }).payableCents).toBe(500_000);
    expect(assessPayoutReadiness({ ...pair, slotIndex: 1, alreadyPaidOutCents: 500_000 }).payableCents).toBe(500_000);
    expect(assessPayoutReadiness({ ...pair, slotIndex: 1, alreadyPaidOutCents: 900_000 }).payableCents).toBe(100_000);
  });
});
