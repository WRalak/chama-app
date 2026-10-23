'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { staffPasswordSchema } from '@chamahub/shared';
import { PasswordRules } from '@/components/platform/auth-card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformMe } from '@/lib/platform-session';
import { dateTime } from '@/lib/utils';

interface Sess { id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean }

export default function AccountSecurityPage() {
  return (
    <>
      <PageHeader title="Security Settings" description="Your password, two-step sign-in and signed-in devices." />
      <div className="grid gap-5 lg:grid-cols-2">
        <ChangePassword />
        <Mfa />
        <Sessions />
      </div>
    </>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const save = useAction(() => api('platform/auth/change-password', { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }), { success: 'Password changed; your other sessions were signed out', invalidate: [['platform-sessions']], onSuccess: () => setF({ currentPassword: '', newPassword: '', confirm: '' }) });
  const ok = staffPasswordSchema.safeParse(f.newPassword).success && f.newPassword === f.confirm && !!f.currentPassword;
  return (
    <Panel title="Password">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /><PasswordRules value={f.newPassword} /></Field>
        <Field label="Type it again" htmlFor="np2" error={f.confirm && f.confirm !== f.newPassword ? 'Does not match' : undefined}><Input id="np2" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <Button type="submit" loading={save.isPending} disabled={!ok}>Change password</Button>
      </form>
    </Panel>
  );
}

function Mfa() {
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-me'] });
  const start = useAction(() => api<{ secret: string; otpauthUrl: string }>('platform/auth/mfa/setup', { body: {} }), { onSuccess: setSetup });
  const enable = useAction(() => api<{ recoveryCodes: string[] }>('platform/auth/mfa/enable', { body: { code } }), { success: 'Two-step sign-in is on', onSuccess: (r) => { setSetup(null); setCode(''); setCodes(r.recoveryCodes); } });
  const regen = useAction(() => api<{ recoveryCodes: string[] }>('platform/auth/mfa/recovery-codes', { body: { code } }), { success: 'New recovery codes created; the old ones no longer work', onSuccess: (r) => { setCode(''); setCodes(r.recoveryCodes); } });
  const disable = useAction(() => api('platform/auth/mfa/disable', { body: { password: pw, code } }), { success: 'Two-step sign-in is off', onSuccess: () => { setPw(''); setCode(''); refresh(); } });
  const d = me.data;
  const on = !!d?.mfaEnabled;
  const required = !!d?.mfaRequired;
  const sixDigits = /^\d{6}$/.test(code);
  const codeInput = (id: string) => <Field label="6-digit code from your app" htmlFor={id}><Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>;

  if (codes) {
    return (
      <Panel title="Save your recovery codes" className="lg:col-span-2">
        <RecoveryCodes codes={codes} email={d?.email ?? ''} onDone={() => { setCodes(null); refresh(); }} />
      </Panel>
    );
  }
  return (
    <Panel title="Two-step sign-in (authenticator app)">
      {required && !on && <p className="mb-3 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink" role="alert">Two-step sign-in is required for ChamaHub staff. Set it up to open the rest of the portal.</p>}
      {on ? (
        <div className="space-y-4">
          <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink">On. Each sign-in asks for a code from your authenticator app.</p>
          <p className={`text-sm ${(d?.recoveryCodesLeft ?? 0) <= 3 ? 'font-semibold text-warning' : 'text-muted'}`}>{d?.recoveryCodesLeft ?? 0} unused recovery code(s) left.{(d?.recoveryCodesLeft ?? 0) <= 3 && ' Create new ones now.'}</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); regen.mutate(undefined); }}>
            {codeInput('rc')}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" loading={regen.isPending} disabled={!sixDigits}>Create new recovery codes</Button>
            </div>
          </form>
          {required ? (
            <p className="text-xs text-muted">Two-step sign-in is required for staff, so it cannot be turned off. New phone? Ask an administrator to reset it from your Helpers page, then set it up again.</p>
          ) : (
            <form className="space-y-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(undefined); }}>
              <p className="text-sm text-muted">To turn it off, confirm your password and a current code.</p>
              <Field label="Password" htmlFor="mp"><Input id="mp" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
              <Button type="submit" variant="ghost" loading={disable.isPending} disabled={!pw || !sixDigits}>Turn off</Button>
            </form>
          )}
        </div>
      ) : setup ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(undefined); }}>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-plum">
            <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
            <li>Add an account with this key (or open the link on your phone).</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <code className="block break-all rounded-lg bg-canvas p-2 text-sm tracking-wider ring-1 ring-line">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          <a href={setup.otpauthUrl} className="text-sm text-berry hover:underline">Open in an authenticator app on this device</a>
          {codeInput('ec')}
          <div className="flex gap-2"><Button type="submit" loading={enable.isPending} disabled={!sixDigits}>Turn on</Button><Button type="button" variant="secondary" onClick={() => setSetup(null)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Off. A password alone is not enough to protect an account that can see every group.</p>
          <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>Set up two-step sign-in</Button>
        </div>
      )}
    </Panel>
  );
}

/** Recovery codes, shown once. They let you sign in if you lose your phone; each works once. */
function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `ChamaHub staff recovery codes for ${email}\nEach code works once. Keep them somewhere safe and private.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chamahub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-plum">If you lose your phone, sign in with one of these instead of a code. <strong>They are shown only now.</strong> Each works once. Store them in a password manager or print them; do not e-mail them or keep them in chat.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-canvas p-3 font-mono text-sm tracking-wider text-plum ring-1 ring-line sm:grid-cols-5" aria-label="Recovery codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}>Download as text</Button>
        <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(codes.join('\n')).catch(() => undefined); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-plum"><input type="checkbox" className="accent-berry" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes somewhere safe</label>
      <Button onClick={onDone} disabled={!saved}>Done</Button>
    </div>
  );
}

function Sessions() {
  const q = useQuery({ queryKey: ['platform-sessions'], queryFn: () => api<Sess[]>('platform/auth/sessions') });
  const revoke = useAction((id: string) => api(`platform/auth/sessions/${id}`, { method: 'DELETE' }), { success: 'Signed out', invalidate: [['platform-sessions']] });
  return (
    <Panel title="Signed-in devices" flush className="lg:col-span-2">
      <DataTable<Sess>
        data={q.data}
        loading={q.isLoading}
        error={q.error}
        columns={[
          { accessorKey: 'userAgent', header: 'Device', enableSorting: false, cell: ({ row }) => <span className="line-clamp-1 text-xs">{row.original.userAgent ?? 'Unknown'}{row.original.current && <span className="ml-1 font-semibold text-success-ink">(this device)</span>}</span> },
          { accessorKey: 'ipAddress', header: 'IP', enableSorting: false, cell: ({ row }) => row.original.ipAddress ?? '—' },
          { accessorKey: 'lastUsedAt', header: 'Last active', enableSorting: false, cell: ({ row }) => dateTime(row.original.lastUsedAt) },
          { accessorKey: 'expiresAt', header: 'Ends by', enableSorting: false, cell: ({ row }) => dateTime(row.original.expiresAt) },
          { id: 'x', header: '', cell: ({ row }) => (row.original.current ? null : <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(row.original.id)}>Sign out</Button>) },
        ]}
      />
    </Panel>
  );
}
