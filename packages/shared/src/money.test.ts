import { describe, expect, it } from 'vitest';
import { allocateByWeights, applyBps, divRound, formatKes, parseKes, sumCents } from './money';
import { normalizeKenyanPhone } from './phone';
import { addMonths, periodDate } from './dates';

describe('money', () => {
  it('parses KES strings without floating point', () => {
    expect(parseKes('1,500')).toBe(150000);
    expect(parseKes('KES 2,000.5')).toBe(200050);
    expect(parseKes('0.1')).toBe(10);
    expect(parseKes('1234.56')).toBe(123456);
    expect(() => parseKes('12.345')).toThrow();
    expect(() => parseKes('abc')).toThrow();
  });

  it('formats cents', () => {
    expect(formatKes(123456)).toBe('KES 1,234.56');
    expect(formatKes(-5000)).toBe('-KES 50.00');
    expect(formatKes(100000000, { compact: true })).toBe('KES 1,000,000');
  });

  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(applyBps(10050, 1000)).toBe(1005);
    expect(applyBps(15, 5000)).toBe(8);
  });

  it('allocates exactly with largest remainder', () => {
    const parts = allocateByWeights(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(sumCents(parts)).toBe(100);
    expect(allocateByWeights(1000, [1, 2, 7])).toEqual([100, 200, 700]);
    expect(allocateByWeights(10, [0, 0])).toEqual([0, 0]);
  });

  it('rejects non-integer amounts', () => {
    expect(() => sumCents([0.1, 0.2])).toThrow();
  });
});

describe('phone', () => {
  it('normalises Kenyan numbers', () => {
    expect(normalizeKenyanPhone('0712 345 678')).toBe('+254712345678');
    expect(normalizeKenyanPhone('254112345678')).toBe('+254112345678');
    expect(normalizeKenyanPhone('+254-712-345-678')).toBe('+254712345678');
    expect(normalizeKenyanPhone('0812345678')).toBeNull();
  });
});

describe('dates', () => {
  it('clamps month-end anchors', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(periodDate('2026-01-31', 'MONTHLY', 2)).toBe('2026-03-31');
    expect(periodDate('2028-01-31', 'MONTHLY', 1)).toBe('2028-02-29');
    expect(periodDate('2026-01-05', 'WEEKLY', 2)).toBe('2026-01-19');
  });
});
