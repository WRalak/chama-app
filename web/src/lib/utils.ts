import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDate, formatMoney } from '@chamahub/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The currency amounts on the current page are in. Group pages set it to the group's base
 * currency (see RouteGuard); pages outside a group use KES, the only launch currency so far.
 */
let displayCurrency = 'KES';
export function setDisplayCurrency(code: string) {
  displayCurrency = code;
}
export const currentCurrency = () => displayCurrency;

/** Formats minor units in the page's currency ("KSh 1,234.50"). Named `kes` for history; it follows the group's currency. */
export const kes = (cents: number | null | undefined, compact = false) => (cents === null || cents === undefined ? '—' : formatMoney(cents, displayCurrency, { compact }));
/** Formats an amount whose currency is known explicitly (billing, revenue). */
export const money = (minor: number | null | undefined, currency: string, compact = false) => (minor === null || minor === undefined ? '—' : formatMoney(minor, currency, { compact }));
export const date = (iso: string | null | undefined) => (iso ? formatDate(iso.length > 10 ? new Date(new Date(iso).getTime() + 3 * 3600_000) : iso) : '—');
export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${formatDate(new Date(d.getTime() + 3 * 3600_000))}, ${d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}`;
};

export function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Client-side CSV for tables already on screen (server exports are used for full ledgers). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
