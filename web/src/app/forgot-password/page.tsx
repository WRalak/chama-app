'use client';

import Link from 'next/link';
import { useState } from 'react';
import { normalizeKenyanPhone, passwordSchema } from '@chamahub/shared';
import { BrandMark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'phone' | 'code' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizeKenyanPhone(phone)) return setError('Enter a valid Kenyan mobile number');
    setBusy(true);
    setError(null);
    try {
      await api('auth/otp/request', { body: { phone, purpose: 'RESET_PASSWORD' } });
      setStep('code');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return setError(pw.error.issues[0].message);
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      await api('auth/password/reset', { body: { phone, code, newPassword: password } });
      setStep('done');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10" />
          <h1 className="mt-3 text-lg font-semibold text-plum">Reset your password</h1>
          <p className="text-sm text-muted">We will send a code by SMS to your registered number.</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-5">
          {step === 'phone' && (
            <form onSubmit={requestCode} className="space-y-4">
              <Field label="Phone number" htmlFor="phone">
                <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
              </Field>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button className="w-full" loading={busy}>Send code</Button>
            </form>
          )}
          {step === 'code' && (
            <form onSubmit={reset} className="space-y-4">
              <Field label="6-digit code" htmlFor="code">
                <Input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
              </Field>
              <Field label="New password" htmlFor="pw" hint="At least 8 characters with a letter and a number">
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button className="w-full" loading={busy}>Set new password</Button>
            </form>
          )}
          {step === 'done' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-plum">Your password has been reset. All other sessions were signed out.</p>
              <Button asChild className="w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-berry hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
