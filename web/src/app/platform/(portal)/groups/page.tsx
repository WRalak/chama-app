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

interface GroupRow { id: string; name: string; type: string; status: string; countryCode: string; currency: string; members: number; plan: string; planCode: string; subscriptionStatus: string | null; currentPeriodEnd: string | null; createdAt: string }

export default function GroupsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [plan, setPlan] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['platform-groups', q, status, country, plan, page], queryFn: () => api<Paginated<GroupRow>>('platform/groups', { query: { q: q || undefined, status: status || undefined, country: country || undefined, plan: plan || undefined, page, pageSize: 25 } }), placeholderData: (p) => p });
  const r = () => setPage(1);
  return (
    <>
      <PageHeader title="Groups" description="Every Chama on ChamaHub. Metadata only: contributions, loans and ledgers stay private to each group." />
      <Panel flush>
        <Toolbar>
          <Input className="max-w-xs" placeholder="Name or group id" aria-label="Search groups" value={q} onChange={(e) => { setQ(e.target.value); r(); }} />
          <Select className="w-36" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); r(); }}>
            <option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="ARCHIVED">Archived</option>
          </Select>
          <Input className="w-24" placeholder="Country" aria-label="Country code" maxLength={2} value={country} onChange={(e) => { setCountry(e.target.value.toUpperCase()); r(); }} />
          <Select className="w-36" aria-label="Plan" value={plan} onChange={(e) => { setPlan(e.target.value); r(); }}>
            <option value="">Any plan</option><option value="FREE">Free</option><option value="STARTER">Starter</option><option value="STANDARD">Standard</option><option value="PREMIUM">Premium</option>
          </Select>
        </Toolbar>
        <DataTable<GroupRow>
          data={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={(g) => router.push(`/platform/groups/${g.id}`)}
          empty="No groups match"
          server={list.data ? { page, pageSize: 25, total: list.data.total, onPageChange: setPage } : undefined}
          columns={[
            { accessorKey: 'name', header: 'Group', enableSorting: false, cell: ({ row }) => <span><span className="font-medium">{row.original.name}</span><span className="block font-mono text-2xs text-muted">{row.original.id}</span></span> },
            { accessorKey: 'countryCode', header: 'Country', enableSorting: false, cell: ({ row }) => `${row.original.countryCode} · ${row.original.currency}` },
            { accessorKey: 'members', header: 'Members', enableSorting: false, meta: { align: 'right' } },
            { accessorKey: 'plan', header: 'Plan', enableSorting: false },
            { accessorKey: 'subscriptionStatus', header: 'Subscription', enableSorting: false, cell: ({ row }) => (row.original.subscriptionStatus ? <StatusBadge status={row.original.subscriptionStatus} /> : 'Free') },
            { accessorKey: 'createdAt', header: 'Created', enableSorting: false, cell: ({ row }) => date(row.original.createdAt) },
            { accessorKey: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
          ]}
        />
      </Panel>
    </>
  );
}
