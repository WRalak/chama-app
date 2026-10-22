'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { useState } from 'react';
import type { GroupStatement, LedgerLine } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api, fileUrl } from '@/lib/api';
import { useGroupId } from '@/lib/session';
import { cn, date, dateTime, kes } from '@/lib/utils';

type Published = { id: string; from: string; to: string; publishedAt: string; closingBalanceCents: number };

const txCols: ColumnDef<LedgerLine, unknown>[] = [
  { header: 'Date', accessorKey: 'date', cell: ({ row }) => date(row.original.date) },
  { header: 'Type', accessorKey: 'type' },
  { header: 'Member', accessorKey: 'memberName', cell: ({ row }) => row.original.memberName ?? '—' },
  { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
  { header: 'In', accessorKey: 'inflowCents', meta: { align: 'right' }, cell: ({ row }) => (row.original.inflowCents ? kes(row.original.inflowCents) : '') },
  { header: 'Out', accessorKey: 'outflowCents', meta: { align: 'right' }, cell: ({ row }) => (row.original.outflowCents ? kes(row.original.outflowCents) : '') },
  { header: 'Balance', accessorKey: 'balanceCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.balanceCents) },
];

/** Group statements the officers have published to all members. */
export default function GroupStatementsPage() {
  const groupId = useGroupId();
  const list = useQuery({ queryKey: ['statements', groupId], queryFn: () => api<Published[]>(`groups/${groupId}/statements`) });
  const [sel, setSel] = useState<string | null>(null);
  const id = sel ?? list.data?.[0]?.id ?? null;
  const s = useQuery({ queryKey: ['statement', groupId, id], queryFn: () => api<GroupStatement>(`groups/${groupId}/statements/${id}`), enabled: !!id });
  const d = s.data;
  return (
    <>
      <PageHeader title="Group statements" description="Statements published by your officers, from the group’s confirmed ledger." />
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <LoadingRows /> : list.data.length === 0 ? (
        <Panel><EmptyState title="No statements published yet" description="Your treasurer publishes a statement at the end of each period." /></Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr] [&>*]:min-w-0">
          <Panel title="Published" flush>
            <ul className="divide-y divide-line">
              {list.data.map((x) => (
                <li key={x.id}>
                  <button onClick={() => setSel(x.id)} aria-current={x.id === id} className={cn('w-full px-4 py-3 text-left text-sm hover:bg-canvas', x.id === id && 'bg-blush/60')}>
                    <span className="block font-medium text-plum">{date(x.from)} – {date(x.to)}</span>
                    <span className="text-xs text-muted">Published {dateTime(x.publishedAt)} · closing {kes(x.closingBalanceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="space-y-4">
            {s.error ? <ErrorState error={s.error} onRetry={s.refetch} /> : !d ? <LoadingRows /> : (
              <>
                <Panel title={`${d.groupName} · ${date(d.from)} – ${date(d.to)}`} actions={<Button asChild size="sm" variant="secondary"><a href={fileUrl(`groups/${groupId}/statements/${id}/pdf`)} download><Download className="h-4 w-4" />Download PDF</a></Button>}>
                  <KeyValues items={[
                    ['Opening balance', kes(d.openingBalanceCents)],
                    ['Contributions received', kes(d.contributionsCents)],
                    ['Loan repayments', kes(d.loanRepaymentsCents)],
                    ['Interest received', kes(d.interestReceivedCents)],
                    ['Fines received', kes(d.finesReceivedCents)],
                    ['Other income', kes(d.otherIncomeCents)],
                    ['Expenses', `(${kes(d.expensesCents)})`],
                    ['Loans disbursed', `(${kes(d.loansDisbursedCents)})`],
                    ['Rotation payouts', `(${kes(d.payoutsCents)})`],
                    ['Distributions', `(${kes(d.distributionsCents)})`],
                    ['Closing balance', <strong key="c">{kes(d.closingBalanceCents)}</strong>],
                    ['Loans outstanding (owed to the group, not cash)', kes(d.loansOutstandingCents)],
                  ]} />
                </Panel>
                <Panel title={`Transactions (${d.transactions.length})`} flush>
                  <DataTable columns={txCols} data={d.transactions} empty="No transactions in this period" />
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
