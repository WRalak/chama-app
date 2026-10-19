'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LABELS, LoanSummary, Paginated, PaymentItem, Permission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { PaymentDrawer } from '@/components/domain/payment-drawer';
import { RecordPaymentDialog } from '@/components/domain/record-payment';
import { api } from '@/lib/api';
import { useCan, useGroupId } from '@/lib/session';
import { date, kes } from '@/lib/utils';

export default function RepaymentsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [record, setRecord] = useState(false);
  const [selected, setSelected] = useState<PaymentItem | null>(null);
  const loans = useQuery({ queryKey: ['loans', groupId, 'DISBURSED'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'DISBURSED' } }) });
  const repayments = useQuery({
    queryKey: ['payments', groupId, 'repayments'],
    queryFn: async () => (await api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { pageSize: 200 } })).items.filter((p) => p.purpose === 'LOAN_REPAYMENT'),
  });
  const upcoming = (loans.data ?? []).filter((l) => l.nextInstallment).sort((a, b) => a.nextInstallment!.dueDate.localeCompare(b.nextInstallment!.dueDate));
  return (
    <>
      <PageHeader title="Repayments" description="Loan installments due and repayments received." actions={can(Permission.REPAYMENTS_RECORD) && <Button onClick={() => setRecord(true)}>Record repayment</Button>} />
      <StatStrip
        stats={[
          { label: 'Active loans', value: loans.data?.length ?? '—' },
          { label: 'Outstanding (incl. interest)', value: kes((loans.data ?? []).reduce((a, l) => a + l.outstandingCents, 0)) },
          { label: 'Overdue', value: kes((loans.data ?? []).reduce((a, l) => a + l.overdueCents, 0)), tone: (loans.data ?? []).some((l) => l.overdueCents) ? 'danger' : 'default' },
          { label: 'Repayments recorded', value: repayments.data?.length ?? '—' },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Next installments" flush>
          <DataTable<LoanSummary>
            data={upcoming}
            loading={loans.isLoading}
            empty="No installments due"
            columns={[
              { accessorKey: 'memberName', header: 'Member' },
              { id: 'due', header: 'Due', cell: ({ row }) => date(row.original.nextInstallment?.dueDate) },
              { id: 'amt', header: 'Amount', cell: ({ row }) => kes(row.original.nextInstallment?.amountCents), meta: { align: 'right' } },
              { accessorKey: 'overdueCents', header: 'Overdue', cell: ({ row }) => (row.original.overdueCents ? <span className="text-danger">{kes(row.original.overdueCents)}</span> : '—'), meta: { align: 'right' } },
            ]}
          />
        </Panel>
        <Panel title="Repayment history" flush>
          <DataTable<PaymentItem>
            data={repayments.data}
            loading={repayments.isLoading}
            error={repayments.error}
            onRowClick={setSelected}
            empty="No repayments yet"
            columns={[
              { accessorKey: 'paidAt', header: 'Date', cell: ({ row }) => date(row.original.paidAt) },
              { accessorKey: 'memberName', header: 'Member' },
              { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' } },
              { accessorKey: 'method', header: 'Method', cell: ({ row }) => LABELS.paymentMethod[row.original.method] },
              { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            ]}
          />
        </Panel>
      </div>
      <RecordPaymentDialog open={record} onOpenChange={setRecord} purpose="LOAN_REPAYMENT" />
      <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
    </>
  );
}
