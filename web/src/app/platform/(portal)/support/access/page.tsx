'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

interface Grant { id: string; groupId: string; groupName: string; purpose: string; hours: number; status: string; expiresAt: string | null; createdAt: string }

export default function GroupAccessPage() {
  const grants = useQuery({ queryKey: ['support-grants'], queryFn: () => api<Grant[]>('platform/support-access'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="Group Access Requests" description="Temporary, read-only access you asked for. A group's chairperson approves or refuses, and can end it early." />
      <Panel flush>
        <DataTable<Grant>
          data={grants.data}
          loading={grants.isLoading}
          error={grants.error}
          onRetry={() => grants.refetch()}
          empty="No requests yet"
          emptyDescription="Request access from a support case about a group."
          columns={[
            { accessorKey: 'groupName', header: 'Group', enableSorting: false },
            { accessorKey: 'purpose', header: 'Purpose', enableSorting: false },
            { accessorKey: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            { accessorKey: 'expiresAt', header: 'Ends', enableSorting: false, cell: ({ row }) => (row.original.expiresAt ? dateTime(row.original.expiresAt) : `${row.original.hours} h once approved`) },
            { id: 'open', header: '', cell: ({ row }) => (row.original.status === 'APPROVED' ? <Link href={`/platform/support/access/${row.original.id}`} className="font-medium text-berry hover:underline">View records</Link> : null) },
          ]}
        />
      </Panel>
    </>
  );
}
