'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, Paginated, PlatformRole, PlatformStaffRow, PLATFORM_ROLES } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useMe } from '@/lib/session';
import { date } from '@/lib/utils';

const DESCRIPTIONS: Record<PlatformRole, string> = {
  USER: 'No platform access.',
  SUPPORT: 'Support tickets and account assistance. No financial records, plans or statistics.',
  PLATFORM_ADMIN: 'Chamas, plans, promotional access, billing cases, account status and operational reports. No revenue figures.',
  FINANCE: 'Revenue, refunds, manual payment confirmation, operating costs and exchange rates. No accounts or group finances.',
  SUPER_ADMIN: 'Platform configuration, administrators, security and everything above.',
};

export default function StaffPage() {
  const { data: me } = useMe();
  const staff = useQuery({ queryKey: ['platform-staff'], queryFn: () => api<PlatformStaffRow[]>('platform/staff') });
  const [q, setQ] = useState('');
  const search = useQuery({ queryKey: ['platform-users', 'staff-search', q], queryFn: () => api<Paginated<{ id: string; fullName: string; phone: string; platformRole: PlatformRole }>>('platform/users', { query: { q, pageSize: 10 } }), enabled: q.length >= 3 });
  const [edit, setEdit] = useState<{ id: string; fullName: string; platformRole: PlatformRole } | null>(null);
  const [role, setRole] = useState<PlatformRole>('SUPPORT');
  const [reason, setReason] = useState('');
  const save = useAction(() => api(`platform/users/${edit!.id}/platform-role`, { method: 'PATCH', body: { platformRole: role, reason } }), { success: 'Platform role updated. They must sign in again.', invalidate: [['platform-staff']], onSuccess: () => setEdit(null) });
  const open = (u: { id: string; fullName: string; platformRole: PlatformRole }) => { setEdit(u); setRole(u.platformRole === 'USER' ? 'SUPPORT' : u.platformRole); setReason(''); };

  return (
    <>
      <PageHeader title="Platform staff" description="People who operate ChamaHub. Platform roles never grant access to a Chama’s private finances." />
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel flush title="Current staff">
          <DataTable<PlatformStaffRow>
            data={staff.data}
            loading={staff.isLoading}
            error={staff.error}
            columns={[
              { accessorKey: 'fullName', header: 'Name' },
              { accessorKey: 'phone', header: 'Phone' },
              { accessorKey: 'platformRole', header: 'Role', cell: ({ row }) => <Badge tone="navy">{LABELS.platformRole[row.original.platformRole]}</Badge> },
              { accessorKey: 'createdAt', header: 'Account since', cell: ({ row }) => date(row.original.createdAt) },
              { id: 'a', header: '', cell: ({ row }) => (row.original.id !== me?.id ? <Button size="sm" variant="ghost" onClick={() => open(row.original)}>Change</Button> : <span className="text-xs text-muted">You</span>) },
            ]}
          />
        </Panel>
        <div className="space-y-5">
          <Panel title="Add staff">
            <Field label="Find an existing account (name or phone)" htmlFor="s-q"><Input id="s-q" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
            <ul className="mt-2 divide-y divide-line text-sm">
              {search.data?.items.filter((u) => u.platformRole === 'USER').map((u) => (
                <li key={u.id} className="flex items-center justify-between py-2"><span>{u.fullName} <span className="text-muted">{u.phone}</span></span><Button size="sm" variant="secondary" onClick={() => open(u)}>Appoint</Button></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Platform roles">
            <dl className="space-y-2 text-sm">{PLATFORM_ROLES.filter((r) => r !== 'USER').map((r) => <div key={r}><dt className="font-medium">{LABELS.platformRole[r]}</dt><dd className="text-muted">{DESCRIPTIONS[r]}</dd></div>)}</dl>
          </Panel>
        </div>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={`Platform role · ${edit?.fullName}`} description="The change is audited and signs the person out of all devices.">
          <div className="space-y-3">
            <Field label="Role" htmlFor="pr-r"><Select id="pr-r" value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>{PLATFORM_ROLES.map((r) => <option key={r} value={r}>{LABELS.platformRole[r]}{r === 'USER' ? ' (remove staff access)' : ''}</option>)}</Select></Field>
            <p className="text-xs text-muted">{DESCRIPTIONS[role]}</p>
            <Field label="Reason" htmlFor="pr-reason"><Textarea id="pr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={reason.trim().length < 5}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
