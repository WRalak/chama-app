'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Paginated, PaymentItem, ReconciliationSummary, UnmatchedPayment } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, StatStrip, Toolbar } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { MemberSelect } from '@/components/domain/member-select';
import { PaymentDrawer } from '@/components/domain/payment-drawer';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGroupId } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

export default function CollectionsPage() {
  const groupId = useGroupId();
  const [range, setRange] = useState({ from: '', to: '' });
  const [match, setMatch] = useState<UnmatchedPayment | null>(null);
  const [memberId, setMemberId] = useState('');
  const [purpose, setPurpose] = useState<'CONTRIBUTION' | 'LOAN_REPAYMENT' | 'FINE'>('CONTRIBUTION');
  const [selected, setSelected] = useState<PaymentItem | null>(null);
  const rec = useQuery({ queryKey: ['reconciliation', groupId, range], queryFn: () => api<ReconciliationSummary>(`groups/${groupId}/reconciliation`, { query: { from: range.from || undefined, to: range.to || undefined } }) });
  const pending = useQuery({ queryKey: ['payments', groupId, 'reconcile-pending'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 100 } }) });
  const failed = useQuery({ queryKey: ['payments', groupId, 'reconcile-failed'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'FAILED', pageSize: 50 } }) });
  const invalidate = [['reconciliation', groupId], ['payments', groupId], ['ledger', groupId]];
  const doMatch = useAction(() => api(`groups/${groupId}/unmatched/${match!.id}/match`, { body: { memberId, purpose } }), { success: 'Payment matched and posted', invalidate, onSuccess: () => setMatch(null) });
  const ignore = useAction((id: string) => api(`groups/${groupId}/unmatched/${id}/ignore`, { body: { reason: 'Not a payment for this group' } }), { success: 'Marked as not for this group', invalidate });
  const r = rec.data;
  const pendingCols = [
    { accessorKey: 'paidAt', header: 'Date', cell: ({ row }: { row: { original: PaymentItem } }) => date(row.original.paidAt) },
    { accessorKey: 'memberName', header: 'Member' },
    { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }: { row: { original: PaymentItem } }) => kes(row.original.amountCents), meta: { align: 'right' } },
    { accessorKey: 'reference', header: 'Reference', cell: ({ row }: { row: { original: PaymentItem } }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
    { accessorKey: 'recordedByName', header: 'Recorded by' },
    { accessorKey: 'status', header: 'Status', cell: ({ row }: { row: { original: PaymentItem } }) => <StatusBadge status={row.original.status} /> },
  ];
  return (
    <>
      <PageHeader title="Collections" description="Reconcile what was expected against what was actually confirmed." />
      <Panel flush className="mb-5">
        <Toolbar>
          <Field label="Due from" htmlFor="r-from"><Input id="r-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Due to" htmlFor="r-to"><Input id="r-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </Toolbar>
      </Panel>
      {rec.error ? <ErrorState error={rec.error} onRetry={rec.refetch} /> : !r ? <LoadingRows rows={2} /> : (
        <StatStrip
          stats={[
            { label: 'Expected', value: kes(r.expectedCents) },
            { label: 'Confirmed', value: kes(r.confirmedCents), tone: 'success' },
            { label: 'Pending verification', value: kes(r.pendingCents), hint: `${r.pendingCount} payments`, tone: r.pendingCount ? 'warning' : 'default' },
            { label: 'Outstanding', value: kes(r.outstandingCents), tone: r.outstandingCents ? 'danger' : 'default' },
            { label: 'Unmatched / duplicates', value: `${r.unmatched.length} / ${r.duplicateReferences.length}`, tone: r.unmatched.length + r.duplicateReferences.length ? 'warning' : 'default' },
          ]}
        />
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Pending reconciliation" flush>
          <DataTable<PaymentItem> data={pending.data?.items} loading={pending.isLoading} error={pending.error} onRowClick={setSelected} columns={pendingCols} empty="Everything recorded has been verified" />
        </Panel>
        <Panel title="Unmatched incoming payments" flush>
          <p className="border-b border-line px-4 py-2 text-xs text-muted">M-Pesa paybill payments that could not be linked to a member automatically. Available once M-Pesa C2B is configured.</p>
          <DataTable<UnmatchedPayment>
            data={r?.unmatched}
            loading={rec.isLoading}
            empty="No unmatched payments"
            columns={[
              { accessorKey: 'receivedAt', header: 'Received', cell: ({ row }) => dateTime(row.original.receivedAt) },
              { accessorKey: 'payerName', header: 'Payer', cell: ({ row }) => <div>{row.original.payerName ?? '—'}<p className="text-xs text-muted">{row.original.payerPhone}</p></div> },
              { accessorKey: 'accountReference', header: 'Account ref' },
              { accessorKey: 'reference', header: 'M-Pesa ref', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
              { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' } },
              { id: 'a', header: '', cell: ({ row }) => <div className="flex gap-1"><Button size="sm" onClick={() => { setMatch(row.original); setMemberId(''); }}>Match</Button><Button size="sm" variant="ghost" onClick={() => ignore.mutate(row.original.id)}>Ignore</Button></div> },
            ]}
          />
        </Panel>
        <Panel title="Duplicate references" flush>
          {r?.duplicateReferences.length ? (
            <ul className="divide-y divide-line text-sm">
              {r.duplicateReferences.map((d) => (
                <li key={d.reference} className="flex justify-between px-4 py-2"><span className="font-mono">{d.reference}</span><span className="text-danger">{d.count} payments</span></li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-center text-sm text-muted">No duplicate references.</p>}
        </Panel>
        <Panel title="Failed transactions" flush>
          <DataTable<PaymentItem> data={failed.data?.items} loading={failed.isLoading} onRowClick={setSelected} columns={pendingCols} empty="No failed transactions" />
        </Panel>
      </div>
      <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
      <Dialog open={!!match} onOpenChange={(o) => !o && setMatch(null)}>
        <DialogContent title="Match incoming payment" description={match ? `${kes(match.amountCents)} from ${match.payerName ?? match.payerPhone ?? 'unknown'} · ${match.reference}` : undefined}>
          <div className="space-y-3">
            <Field label="Member" htmlFor="m-member"><MemberSelect id="m-member" value={memberId} onChange={setMemberId} /></Field>
            <Field label="Purpose" htmlFor="m-purpose">
              <Select id="m-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
                <option value="CONTRIBUTION">Contribution</option>
              </Select>
            </Field>
            <p className="text-xs text-muted">The payment was already confirmed by M-Pesa, so it posts to the ledger as soon as you match it. For loan repayments or fines, record them from the member’s loan or fine.</p>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setMatch(null)}>Cancel</Button><Button onClick={() => doMatch.mutate(undefined)} disabled={!memberId} loading={doMatch.isPending}>Match payment</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
