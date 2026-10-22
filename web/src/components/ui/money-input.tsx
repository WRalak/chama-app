'use client';

import * as React from 'react';
import { centsToDecimalString, parseKes } from '@chamahub/shared';
import { cn } from '@/lib/utils';

/** KSh amount input that reports integer cents (never floats) to the form. */
export function MoneyInput({ value, onChange, className, id, placeholder = '0.00', invalid }: { value: number | undefined; onChange: (cents: number | undefined) => void; className?: string; id?: string; placeholder?: string; invalid?: boolean }) {
  const [text, setText] = React.useState(value !== undefined ? centsToDecimalString(value) : '');
  React.useEffect(() => {
    if (value === undefined) return;
    try {
      if (parseKes(text) === value) return;
    } catch {
      /* fallthrough */
    }
    setText(centsToDecimalString(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn('flex h-9 items-center rounded-md border border-line bg-white focus-within:border-rose focus-within:ring-1 focus-within:ring-rose', invalid && 'border-danger', className)}>
      <span className="pl-3 pr-1.5 text-xs font-medium text-muted">KSh</span>
      <input
        id={id}
        inputMode="decimal"
        className="h-full w-full rounded-md bg-transparent pr-3 text-sm tabular-nums text-plum outline-none"
        placeholder={placeholder}
        value={text}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(e.target.value.trim() ? parseKes(e.target.value) : undefined);
          } catch {
            onChange(Number.NaN);
          }
        }}
      />
    </div>
  );
}
