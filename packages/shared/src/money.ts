/**
 * Money helpers. All monetary values in ChamaHub are integer Kenyan Shilling
 * cents (1 KES = 100 cents). Floating point is never used to hold money; the
 * only place fractional numbers appear is in rates, and every result derived
 * from a rate is rounded back to whole cents with a documented rounding rule.
 */

export type Cents = number;

export const CURRENCY = 'KES' as const;

export class MoneyError extends Error {}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of cents (got ${value})`);
  }
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    total += assertCents(v);
  }
  return assertCents(total, 'sum');
}

/**
 * Parses a user-entered KES amount ("1,500", "1500.5", "KES 2,000.00") into
 * cents without going through floating point.
 */
export function parseKes(input: string | number): Cents {
  const raw = String(input).replace(/KES|KSH|Ksh|,|\s/gi, '');
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new MoneyError(`"${input}" is not a valid amount in KSh`);
  }
  const [, sign, whole, frac = ''] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return assertCents(sign ? -cents : cents);
}

/** Formats cents as "KSh 1,234.50" (the Kenyan convention). `compact` drops ".00". */
export function formatKes(cents: Cents, opts: { compact?: boolean; withCurrency?: boolean } = {}): string {
  assertCents(cents);
  const { compact = false, withCurrency = true } = opts;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = compact && frac === 0 ? wholeStr : `${wholeStr}.${frac.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${withCurrency ? 'KSh ' : ''}${body}`;
}

/** Converts cents to a plain decimal string ("1234.50") for CSV exports. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}

/**
 * Integer division rounding half away from zero. Used for every
 * rate-derived amount so calculations are reproducible.
 */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new MoneyError('divRound requires safe integers and a non-zero denominator');
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** Applies a rate expressed in basis points (1% = 100 bps) to an amount. */
export function applyBps(cents: Cents, bps: number): Cents {
  assertCents(cents);
  if (!Number.isSafeInteger(bps)) throw new MoneyError('bps must be an integer');
  // Use BigInt for the intermediate product so very large balances cannot
  // overflow the safe integer range.
  const product = BigInt(cents) * BigInt(bps);
  const q = product / 10000n;
  const r = product % 10000n;
  const abs = r < 0n ? -r : r;
  const rounded = abs * 2n >= 10000n ? q + (product < 0n ? -1n : 1n) : q;
  return assertCents(Number(rounded));
}

/**
 * Splits `total` across `weights` so the parts sum exactly to `total`
 * (largest-remainder method). Ties are broken by the order of `weights`,
 * which callers must make deterministic (e.g. sort by member id).
 */
export function allocateByWeights(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, 'total');
  if (weights.length === 0) return [];
  weights.forEach((w) => {
    if (!Number.isSafeInteger(w) || w < 0) throw new MoneyError('weights must be non-negative integers');
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return weights.map(() => 0);
  const bigTotal = BigInt(total);
  const bigSum = BigInt(weightSum);
  const base = weights.map((w) => (bigTotal * BigInt(w)) / bigSum);
  const remainders = weights.map((w, i) => ({ i, r: (bigTotal * BigInt(w)) % bigSum }));
  let leftover = Number(bigTotal - base.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const result = base.map(Number);
  for (let k = 0; leftover > 0; k = (k + 1) % remainders.length, leftover--) {
    result[remainders[k].i] += 1;
  }
  return result;
}
