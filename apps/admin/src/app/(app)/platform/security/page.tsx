'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuditEventRow, Paginated } from '@chamahub/shared';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

export default function SecurityPage() {
  const [page, setPage] = useState(1);
  const events = useQuery({ queryKey: ['platform-audit', page], queryFn: () => api<Paginated<AuditEventRow>>('platform/audit', { query: { page, pageSize: 50 } }), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Security events" description="Sign-in failures, token reuse, password resets, role changes, support access and platform actions." />
      <Panel flush>
        <DataTable<AuditEventRow>
          data={events.data?.items}
          loading={events.isLoading}
          error={events.error}
          server={events.data ? { page, pageSize: 50, total: events.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'at', header: 'Time', cell: ({ row }) => dateTime(row.original.at), enableSorting: false },
            { accessorKey: 'action', header: 'Event', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>, enableSorting: false },
            { accessorKey: 'actorName', header: 'User', cell: ({ row }) => row.original.actorName ?? 'System', enableSorting: false },
            { accessorKey: 'entityType', header: 'Record', enableSorting: false },
            { accessorKey: 'reason', header: 'Detail', cell: ({ row }) => row.original.reason ?? '', enableSorting: false },
            { accessorKey: 'ipAddress', header: 'IP', cell: ({ row }) => <span className="text-xs text-muted">{row.original.ipAddress ?? ''}</span>, enableSorting: false },
          ]}
        />
      </Panel>
    </>
  );
}
