import { Frequency } from './enums';

/**
 * Calendar-date helpers. Due dates are calendar dates ("2026-03-05") with
 * no time component. Arithmetic is done in UTC so results never shift with
 * the device timezone. Kenya (Africa/Nairobi) is UTC+3 with no DST.
 */

export type IsoDate = string; // YYYY-MM-DD

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "5 Mar 2026" — formatted without Intl so it is identical on every device. */
export function formatDate(iso: IsoDate | Date): string {
  const d = typeof iso === 'string' ? toDate(iso.slice(0, 10)) : iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toDate(iso: IsoDate): Date {
  if (!isIsoDate(iso)) throw new Error(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00Z`);
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in Nairobi. */
export function todayInNairobi(now: Date = new Date()): IsoDate {
  return toIsoDate(new Date(now.getTime() + 3 * 60 * 60 * 1000));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Adds calendar months, pinning to `anchorDay` (clamped to month length) so
 * a schedule anchored on the 31st lands on Feb 28/29, then Mar 31.
 */
export function addMonths(iso: IsoDate, months: number, anchorDay?: number): IsoDate {
  const d = toDate(iso);
  const day = anchorDay ?? d.getUTCDate();
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const clamped = Math.min(day, daysInMonth(year, month));
  return toIsoDate(new Date(Date.UTC(year, month, clamped)));
}

/** Returns the date of the n-th period (0-based) after `start`. */
export function periodDate(start: IsoDate, frequency: Frequency, index: number): IsoDate {
  const anchor = toDate(start).getUTCDate();
  switch (frequency) {
    case 'WEEKLY':
      return addDays(start, 7 * index);
    case 'BIWEEKLY':
      return addDays(start, 14 * index);
    case 'MONTHLY':
      return addMonths(start, index, anchor);
    case 'QUARTERLY':
      return addMonths(start, 3 * index, anchor);
  }
}

/** Generates `count` period dates beginning at `start` (inclusive). */
export function generatePeriodDates(start: IsoDate, frequency: Frequency, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => periodDate(start, frequency, i));
}

/** All period dates from `start` that fall on or before `until`. */
export function periodDatesUntil(start: IsoDate, frequency: Frequency, until: IsoDate, max = 1000): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let i = 0; i < max; i++) {
    const d = periodDate(start, frequency, i);
    if (d > until) break;
    dates.push(d);
  }
  return dates;
}

/** Human label for a contribution period, e.g. "Mar 2026" or "Week of 2 Mar 2026". */
export function periodLabel(iso: IsoDate, frequency: Frequency): string {
  const d = toDate(iso);
  const month = MONTHS[d.getUTCMonth()];
  if (frequency === 'MONTHLY') return `${month} ${d.getUTCFullYear()}`;
  if (frequency === 'QUARTERLY') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return `Week of ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
