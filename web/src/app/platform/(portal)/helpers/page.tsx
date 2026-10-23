'use client';

import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type InviteResult, type Paginated, type PlatformPermission, type PlatformRoleRow, type StaffRow } from '@chamahub/shared';
import { OneTimeLink } from '@/components/platform/confirm-action';
import { PermissionPicker } from '@/components/platform/permission-picker';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformMe } from '@/lib/platform-session';
import { date, dateTime } from '@/lib/utils';

const INVITE_TONE = { PENDING: 'amber', EXPIRED: 'red', ACCEPTED: 'green' } as const;

export default function HelpersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [sort, setSort] = useState<'created' | 'name' | 'lastLogin'>('created');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['platform-staff', q, status, role, sort, page],
    queryFn: () => api<Paginated<StaffRow>>('platform/staff', { query: { q: q || undefined, status: status || undefined, role: role || undefined, sort, page, pageSize: 25 } }),
    placeholderData: (p) => p,
  });
  const roles = useQuery({ queryKey: ['platform-roles'], queryFn: () => api<PlatformRoleRow[]>('platform/roles') });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Helpers" description="Platform staff: support helpers, administrators, analysts and finance. Each person sets their own password from an invitation." actions={<AddHelper roles={roles.data ?? []} />} />
      <Panel flush>
        <Toolbar>
          <Input className="max-w-xs" placeholder="Search name or e-mail" aria-label="Search staff" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <Select className="w-40" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
            <option value="">All statuses</option>
            {['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </Select>
          <Select className="w-48" aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); reset(); }}>
            <option value="">All roles</option>
            {roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </Select>
          <Select className="w-44" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="created">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="lastLogin">Last sign-in</option>
          </Select>
        </Toolbar>
        <DataTable<StaffRow>
          data={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={(r) => router.push(`/platform/helpers/${r.id}`)}
          empty="No staff match these filters"
          server={list.data ? { page, pageSize: 25, total: list.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'fullName', header: 'Name', enableSorting: false, cell: ({ row }) => <span><span className="font-medium">{row.original.fullName}</span>{row.original.team && <span className="block text-xs text-muted">{row.original.team}</span>}</span> },
            { accessorKey: 'email', header: 'E-mail', enableSorting: false },
            { id: 'roles', header: 'Role', cell: ({ row }) => row.original.roles.map((r) => r.name).join(', ') || '—' },
            { accessorKey: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            { id: 'invitation', header: 'Invitation', cell: ({ row }) => (row.original.invitation ? <Badge tone={INVITE_TONE[row.original.invitation]}>{row.original.invitation.toLowerCase()}</Badge> : '—') },
            { accessorKey: 'openCases', header: 'Open cases', enableSorting: false, meta: { align: 'right' } },
            { accessorKey: 'lastLoginAt', header: 'Last sign-in', enableSorting: false, cell: ({ row }) => (row.original.lastLoginAt ? dateTime(row.original.lastLoginAt) : 'Never') },
            { accessorKey: 'createdAt', header: 'Created', enableSorting: false, cell: ({ row }) => date(row.original.createdAt) },
          ]}
        />
      </Panel>
    </>
  );
}

function AddHelper({ roles }: { roles: PlatformRoleRow[] }) {
  const me = usePlatformMe();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', team: '', expiresAt: '' });
  const [roleCodes, setRoleCodes] = useState<string[]>(['SUPPORT_HELPER']);
  const [extra, setExtra] = useState<PlatformPermission[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const invite = useAction(
    () => api<InviteResult>('platform/staff', { body: { ...form, team: form.team || undefined, expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : undefined, roleCodes, extraPermissions: extra } }),
    { invalidate: [['platform-staff']], onSuccess: (r) => setResult(r), success: (r) => (r.delivery.sent ? 'Invitation e-mailed' : 'Account created; e-mail not sent') },
  );
  const close = () => {
    setOpen(false);
    setResult(null);
    setForm({ fullName: '', email: '', team: '', expiresAt: '' });
    setRoleCodes(['SUPPORT_HELPER']);
    setExtra([]);
  };
  const held = me.data?.permissions ?? [];
  const isOwner = me.data?.roles.some((r) => r.code === 'OWNER');
  return (
    <>
      <Button onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Add helper</Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent title={result ? 'Invitation created' : 'Add a helper'} description={result ? undefined : 'They receive a single-use link to choose their own password. You never see or set it.'} className="max-w-2xl">
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-plum">{result.account.fullName} ({result.account.email}) is invited as {result.account.roles.map((r) => r.name).join(', ')}.</p>
              {result.delivery.sent ? (
                <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink">The invitation was e-mailed. The link expires and works once.</p>
              ) : (
                <>
                  <p className="text-sm text-danger-ink">{result.delivery.error}</p>
                  {result.inviteUrl && <OneTimeLink url={result.inviteUrl} what="invitation" />}
                  <p className="text-xs text-muted">Lost the link? Use “Resend invitation” on their page: it replaces this one.</p>
                </>
              )}
              <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(undefined); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" htmlFor="h-name"><Input id="h-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></Field>
                <Field label="Work e-mail" htmlFor="h-email"><Input id="h-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
                <Field label="Team (optional)" htmlFor="h-team"><Input id="h-team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="e.g. Support Nairobi" /></Field>
                <Field label="Access ends (optional)" htmlFor="h-exp" hint="For temporary helpers"><Input id="h-exp" type="date" min={new Date().toISOString().slice(0, 10)} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field>
              </div>
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-plum">Role</legend>
                <div className="space-y-1.5">
                  {roles.filter((r) => r.code !== 'OWNER' || isOwner).map((r) => {
                    const grantable = r.permissions.every((p) => held.includes(p));
                    return (
                      <label key={r.code} className={`flex items-start gap-2 rounded-lg border border-line p-2 text-sm ${grantable ? '' : 'opacity-50'}`}>
                        <input type="checkbox" className="mt-0.5 accent-berry" disabled={!grantable} checked={roleCodes.includes(r.code)} onChange={(e) => setRoleCodes(e.target.checked ? [...roleCodes, r.code] : roleCodes.filter((c) => c !== r.code))} />
                        <span><span className="font-medium text-plum">{r.name}</span><span className="block text-xs text-muted">{r.description}{!grantable && ' (includes permissions you do not hold)'}</span></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <button type="button" className="text-sm text-berry hover:underline" onClick={() => setAdvanced((a) => !a)}>{advanced ? 'Hide' : 'Add'} individual permissions</button>
              {advanced && <PermissionPicker value={extra} onChange={setExtra} held={held} />}
              <p className="text-xs text-muted">Administrative and financial permissions need the “Manage administrators” permission. The server checks every grant again.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
                <Button type="submit" loading={invite.isPending} disabled={!form.fullName || !form.email || !roleCodes.length}>Send invitation</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
