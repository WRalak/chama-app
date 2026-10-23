import { BrandMark } from '@/components/shell/brand';

/** Centered card for the portal's public pages (sign-in, invitation, reset). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10" />
          <p className="mt-3 text-2xs font-semibold uppercase tracking-wider text-berry">ChamaHub staff portal</p>
          <h1 className="mt-1 text-lg font-semibold text-plum">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="rounded-xl border border-line bg-white p-5 shadow-card">{children}</div>
        <p className="mt-4 text-center text-xs text-muted">For ChamaHub staff only. Chama members sign in at <a href="/login" className="text-berry hover:underline">the member app</a>.</p>
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-ink" role="alert">
      {message}
    </p>
  );
}

/** Live checklist for the staff password rules (the API enforces the same ones). */
export function PasswordRules({ value }: { value: string }) {
  const rules = [
    { ok: value.length >= 12, label: 'At least 12 characters' },
    { ok: /[A-Za-z]/.test(value), label: 'A letter' },
    { ok: /\d/.test(value), label: 'A number' },
  ];
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs" aria-label="Password requirements">
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? 'text-success-ink' : 'text-muted'}>
          {r.ok ? '✓' : '○'} {r.label}
        </li>
      ))}
    </ul>
  );
}
