'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Paginated } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { date } from '@/lib/utils';

interface Row { id: string; fullName: string; phone: string; email: string | null; platformRole: string; phoneVerified: boolean; groups: number; disabled: boolean; deletionRequestedAt: string | null; createdAt: string }

export default function PlatformUsersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const users = useQuery({ queryKey: ['platform-users', q, page], queryFn: () => api<Paginated<Row>>('platform/users', { query: { q: q || undefined, page, pageSize: 50 } }), placeholderData: (p) => p });
  const toggle = useAction(() => api(`platform/users/${sel!.id}/status`, { body: { disabled: !sel!.disabled, reason } }), { success: 'Account updated', invalidate: [['platform-users']], onSuccess: () => setSel(null) });
  return (
    <>
      <PageHeader title="Accounts" description="Every person has one account across all their Chamas." />
      <Panel flush>
        <Toolbar><Input className="max-w-xs" placeholder="Search name or phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" /></Toolbar>
        <DataTable<Row>
          data={users.data?.items}
          loading={users.isLoading}
          error={users.error}
          server={users.data ? { page, pageSize: 50, total: users.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'fullName', header: 'Name', enableSorting: false },
            { accessorKey: 'phone', header: 'Phone', enableSorting: false },
            { accessorKey: 'platformRole', header: 'Platform role', cell: ({ row }) => (row.original.platformRole === 'USER' ? '—' : <Badge tone="navy">{row.original.platformRole.replace('_', ' ')}</Badge>), enableSorting: false },
            { accessorKey: 'groups', header: 'Chamas', meta: { align: 'right' }, enableSorting: false },
            { id: 'st', header: 'Status', cell: ({ row }) => <span className="flex gap-1"><StatusBadge status={row.original.disabled ? 'SUSPENDED' : 'ACTIVE'} />{!row.original.phoneVerified && <Badge tone="amber">unverified</Badge>}{row.original.deletionRequestedAt && <Badge tone="red">deletion requested</Badge>}</span>, enableSorting: false },
            { accessorKey: 'createdAt', header: 'Joined', cell: ({ row }) => date(row.original.createdAt), enableSorting: false },
            { id: 'a', header: '', cell: ({ row }) => <Button size="sm" variant="ghost" onClick={() => { setSel(row.original); setReason(''); }}>{row.original.disabled ? 'Enable' : 'Disable'}</Button>, enableSorting: false },
          ]}
        />
      </Panel>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent title={`${sel?.disabled ? 'Enable' : 'Disable'} ${sel?.fullName}`} description={sel?.disabled ? undefined : 'Disabling signs the person out everywhere. Their group records are preserved.'}>
          <div className="space-y-3">
            <Field label="Reason" htmlFor="u-r"><Textarea id="u-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setSel(null)}>Cancel</Button><Button variant={sel?.disabled ? 'primary' : 'danger'} onClick={() => toggle.mutate(undefined)} loading={toggle.isPending} disabled={reason.trim().length < 5}>Confirm</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
