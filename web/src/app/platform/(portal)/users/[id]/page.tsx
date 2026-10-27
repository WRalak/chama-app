'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PlatformPermission } from '@chamahub/shared';
import { ConfirmAction } from '@/components/platform/confirm-action';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/platform-session';
import { date, dateTime } from '@/lib/utils';

interface UserDetail {
  id: string; fullName: string; phoneMasked: string; email: string | null; phoneVerified: boolean; status: 'ACTIVE' | 'DISABLED' | 'LOCKED'; deletionRequestedAt: string | null; createdAt: string;
  groups: { id: string; name: string; role: string; status: string; groupStatus: string; joinedAt: string }[];
  cases: { id: string; number: string; subject: string; status: string; createdAt: string }[];
  activeSessions: number; lastActiveAt: string | null;
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = usePlatformCan();
  const u = useQuery({ queryKey: ['platform-user', id], queryFn: () => api<UserDetail>(`platform/users/${id}`) });
  const inv = [['platform-user', id], ['platform-users']];
  const setStatus = useAction((v: { disabled: boolean; reason: string }) => api(`platform/users/${id}/status`, { body: v }), { success: (_r) => 'Account updated', invalidate: inv });
  const resetCode = useAction((reason: string) => api<{ message: string }>(`platform/users/${id}/send-reset-code`, { body: { reason } }), { success: (r) => r.message });
  const signOut = useAction((reason: string) => api<{ revoked: number }>(`platform/users/${id}/revoke-sessions`, { body: { reason } }), { success: (r) => `Signed out of ${r.revoked} device${r.revoked === 1 ? '' : 's'}`, invalidate: inv });
  const unlock = useAction((reason: string) => api(`platform/users/${id}/unlock`, { body: { reason } }), { success: 'Unlocked', invalidate: inv });
  if (u.error) return <Panel><ErrorState error={u.error} onRetry={() => u.refetch()} /></Panel>;
  if (!u.data) return <Panel><LoadingRows rows={6} /></Panel>;
  const d = u.data;
  const manage = can(PlatformPermission.PLATFORM_MANAGE_ACCOUNTS);
  return (
    <>
      <PageHeader title={d.fullName} description={`${d.phoneMasked}${d.email ? ` · ${d.email}` : ''}`} actions={<Link href="/platform/users" className="text-sm text-berry hover:underline">All users</Link>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Account" className="lg:col-span-2">
          <KeyValues items={[
            ['Status', <StatusBadge key="s" status={d.status === 'DISABLED' ? 'SUSPENDED' : d.status === 'LOCKED' ? 'PENDING' : 'ACTIVE'} />],
            ['Phone verified', d.phoneVerified ? 'Yes' : 'No'],
            ['Active sessions', d.activeSessions],
            ['Last active', d.lastActiveAt ? dateTime(d.lastActiveAt) : '—'],
            ['Member since', date(d.createdAt)],
            ['Deletion request', d.deletionRequestedAt ? dateTime(d.deletionRequestedAt) : 'None'],
          ]} />
        </Panel>
        {manage && (
          <Panel title="Account recovery">
            <div className="flex flex-col gap-2">
              <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Send reset code by SMS</Button>} title="Send a reset code?" description="A code goes by SMS to the account holder's own phone. You never see it. Confirm the person's identity first." confirmLabel="Send code" busy={resetCode.isPending} onConfirm={(r) => resetCode.mutateAsync(r)} />
              <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Sign out everywhere</Button>} title="Sign this person out of every device?" description="Use when an account may be in someone else's hands. Their password is unchanged; send a reset code too if it may be known." confirmLabel="Sign out everywhere" busy={signOut.isPending} onConfirm={(r) => signOut.mutateAsync(r)} />
              {d.status === 'LOCKED' && <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Unlock sign-in</Button>} title="Unlock this account?" description="Clears the lock from repeated failed sign-ins." confirmLabel="Unlock" busy={unlock.isPending} onConfirm={(r) => unlock.mutateAsync(r)} />}
              {d.status === 'DISABLED' ? (
                <ConfirmAction trigger={(open) => <Button onClick={open}>Reactivate</Button>} title="Reactivate this account?" description="They can sign in again." confirmLabel="Reactivate" busy={setStatus.isPending} onConfirm={(reason) => setStatus.mutateAsync({ disabled: false, reason })} />
              ) : (
                <ConfirmAction trigger={(open) => <Button variant="danger" onClick={open}>Suspend account</Button>} danger title={`Suspend ${d.fullName}?`} description="They are signed out everywhere and cannot sign in. Their groups' records are untouched." confirmLabel="Suspend" busy={setStatus.isPending} onConfirm={(reason) => setStatus.mutateAsync({ disabled: true, reason })} />
              )}
            </div>
          </Panel>
        )}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title={`Groups (${d.groups.length})`} flush>
          <DataTable data={d.groups} empty="Not in any group" columns={[
            { accessorKey: 'name', header: 'Group', cell: ({ row }) => (can(PlatformPermission.PLATFORM_VIEW_GROUPS) ? <Link href={`/platform/groups/${row.original.id}`} className="text-berry hover:underline">{row.original.name}</Link> : row.original.name) },
            { accessorKey: 'role', header: 'Role', cell: ({ row }) => row.original.role.toLowerCase() },
            { accessorKey: 'status', header: 'Membership', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
          ]} />
        </Panel>
        <Panel title="Support cases" flush>
          <DataTable data={d.cases} empty="No cases" columns={[
            { accessorKey: 'number', header: 'Case', cell: ({ row }) => (can(PlatformPermission.PLATFORM_SUPPORT) ? <Link href={`/platform/support/${row.original.id}`} className="font-mono text-xs text-berry hover:underline">{row.original.number}</Link> : row.original.number) },
            { accessorKey: 'subject', header: 'Subject' },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => row.original.status.toLowerCase().replace(/_/g, ' ') },
          ]} />
        </Panel>
      </div>
    </>
  );
}
