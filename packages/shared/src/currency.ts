/**
 * Currencies and exact conversion.
 *
 * Every amount in ChamaHub is an integer number of the currency's minor unit
 * (cents for KES, whole shillings for UGX, fils for KWD). An amount is never
 * meaningful without its currency, and amounts in different currencies are
 * never added together. The only way to compare them is `convertMinor`,
 * which needs an explicit, dated exchange rate and reports what it used.
 */
import { MoneyError } from './money';

export interface CurrencyInfo {
  code: string;
  name: string;
  /** Digits after the decimal point (ISO 4217 minor units). */
  minorUnits: 0 | 2 | 3;
  /** Shown before the amount. */
  symbol: string;
}

/** Currencies ChamaHub can hold. Add a row here (and a region) to support another. */
export const CURRENCIES: Record<string, CurrencyInfo> = {
  KES: { code: 'KES', name: 'Kenyan shilling', minorUnits: 2, symbol: 'KSh' },
  UGX: { code: 'UGX', name: 'Ugandan shilling', minorUnits: 0, symbol: 'USh' },
  TZS: { code: 'TZS', name: 'Tanzanian shilling', minorUnits: 2, symbol: 'TSh' },
  RWF: { code: 'RWF', name: 'Rwandan franc', minorUnits: 0, symbol: 'FRw' },
  ZAR: { code: 'ZAR', name: 'South African rand', minorUnits: 2, symbol: 'R' },
  NGN: { code: 'NGN', name: 'Nigerian naira', minorUnits: 2, symbol: '₦' },
  GHS: { code: 'GHS', name: 'Ghanaian cedi', minorUnits: 2, symbol: 'GH₵' },
  USD: { code: 'USD', name: 'US dollar', minorUnits: 2, symbol: 'US$' },
  GBP: { code: 'GBP', name: 'Pound sterling', minorUnits: 2, symbol: '£' },
  EUR: { code: 'EUR', name: 'Euro', minorUnits: 2, symbol: '€' },
  KWD: { code: 'KWD', name: 'Kuwaiti dinar', minorUnits: 3, symbol: 'KD' },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [string, ...string[]];

/**
 * Currencies every part of ChamaHub can present correctly today (notifications, PDFs, AI answers,
 * personal cross-group totals). Groups can only be created in these, and a region whose currency
 * is not listed cannot be opened. Extend once backend-generated texts use the group's currency.
 */
export const LAUNCH_READY_CURRENCIES: readonly string[] = ['KES'];

export function currencyInfo(code: string): CurrencyInfo {
  const c = CURRENCIES[code];
  if (!c) throw new MoneyError(`Unsupported currency ${code}`);
  return c;
}

function assertMinor(value: number, label = 'amount') {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${label} must be a whole number of minor units (got ${value})`);
  return value;
}

/** "1,234.50" style digits for an amount in minor units. */
function digits(minor: number, minorUnits: number, compact: boolean) {
  const abs = Math.abs(minor);
  const factor = 10 ** minorUnits;
  const whole = Math.floor(abs / factor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (minorUnits === 0) return whole;
  const frac = (abs % factor).toString().padStart(minorUnits, '0');
  return compact && /^0+$/.test(frac) ? whole : `${whole}.${frac}`;
}

/**
 * Formats minor units with the currency's symbol: formatMoney(123450, 'KES') → "KSh 1,234.50",
 * formatMoney(5000, 'UGX') → "USh 5,000". `code: true` shows the ISO code instead ("KES 1,234.50").
 */
export function formatMoney(minor: number, currency: string, opts: { compact?: boolean; code?: boolean; withCurrency?: boolean } = {}): string {
  assertMinor(minor);
  const c = currencyInfo(currency);
  const body = digits(minor, c.minorUnits, !!opts.compact);
  const label = opts.withCurrency === false ? '' : `${opts.code ? c.code : c.symbol} `;
  return `${minor < 0 ? '-' : ''}${label}${body}`;
}

/**
 * Parses a user-entered amount ("1,500", "1500.5", "KSh 2,000.00") in the given currency into
 * minor units without floating point. Rejects more decimals than the currency has.
 */
export function parseMoney(input: string | number, currency: string): number {
  const c = currencyInfo(currency);
  const symbols = [c.code, c.symbol, ...(c.code === 'KES' ? ['KSH', 'Ksh'] : [])].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const raw = String(input).replace(new RegExp(symbols.join('|'), 'gi'), '').replace(/,|\s/g, '');
  const re = c.minorUnits === 0 ? /^(-)?(\d+)$/ : new RegExp(`^(-)?(\\d+)(?:\\.(\\d{1,${c.minorUnits}}))?$`);
  const m = re.exec(raw);
  if (!m) throw new MoneyError(`"${input}" is not a valid amount in ${c.code}${c.minorUnits === 0 ? ' (whole units only)' : ''}`);
  const [, sign, whole, frac = ''] = m;
  const minor = Number(whole) * 10 ** c.minorUnits + (c.minorUnits ? Number(frac.padEnd(c.minorUnits, '0')) : 0);
  return assertMinor(sign ? -minor : minor);
}

/** Plain decimal string for exports ("1234.50", "5000", "1.250"). */
export function minorToDecimalString(minor: number, currency: string): string {
  assertMinor(minor);
  const c = currencyInfo(currency);
  const body = digits(minor, c.minorUnits, false).replace(/,/g, '');
  return `${minor < 0 ? '-' : ''}${body}`;
}

/** A decimal rate as an exact fraction: "129.4512" → 1294512 / 10000. */
function rateFraction(rate: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(rate.trim());
  if (!m) throw new MoneyError(`Invalid exchange rate "${rate}"`);
  const frac = m[2] ?? '';
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw new MoneyError('Exchange rate must be greater than zero');
  return { num, den: 10n ** BigInt(frac.length) };
}

function divRoundBig(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const rounded = r * 2n >= ad ? q + 1n : q;
  return neg ? -rounded : rounded;
}

export interface Conversion {
  amountMinor: number;
  from: string;
  to: string;
  /** 1 unit of `from` = `rate` units of `to`, exactly as recorded. */
  rate: string;
  asOf: string;
}

/**
 * Converts minor units of `from` into minor units of `to` with an explicit rate
 * (1 `from` = `rate` `to`), dated `asOf`. Exact rational arithmetic, rounded once
 * at the end, half away from zero. Same-currency conversion needs no rate.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rate: string | null, asOf: string | null): Conversion {
  assertMinor(amountMinor);
  if (from === to) return { amountMinor, from, to, rate: '1', asOf: asOf ?? '' };
  if (!rate || !asOf) throw new MoneyError(`No exchange rate recorded for ${from}→${to}; amounts in different currencies cannot be combined`);
  const f = currencyInfo(from);
  const t = currencyInfo(to);
  const { num, den } = rateFraction(rate);
  // minor_to = minor_from / 10^fu * rate * 10^tu
  const n = BigInt(amountMinor) * num * 10n ** BigInt(t.minorUnits);
  const d = den * 10n ** BigInt(f.minorUnits);
  return { amountMinor: assertMinor(Number(divRoundBig(n, d)), 'converted amount'), from, to, rate, asOf };
}

/** Sums amounts per currency. Never adds across currencies. */
export function totalsByCurrency(items: readonly { currency: string; amountMinor: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.currency] = assertMinor((out[i.currency] ?? 0) + assertMinor(i.amountMinor));
  return out;
}

/**
 * Converts with a rate recorded the other way round: 1 `to` = `rate` `from`.
 * Exact (no rounded inverse rate), rounded once at the end.
 */
export function convertMinorInverse(amountMinor: number, from: string, to: string, rate: string, asOf: string): Conversion {
  assertMinor(amountMinor);
  const f = currencyInfo(from);
  const tt = currencyInfo(to);
  const { num, den } = rateFraction(rate);
  // minor_to = minor_from / 10^fu / rate * 10^tu
  const n = BigInt(amountMinor) * den * 10n ** BigInt(tt.minorUnits);
  const d = num * 10n ** BigInt(f.minorUnits);
  return { amountMinor: assertMinor(Number(divRoundBig(n, d)), 'converted amount'), from, to, rate: `1/${rate}`, asOf };
}
