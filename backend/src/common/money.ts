import { assertCents } from '@chamahub/shared';

/** BigInt DB value → API number of cents (safe up to ~90 trillion KES). */
export function n(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  return assertCents(num, 'database amount');
}

export function big(cents: number): bigint {
  return BigInt(assertCents(cents));
}
