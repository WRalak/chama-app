'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { RECOVERY_CODE_PATTERN, safeRedirectPath } from '@chamahub/shared';
import { AuthCard, FormError } from '@/components/platform/auth-card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const safeNext = (next: string | null) => safeRedirectPath(next, '/platform', '/platform/');

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/auth/${mfaToken ? 'login-mfa' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mfaToken ? { mfaToken, code } : { email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && mfaToken && /expired/i.test(body.message ?? '')) setMfaToken(null);
        setError(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (body.message ?? 'Sign-in failed'));
        return;
      }
      if (body.mfaRequired) {
        setMfaToken(body.mfaToken);
        setPassword('');
        return;
      }
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!mfaToken ? (
        <>
          <Field label="Work e-mail" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="6-digit code from your authenticator app" htmlFor="code" hint="Lost your phone? Enter one of your recovery codes (like K7QXM-2RTPA) instead.">
          <Input id="code" autoComplete="one-time-code" autoCapitalize="characters" maxLength={11} value={code} onChange={(e) => setCode(e.target.value.trim())} autoFocus />
        </Field>
      )}
      <FormError message={error} />
      <Button type="submit" className="w-full" loading={busy} disabled={mfaToken ? !(/^\d{6}$/.test(code) || RECOVERY_CODE_PATTERN.test(code)) : !email || !password}>
        {mfaToken ? 'Verify and sign in' : 'Sign in'}
      </Button>
      {mfaToken ? (
        <button type="button" className="w-full text-center text-sm text-berry hover:underline" onClick={() => { setMfaToken(null); setCode(''); }}>
          Start again
        </button>
      ) : (
        <p className="text-center text-sm">
          <Link href="/platform/forgot-password" className="text-berry hover:underline">Forgot your password?</Link>
        </p>
      )}
    </form>
  );
}

export default function PlatformLoginPage() {
  return (
    <AuthCard title="Sign in" subtitle="Use the e-mail your invitation was sent to.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
