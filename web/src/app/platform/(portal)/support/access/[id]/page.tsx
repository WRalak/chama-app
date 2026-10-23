'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatMoney } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { date, dateTime } from '@/lib/utils';

interface Records {
  group: { id: string; name: string; currency: string };
  expiresAt: string;
  members: { name: string; role: string; status: string; joinedAt: string }[];
  payments: { id: string; member: string | null; amountMinor: number; currency: string; purpose: string; status: string; method: string; reference: string | null; paidAt: string }[];
  loans: { id: string; member: string; principalMinor: number; interestMinor: number; status: string; appliedAt: string; disbursedAt: string | null }[];
}

/** The read-only view an approved grant allows. Nothing here can be changed, and opening it is recorded. */
export default function GrantRecordsPage() {
  const { id } = useParams<{ id: string }>();
  const r = useQuery({ queryKey: ['support-grant-records', id], queryFn: () => api<Records>(`platform/support-access/${id}/records`), retry: false });
  if (r.error) return <Panel><ErrorState error={r.error} /></Panel>;
  if (!r.data) return <Panel><LoadingRows rows={8} /></Panel>;
  const d = r.data;
  return (
    <>
      <PageHeader title={d.group.name} description={`Read-only access until ${dateTime(d.expiresAt)}.`} actions={<Link href="/platform/support/access" className="text-sm text-berry hover:underline">All requests</Link>} />
      <p className="mb-5 flex items-center gap-2 rounded-lg bg-blush/50 px-3 py-2 text-sm text-plum"><Eye className="h-4 w-4" aria-hidden /> This view is logged in ChamaHub's audit trail and the group's own. Corrections are made by the group's officers.</p>
      <div className="space-y-5">
        <Panel title={`Members (${d.members.length})`} flush>
          <DataTable data={d.members} columns={[{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'role', header: 'Role' }, { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> }, { accessorKey: 'joinedAt', header: 'Joined', cell: ({ row }) => date(row.original.joinedAt) }]} />
        </Panel>
        <Panel title="Recent payments (latest 100)" flush>
          <DataTable
            data={d.payments}
            empty="No payments recorded"
            columns={[
              { accessorKey: 'paidAt', header: 'Date', cell: ({ row }) => date(row.original.paidAt) },
              { accessorKey: 'member', header: 'Member', cell: ({ row }) => row.original.member ?? '—' },
              { accessorKey: 'purpose', header: 'Purpose', cell: ({ row }) => row.original.purpose.toLowerCase().replace(/_/g, ' ') },
              { accessorKey: 'amountMinor', header: 'Amount', meta: { align: 'right' }, cell: ({ row }) => formatMoney(row.original.amountMinor, row.original.currency) },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => row.original.reference ?? '—' },
            ]}
          />
        </Panel>
        <Panel title="Loans (latest 50)" flush>
          <DataTable
            data={d.loans}
            empty="No loans"
            columns={[
              { accessorKey: 'appliedAt', header: 'Applied', cell: ({ row }) => date(row.original.appliedAt) },
              { accessorKey: 'member', header: 'Member' },
              { accessorKey: 'principalMinor', header: 'Principal', meta: { align: 'right' }, cell: ({ row }) => formatMoney(row.original.principalMinor, d.group.currency) },
              { accessorKey: 'interestMinor', header: 'Interest', meta: { align: 'right' }, cell: ({ row }) => formatMoney(row.original.interestMinor, d.group.currency) },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
