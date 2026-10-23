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
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-me'] });
  const start = useAction(() => api<{ secret: string; otpauthUrl: string }>('platform/auth/mfa/setup', { body: {} }), { onSuccess: setSetup });
  const enable = useAction(() => api('platform/auth/mfa/enable', { body: { code } }), { success: 'Two-step sign-in is on', onSuccess: () => { setSetup(null); setCode(''); refresh(); } });
  const disable = useAction(() => api('platform/auth/mfa/disable', { body: { password: pw, code } }), { success: 'Two-step sign-in is off', onSuccess: () => { setPw(''); setCode(''); refresh(); } });
  const on = !!me.data?.mfaEnabled;
  return (
    <Panel title="Two-step sign-in (authenticator app)">
      {on ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(undefined); }}>
          <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink">On. Each sign-in asks for a code from your authenticator app.</p>
          <p className="text-sm text-muted">To turn it off, confirm your password and a current code.</p>
          <Field label="Password" htmlFor="mp"><Input id="mp" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="6-digit code" htmlFor="mc"><Input id="mc" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          <Button type="submit" variant="secondary" loading={disable.isPending} disabled={!pw || code.length !== 6}>Turn off</Button>
        </form>
      ) : setup ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(undefined); }}>
          <p className="text-sm text-plum">Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the code it shows.</p>
          <code className="block break-all rounded-lg bg-canvas p-2 text-sm tracking-wider ring-1 ring-line">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          <a href={setup.otpauthUrl} className="text-sm text-berry hover:underline">Open in an authenticator app on this device</a>
          <Field label="6-digit code" htmlFor="ec"><Input id="ec" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          <div className="flex gap-2"><Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>Turn on</Button><Button type="button" variant="secondary" onClick={() => setSetup(null)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Off. We recommend it for everyone, and especially owners and administrators.</p>
          <Button onClick={() => start.mutate(undefined)} loading={start.isPending}>Set up</Button>
        </div>
      )}
    </Panel>
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
