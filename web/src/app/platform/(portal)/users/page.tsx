'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Paginated } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { date } from '@/lib/utils';

interface UserRow { id: string; fullName: string; phoneMasked: string; email: string | null; phoneVerified: boolean; groups: number; supportCases: number; status: 'ACTIVE' | 'DISABLED' | 'LOCKED'; deletionRequestedAt: string | null; createdAt: string }

export default function UsersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['platform-users', q, status, page], queryFn: () => api<Paginated<UserRow>>('platform/users', { query: { q: q || undefined, status: status || undefined, page, pageSize: 25 } }), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Users" description="Member accounts. Account metadata only: balances and contributions stay with each group." />
      <Panel flush>
        <Toolbar>
          <Input className="max-w-xs" placeholder="Name, phone or e-mail" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="w-48" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All accounts</option>
            <option value="active">Active</option>
            <option value="disabled">Suspended</option>
            <option value="locked">Locked (failed sign-ins)</option>
            <option value="deletion_requested">Deletion requested</option>
          </Select>
        </Toolbar>
        <DataTable<UserRow>
          data={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={(u) => router.push(`/platform/users/${u.id}`)}
          empty="No users match"
          server={list.data ? { page, pageSize: 25, total: list.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'fullName', header: 'Name', enableSorting: false, cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span> },
            { accessorKey: 'phoneMasked', header: 'Phone', enableSorting: false, cell: ({ row }) => <span className="tabular-nums">{row.original.phoneMasked}{!row.original.phoneVerified && <span className="block text-xs text-warning">Not verified</span>}</span> },
            { accessorKey: 'email', header: 'E-mail', enableSorting: false, cell: ({ row }) => row.original.email ?? '—' },
            { accessorKey: 'groups', header: 'Groups', enableSorting: false, meta: { align: 'right' } },
            { accessorKey: 'supportCases', header: 'Cases', enableSorting: false, meta: { align: 'right' } },
            { accessorKey: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusBadge status={row.original.status === 'DISABLED' ? 'SUSPENDED' : row.original.status === 'LOCKED' ? 'PENDING' : 'ACTIVE'} /> },
            { accessorKey: 'createdAt', header: 'Joined', enableSorting: false, cell: ({ row }) => date(row.original.createdAt) },
          ]}
        />
      </Panel>
    </>
  );
}
