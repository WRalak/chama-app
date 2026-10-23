'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthCard, FormError } from '@/components/platform/auth-card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

export default function PlatformForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ message: string }>('platform/auth/forgot-password', { body: { email } });
      setDone(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Reset your password" subtitle="We e-mail you a link that works once and expires soon.">
      {done ? (
        <div className="space-y-4">
          <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink" role="status">{done}</p>
          <p className="text-sm text-muted">No e-mail? Ask an administrator to send you a reset link from the Helpers page.</p>
          <Link href="/platform/login" className="block text-center text-sm text-berry hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Work e-mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>Send reset link</Button>
          <Link href="/platform/login" className="block text-center text-sm text-berry hover:underline">Back to sign in</Link>
        </form>
      )}
    </AuthCard>
  );
}
