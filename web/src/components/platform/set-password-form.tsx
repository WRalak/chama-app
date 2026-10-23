'use client';

import Link from 'next/link';
import { useState } from 'react';
import { staffPasswordSchema } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { FormError, PasswordRules } from './auth-card';

/** Choose a password with a single-use token (invitation or reset). The password never leaves this form except to the API. */
export function SetPasswordForm({ endpoint, token, submitLabel, doneText }: { endpoint: 'platform/auth/accept-invitation' | 'platform/auth/reset-password'; token: string; submitLabel: string; doneText: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = staffPasswordSchema.safeParse(password).success && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await api(endpoint, { body: { token, password } });
      setDone(true);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink" role="status">{doneText}</p>
        <Button asChild className="w-full"><Link href="/platform/login">Sign in</Link></Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="password">
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordRules value={password} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={confirm && password !== confirm ? 'Does not match' : undefined}>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <FormError message={error} />
      <Button type="submit" className="w-full" loading={busy} disabled={!valid}>{submitLabel}</Button>
    </form>
  );
}
