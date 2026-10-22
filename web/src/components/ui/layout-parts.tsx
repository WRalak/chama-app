import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-plum">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, flush }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('rounded-xl border border-line bg-white shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-plum">{title}</h2>
          {actions}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** A row of key figures. Deliberately a strip, not a grid of cards. */
export function StatStrip({ stats }: { stats: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success' }[] }) {
  return (
    <div className="mb-5 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-white shadow-card sm:divide-y-0 md:grid-cols-4 lg:grid-flow-col lg:grid-cols-none">
      {stats.map((s) => (
        <div key={s.label} className="px-4 py-3">
          <p className="text-xs text-muted">{s.label}</p>
          <p className={cn('mt-1 text-lg font-semibold tabular-nums text-plum', s.tone === 'warning' && 'text-warning', s.tone === 'danger' && 'text-danger-ink', s.tone === 'success' && 'text-success-ink')}>{s.value}</p>
          {s.hint && <p className="mt-0.5 text-xs text-muted">{s.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function KeyValues({ items, className }: { items: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(120px,40%)_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-plum">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">{children}</div>;
}

/** Member initials on a blush circle. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return (
    <span aria-hidden className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blush text-xs font-bold text-berry', className)}>
      {initials}
    </span>
  );
}

/** A headline amount with its meaning in words, e.g. "Confirmed" vs "Awaiting verification". */
export function MoneyCard({ label, amount, status, hint }: { label: string; amount: React.ReactNode; status?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {status}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-plum">{amount}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
