'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, Paginated, PlatformPermission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { date } from '@/lib/utils';

interface Row { id: string; name: string; type: keyof typeof LABELS.groupType; status: string; county: string | null; members: number; createdAt: string; plan: string | null; subscriptionStatus: string | null; currentPeriodEnd: string | null }

export default function PlatformGroupsPage() {
  const can = usePlatformCan();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [req, setReq] = useState<Row | null>(null);
  const [purpose, setPurpose] = useState('');
  const [hours, setHours] = useState(2);
  const groups = useQuery({ queryKey: ['platform-groups', q, page], queryFn: () => api<Paginated<Row>>('platform/groups', { query: { q: q || undefined, page, pageSize: 50 } }), placeholderData: (p) => p });
  const request = useAction(() => api('platform/support-access', { body: { groupId: req!.id, purpose, hours } }), { success: 'Request sent to the group chairperson', onSuccess: () => setReq(null) });
  return (
    <>
      <PageHeader title="All Chamas" description="Group metadata only. Viewing a group’s books requires the chairperson to approve a support request." />
      <Panel flush>
        <Toolbar><Input className="max-w-xs" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" /></Toolbar>
        <DataTable<Row>
          data={groups.data?.items}
          loading={groups.isLoading}
          error={groups.error}
          server={groups.data ? { page, pageSize: 50, total: groups.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'name', header: 'Chama', enableSorting: false },
            { accessorKey: 'type', header: 'Type', cell: ({ row }) => LABELS.groupType[row.original.type], enableSorting: false },
            { accessorKey: 'county', header: 'County', cell: ({ row }) => row.original.county ?? '—', enableSorting: false },
            { accessorKey: 'members', header: 'Members', meta: { align: 'right' }, enableSorting: false },
            { accessorKey: 'plan', header: 'Plan', cell: ({ row }) => row.original.plan ?? '—', enableSorting: false },
            { accessorKey: 'subscriptionStatus', header: 'Subscription', cell: ({ row }) => (row.original.subscriptionStatus ? <StatusBadge status={row.original.subscriptionStatus} /> : '—'), enableSorting: false },
            { accessorKey: 'createdAt', header: 'Created', cell: ({ row }) => date(row.original.createdAt), enableSorting: false },
            { id: 'a', header: '', cell: ({ row }) => (can(PlatformPermission.PLATFORM_SUPPORT) ? <Button size="sm" variant="ghost" onClick={() => { setReq(row.original); setPurpose(''); }}>Request access</Button> : null), enableSorting: false },
          ]}
        />
      </Panel>
      <Dialog open={!!req} onOpenChange={(o) => !o && setReq(null)}>
        <DialogContent title={`Request read access to ${req?.name}`} description="The chairperson must approve. Access is read-only, time-limited, and every page view is audited.">
          <div className="space-y-3">
            <Field label="Purpose" htmlFor="sa-p"><Textarea id="sa-p" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Investigate ticket #1042: duplicate contribution reported by treasurer" /></Field>
            <Field label="Hours" htmlFor="sa-h"><Input id="sa-h" type="number" min={1} max={72} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReq(null)}>Cancel</Button><Button onClick={() => request.mutate(undefined)} loading={request.isPending} disabled={purpose.trim().length < 5}>Send request</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
