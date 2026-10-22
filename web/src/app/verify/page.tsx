'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BrandMark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';

/** Phone verification for a signed-in account. The API refuses everything else until this is done. */
export default function VerifyPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setMsg({ ok: false, text: 'Enter the 6-digit code' });
    setBusy(true);
    setMsg(null);
    try {
      await api('auth/verify-phone', { body: { code } });
      qc.clear();
      router.replace('/');
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setMsg(null);
    try {
      await api('auth/otp/resend', { method: 'POST' });
      setMsg({ ok: true, text: 'A new code is on its way.' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandMark className="h-10 w-10" />
          <h1 className="mt-3 text-lg font-semibold text-plum">Verify your phone</h1>
          <p className="text-sm text-muted">Enter the 6-digit code we sent to your phone by SMS.</p>
        </div>
        <form onSubmit={verify} className="space-y-4 rounded-lg border border-line bg-white p-5" noValidate>
          <Field label="Verification code" htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center text-lg tracking-[0.5em]" />
          </Field>
          {msg && (
            <p className={msg.ok ? 'rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink' : 'rounded-md bg-red-50 px-3 py-2 text-sm text-danger'} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
            Verify
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" onClick={resend} className="text-berry hover:underline">
              Send a new code
            </button>
            <button type="button" onClick={signOut} className="text-muted hover:underline">
              Use a different account
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
