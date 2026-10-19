import { formatDate, formatKes, todayInNairobi } from '@chamahub/shared';

export const kes = (c: number | null | undefined, compact = false) => (c === null || c === undefined ? '—' : formatKes(c, { compact }));
export const date = (iso: string | null | undefined) => (iso ? formatDate(iso.length > 10 ? new Date(new Date(iso).getTime() + 3 * 3600_000) : iso) : '—');

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${formatDate(d)}, ${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Tomorrow", "In 5 days", "3 days ago". */
export function relativeDay(iso: string) {
  const t = Date.parse(`${todayInNairobi()}T00:00:00Z`);
  const d = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((d - t) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

export function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}
