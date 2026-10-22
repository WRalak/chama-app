'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { addMonths, LABELS, todayInNairobi, type PaymentItem, type PersonalStatement } from '@chamahub/shared';
import { PaymentDrawer } from '@/components/domain/payment-drawer';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { MoneyCard, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api, fileUrl } from '@/lib/api';
import { cn, date, kes } from '@/lib/utils';

const PERIODS = { '3m': '3 months', '6m': '6 months', '12m': '12 months', ytd: 'This year' } as const;
type Period = keyof typeof PERIODS;
const PURPOSE: Record<string, string> = { CONTRIBUTION: 'Contribution', LOAN_REPAYMENT: 'Loan repayment', FINE: 'Fine' };

/** The member's own money across all their Chamas: statement, payments and the PDF. Confirmed records only. */
export default function FinancesPage() {
  const t = todayInNairobi();
  const [period, setPeriod] = useState<Period>('12m');
  const from = period === 'ytd' ? `${t.slice(0, 4)}-01-01` : addMonths(t, -Number(period.replace('m', '')));
  const s = useQuery({ queryKey: ['statement', from, t], queryFn: () => api<PersonalStatement>('me/statement', { query: { from, to: t } }) });
  const payments = useQuery({ queryKey: ['my-payments'], queryFn: () => api<PaymentItem[]>('me/payments', { query: { limit: 100 } }) });
  const [selected, setSelected] = useState<PaymentItem | null>(null);
  const tot = s.data?.totals;

  const cols: ColumnDef<PaymentItem, unknown>[] = [
    { header: 'Date', accessorKey: 'paidAt', cell: ({ row }) => date(row.original.paidAt) },
    { header: 'Chama', accessorKey: 'groupName' },
    { header: 'For', accessorKey: 'purpose', cell: ({ row }) => PURPOSE[row.original.purpose] ?? row.original.purpose },
    { header: 'Method', accessorKey: 'method', cell: ({ row }) => LABELS.paymentMethod[row.original.method] },
    { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
    { header: 'Amount', accessorKey: 'amountCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.amountCents) },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="My finances"
        description={`${date(from)} – ${date(t)} · all your Chamas · confirmed records only`}
        actions={<Button asChild variant="secondary"><a href={fileUrl('me/statement/pdf', { from, to: t })} download><Download className="h-4 w-4" />Download statement (PDF)</a></Button>}
      />
      <div role="radiogroup" aria-label="Period" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <button key={p} role="radio" aria-checked={period === p} onClick={() => setPeriod(p)} className={cn('rounded-full border px-3 py-1 text-sm', period === p ? 'border-rose bg-blush font-medium text-berry' : 'border-line bg-white text-muted hover:text-plum')}>
            {PERIODS[p]}
          </button>
        ))}
      </div>
      {s.error ? <ErrorState error={s.error} onRetry={s.refetch} /> : !tot ? <LoadingRows rows={3} /> : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          <MoneyCard label="Contributions confirmed" amount={kes(tot.contributionsCents)} status={<Badge tone="green">Confirmed</Badge>} hint={tot.outstandingContributionsCents ? `${kes(tot.outstandingContributionsCents)} still owed` : 'Nothing owed for this period'} />
          <MoneyCard label="Payouts received" amount={kes(tot.payoutsReceivedCents)} hint={`Distributions: ${kes(tot.distributionsReceivedCents)}`} />
          <MoneyCard label="Loans received" amount={kes(tot.loansReceivedCents)} hint="Borrowed, not income" />
          <MoneyCard label="Loan repayments" amount={kes(tot.loanRepaymentsCents + tot.interestPaidCents)} hint={`Including ${kes(tot.interestPaidCents)} interest`} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Panel title="My payments" flush>
          <DataTable columns={cols} data={payments.data} loading={payments.isLoading} error={payments.error} onRetry={payments.refetch} onRowClick={setSelected} empty="No payments yet" pageSize={15} />
        </Panel>
        <div className="space-y-4">
          {s.data?.groups.map((g) => (
            <Panel key={g.groupId} title={g.groupName}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Your role</dt><dd>{LABELS.groupRole[g.role]}</dd>
                <dt className="text-muted">Contributions confirmed</dt><dd className="tabular-nums">{kes(g.contributionsCents)}</dd>
                <dt className="text-muted">Still owed</dt><dd className="tabular-nums">{kes(g.outstandingContributionsCents)}</dd>
                {g.loanBalanceCents > 0 && <><dt className="text-muted">Loan balance</dt><dd className="tabular-nums">{kes(g.loanBalanceCents)}</dd></>}
                {g.payoutsReceivedCents > 0 && <><dt className="text-muted">Payouts received</dt><dd className="tabular-nums">{kes(g.payoutsReceivedCents)}</dd></>}
                <dt className="text-muted">Shares held</dt><dd>{g.shares}</dd>
              </dl>
            </Panel>
          ))}
          {s.data?.notes.map((n) => <p key={n} className="rounded-md bg-canvas px-3 py-2 text-xs text-muted">{n}</p>)}
        </div>
      </div>
      <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
    </>
  );
}
