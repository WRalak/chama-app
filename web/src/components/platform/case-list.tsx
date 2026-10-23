'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Paginated, SUPPORT_CATEGORIES, SUPPORT_LABELS, SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SupportCaseRow } from '@chamahub/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/input';
import { Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/utils';

export const CASE_STATUS_TONE: Record<string, Tone> = { OPEN: 'amber', ASSIGNED: 'blue', IN_PROGRESS: 'blue', WAITING_FOR_USER: 'neutral', ESCALATED: 'red', RESOLVED: 'green', CLOSED: 'neutral' };
export const PRIORITY_TONE: Record<string, Tone> = { LOW: 'neutral', NORMAL: 'neutral', HIGH: 'amber', URGENT: 'red' };

export function CaseStatus({ status }: { status: SupportCaseRow['status'] }) {
  return <Badge tone={CASE_STATUS_TONE[status]}>{SUPPORT_LABELS.status[status] === 'Waiting for you' ? 'Waiting for user' : SUPPORT_LABELS.status[status]}</Badge>;
}

/** Support queue. `scope` mine = assigned to me; the server limits helpers to their own cases whatever is asked. */
export function CaseList({ scope, initial }: { scope: 'mine' | 'all'; initial?: { status?: string; scope?: string } }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initial?.status ?? '');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState(scope === 'mine' ? 'mine' : (initial?.scope ?? 'all'));
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['support-cases', view, q, status, priority, category, page],
    queryFn: () => api<Paginated<SupportCaseRow>>('platform/support/cases', { query: { scope: view, q: q || undefined, status: status || undefined, priority: priority || undefined, category: category || undefined, page, pageSize: 25 } }),
    placeholderData: (p) => p,
    refetchInterval: 60_000,
  });
  const r = () => setPage(1);
  return (
    <Panel flush>
      <Toolbar>
        <Input className="max-w-xs" placeholder="Case number or subject" aria-label="Search cases" value={q} onChange={(e) => { setQ(e.target.value); r(); }} />
        {scope === 'all' && (
          <Select className="w-40" aria-label="Queue" value={view} onChange={(e) => { setView(e.target.value); r(); }}>
            <option value="all">All cases</option>
            <option value="unassigned">Unassigned</option>
            <option value="mine">Assigned to me</option>
          </Select>
        )}
        <Select className="w-44" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); r(); }}>
          <option value="">Any status</option>
          {SUPPORT_STATUSES.map((s) => <option key={s} value={s}>{SUPPORT_LABELS.status[s]}</option>)}
        </Select>
        <Select className="w-36" aria-label="Priority" value={priority} onChange={(e) => { setPriority(e.target.value); r(); }}>
          <option value="">Any priority</option>
          {SUPPORT_PRIORITIES.map((p) => <option key={p} value={p}>{SUPPORT_LABELS.priority[p]}</option>)}
        </Select>
        <Select className="w-56" aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); r(); }}>
          <option value="">Any category</option>
          {SUPPORT_CATEGORIES.map((c) => <option key={c} value={c}>{SUPPORT_LABELS.category[c]}</option>)}
        </Select>
      </Toolbar>
      <DataTable<SupportCaseRow>
        data={list.data?.items}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(c) => router.push(`/platform/support/${c.id}`)}
        empty={view === 'mine' ? 'No cases assigned to you' : 'No cases match'}
        emptyDescription={view === 'mine' ? 'A support manager assigns cases from the inbox.' : undefined}
        server={list.data ? { page, pageSize: 25, total: list.data.total, onPageChange: setPage } : undefined}
        columns={[
          { accessorKey: 'number', header: 'Case', enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span> },
          { accessorKey: 'subject', header: 'Subject', enableSorting: false, cell: ({ row }) => <span><span className="font-medium">{row.original.subject}</span><span className="block text-xs text-muted">{SUPPORT_LABELS.category[row.original.category]}</span></span> },
          { accessorKey: 'requesterName', header: 'Requester', enableSorting: false, cell: ({ row }) => <span>{row.original.requesterName}{row.original.groupName && <span className="block text-xs text-muted">{row.original.groupName}</span>}</span> },
          { accessorKey: 'priority', header: 'Priority', enableSorting: false, cell: ({ row }) => <Badge tone={PRIORITY_TONE[row.original.priority]} icon={false}>{SUPPORT_LABELS.priority[row.original.priority]}</Badge> },
          { accessorKey: 'status', header: 'Status', enableSorting: false, cell: ({ row }) => <CaseStatus status={row.original.status} /> },
          { id: 'assigned', header: 'Assigned to', cell: ({ row }) => row.original.assignedTo?.name ?? <span className="text-muted">Unassigned</span> },
          { accessorKey: 'updatedAt', header: 'Updated', enableSorting: false, cell: ({ row }) => dateTime(row.original.updatedAt) },
        ]}
      />
    </Panel>
  );
}
