import type { ConsolidatedAmount, MoneyByCurrency } from '@chamahub/shared';
import { money } from '@/lib/utils';

/** Amounts in their own currencies, one per line. Never added across currencies. */
export function MoneyList({ items, empty = '—' }: { items: MoneyByCurrency[]; empty?: string }) {
  if (!items.length) return <span className="text-muted">{empty}</span>;
  return (
    <span className="inline-flex flex-col items-end tabular-nums">
      {items.map((i) => <span key={i.currency}>{money(i.amountMinor, i.currency)}</span>)}
    </span>
  );
}

export function Consolidated({ value, currency }: { value: ConsolidatedAmount; currency: string }) {
  return (
    <span className="tabular-nums">
      {money(value.amountMinor, currency)}
      {!value.complete && <span className="ml-1 text-xs text-pending-ink" title="Some currencies have no exchange rate and are left out">(incomplete)</span>}
    </span>
  );
}
