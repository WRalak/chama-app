'use client';

import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { dateTime } from '@/lib/utils';

interface Ticket { id: string; subject: string; body: string; status: string; createdAt: string; user: { fullName: string; phone: string } | null }
interface Grant { id: string; groupId: string; groupName: string; purpose: string; status: string; expiresAt: string | null; createdAt: string }

export default function SupportPage() {
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api<Ticket[]>('platform/support-tickets') });
  const grants = useQuery({ queryKey: ['my-grants'], queryFn: () => api<Grant[]>('platform/support-access') });
  const update = useAction(({ id, status }: { id: string; status: string }) => api(`platform/support-tickets/${id}`, { method: 'PATCH', body: { status } }), { success: 'Ticket updated', invalidate: [['tickets']] });
  return (
    <>
      <PageHeader title="Support" description="Requests from users, including account deletion requests, and your group access grants." />
      <Tabs defaultValue="tickets">
        <TabsList tabs={[{ value: 'tickets', label: 'Tickets' }, { value: 'grants', label: 'My group access grants' }]} />
        <TabsContent value="tickets">
          <Panel flush>
            <DataTable<Ticket>
              data={tickets.data}
              loading={tickets.isLoading}
              error={tickets.error}
              empty="No support tickets"
              columns={[
                { accessorKey: 'createdAt', header: 'Opened', cell: ({ row }) => dateTime(row.original.createdAt) },
                { id: 'u', header: 'From', cell: ({ row }) => (row.original.user ? <div>{row.original.user.fullName}<p className="text-xs text-muted">{row.original.user.phone}</p></div> : '—') },
                { accessorKey: 'subject', header: 'Subject', cell: ({ row }) => <div>{row.original.subject}<p className="line-clamp-2 text-xs text-muted">{row.original.body}</p></div> },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
                { id: 'a', header: '', cell: ({ row }) => (row.original.status !== 'RESOLVED' ? <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: row.original.id, status: 'RESOLVED' })}>Resolve</Button> : null) },
              ]}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="grants">
          <Panel flush>
            <DataTable<Grant>
              data={grants.data}
              loading={grants.isLoading}
              empty="No access requests"
              columns={[
                { accessorKey: 'groupName', header: 'Chama' },
                { accessorKey: 'purpose', header: 'Purpose' },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
                { accessorKey: 'expiresAt', header: 'Expires', cell: ({ row }) => dateTime(row.original.expiresAt) },
                { id: 'open', header: '', cell: ({ row }) => (row.original.status === 'APPROVED' ? <a className="text-sm text-forest hover:underline" href={`/g/${row.original.groupId}/contributions`}>Open (read-only)</a> : null) },
              ]}
            />
          </Panel>
        </TabsContent>
      </Tabs>
    </>
  );
}
