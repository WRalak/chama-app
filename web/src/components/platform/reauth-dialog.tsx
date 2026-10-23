'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { usePlatformMe } from '@/lib/platform-session';
import { registerReauthHandler } from '@/lib/reauth';

/** Asks for the password (and authenticator code) before a sensitive action, then lets it continue. */
export function ReauthDialog() {
  const me = usePlatformMe();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const mfa = !!me.data?.mfaEnabled;

  useEffect(() => {
    registerReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setPassword('');
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => registerReauthHandler(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    setPassword('');
    setCode('');
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('platform/auth/reauth', { body: { password, ...(mfa ? { code } : {}) } }, true);
      finish(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish(false)}>
      <DialogContent title="Confirm it is you" description="This action changes access, money or platform settings. Enter your password to continue; it stays confirmed for a few minutes.">
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Password" htmlFor="reauth-pw">
            <Input id="reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          {mfa && (
            <Field label="6-digit code from your authenticator app" htmlFor="reauth-code">
              <Input id="reauth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </Field>
          )}
          {error && <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => finish(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!password || (mfa && code.length !== 6)}>Confirm</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
