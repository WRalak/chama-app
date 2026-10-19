'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { addDays, LABELS, LOAN_STATUSES, LoanDetail, LoanQuote, LoanSummary, PAYMENT_METHODS, Permission, todayInNairobi } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { KeyValues, PageHeader, Panel, StatStrip, Toolbar } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { RecordPaymentDialog } from '@/components/domain/record-payment';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroup, useGroupId } from '@/lib/session';
import { date, dateTime, kes, newIdempotencyKey } from '@/lib/utils';

function Calculator() {
  const groupId = useGroupId();
  const group = useGroup();
  const [principal, setPrincipal] = useState<number | undefined>(1_000_000);
  const [n, setN] = useState(3);
  const valid = !!principal && principal > 0 && Number.isInteger(principal);
  const quote = useQuery({ queryKey: ['quote', groupId, principal, n], queryFn: () => api<LoanQuote>(`groups/${groupId}/loans/quote`, { query: { principalCents: principal, installments: n } }), enabled: valid });
  const p = group.data?.loanPolicy;
  return (
    <Panel title="Loan calculator">
      {p && <p className="mb-3 text-xs text-muted">Group policy: {LABELS.interestMethod[p.interestMethod]} at {(p.rateBps / 100).toFixed(2)}% per {LABELS.frequency[p.repaymentFrequency].toLowerCase().replace('every ', '')} period, up to {p.maxInstallments} installments.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Principal" htmlFor="c-p"><MoneyInput id="c-p" value={principal} onChange={setPrincipal} /></Field>
        <Field label="Installments" htmlFor="c-n"><Input id="c-n" type="number" min={1} max={p?.maxInstallments ?? 120} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value)))} /></Field>
      </div>
      {quote.data && (
        <div className="mt-4">
          <KeyValues items={[['Total interest', kes(quote.data.totalInterestCents)], ['Total repayable', <strong key="t">{kes(quote.data.totalRepayableCents)}</strong>]]} />
          <table className="mt-3 w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">#</th><th className="py-1 font-medium">Due</th><th className="py-1 text-right font-medium">Principal</th><th className="py-1 text-right font-medium">Interest</th><th className="py-1 text-right font-medium">Total</th></tr></thead>
            <tbody>{quote.data.installments.map((i) => <tr key={i.number} className="border-t border-line"><td className="py-1">{i.number}</td><td>{date(i.dueDate)}</td><td className="text-right tabular-nums">{kes(i.principalCents)}</td><td className="text-right tabular-nums">{kes(i.interestCents)}</td><td className="text-right tabular-nums">{kes(i.totalCents)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {quote.error && <p className="mt-3 text-sm text-danger">{(quote.error as Error).message}</p>}
    </Panel>
  );
}

function LoanDrawer({ loanId, onClose }: { loanId: string | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const [comment, setComment] = useState('');
  const [repay, setRepay] = useState(false);
  const [disb, setDisb] = useState({ method: 'MPESA', reference: '', disbursedAt: todayInNairobi(), firstDueDate: addDays(todayInNairobi(), 30), key: newIdempotencyKey() });
  const loan = useQuery({ queryKey: ['loan', groupId, loanId], queryFn: () => api<LoanDetail>(`groups/${groupId}/loans/${loanId}`), enabled: !!loanId });
  const inv = [['loans', groupId], ['loan', groupId, loanId], ['overview', groupId]];
  const decide = useAction((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/loans/${loanId}/decision`, { body: { decision, comment: comment || undefined } }), { success: 'Decision recorded', invalidate: inv });
  const disburse = useAction(() => api(`groups/${groupId}/loans/${loanId}/disburse`, { body: { method: disb.method, reference: disb.reference || undefined, disbursedAt: disb.disbursedAt, firstDueDate: disb.firstDueDate, idempotencyKey: disb.key } }), { success: 'Loan disbursed and repayment schedule created', invalidate: inv });
  const cancel = useAction(() => api(`groups/${groupId}/loans/${loanId}/cancel`, { method: 'POST' }), { success: 'Application cancelled', invalidate: inv });
  const l = loan.data;
  return (
    <Sheet open={!!loanId} onOpenChange={(o) => !o && onClose()} title={l ? `${l.memberName} · ${kes(l.principalCents)}` : 'Loan'} subtitle={l && <span className="flex items-center gap-2"><StatusBadge status={l.status} /> {l.purpose}</span>} width="max-w-2xl">
      {!l ? <LoadingRows /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
            {[['Principal', l.principalCents], ['Interest', l.interestCents], ['Paid', l.paidCents], ['Outstanding', l.outstandingCents]].map(([k, v]) => (
              <div key={k as string} className="bg-white px-3 py-2"><p className="text-2xs text-muted">{k}</p><p className="text-sm font-semibold tabular-nums">{kes(v as number)}</p></div>
            ))}
          </div>
          <KeyValues items={[['Interest method', LABELS.interestMethod[l.interestMethod]], ['Rate', `${(l.rateBps / 100).toFixed(2)}% per period`], ['Installments', l.installments], ['Applied', dateTime(l.appliedAt)], ['Disbursed', l.disbursedAt ? `${date(l.disbursedAt)} · ${l.disbursementReference ?? ''}` : '—'], ['Guarantors', l.guarantors.map((g) => g.name).join(', ') || '—'], ['Overdue', l.overdueCents ? <span key="o" className="text-danger">{kes(l.overdueCents)}</span> : '—']]} />
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Approvals ({l.approvalsReceived}/{l.approvalsRequired})</h3>
            {l.approvals.length === 0 ? <p className="text-sm text-muted">No decisions yet.</p> : <ul className="space-y-1 text-sm">{l.approvals.map((a) => <li key={a.id}><StatusBadge status={a.decision} /> {a.approverName} ({LABELS.groupRole[a.approverRole]}) · {dateTime(a.createdAt)}{a.comment && <span className="text-muted"> — {a.comment}</span>}</li>)}</ul>}
          </div>
          {l.canApprove && (
            <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
              <Field label="Comment" htmlFor="l-c"><Textarea id="l-c" rows={2} className="min-h-0 bg-white" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              <div className="flex gap-2"><Button onClick={() => decide.mutate('APPROVE')} loading={decide.isPending}>Approve</Button><Button variant="danger" onClick={() => decide.mutate('REJECT')} loading={decide.isPending}>Reject</Button></div>
            </div>
          )}
          {l.canDisburse && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <h3 className="text-sm font-semibold">Disburse</h3>
              <p className="text-xs text-muted">Disbursement is blocked if the ledger shows insufficient group cash.</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Method" htmlFor="d-m"><Select id="d-m" value={disb.method} onChange={(e) => setDisb({ ...disb, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABELS.paymentMethod[m]}</option>)}</Select></Field>
                <Field label="Reference" htmlFor="d-r"><Input id="d-r" value={disb.reference} onChange={(e) => setDisb({ ...disb, reference: e.target.value })} /></Field>
                <Field label="Disbursed on" htmlFor="d-d"><Input id="d-d" type="date" max={todayInNairobi()} value={disb.disbursedAt} onChange={(e) => setDisb({ ...disb, disbursedAt: e.target.value })} /></Field>
                <Field label="First installment due" htmlFor="d-f"><Input id="d-f" type="date" value={disb.firstDueDate} onChange={(e) => setDisb({ ...disb, firstDueDate: e.target.value })} /></Field>
              </div>
              <Button onClick={() => disburse.mutate(undefined)} loading={disburse.isPending}>Record disbursement</Button>
            </div>
          )}
          {['PENDING_APPROVAL', 'APPROVED'].includes(l.status) && can(Permission.LOANS_APPROVE) && <Button variant="ghost" onClick={() => cancel.mutate(undefined)}>Cancel application</Button>}
          {l.schedule.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Repayment schedule</h3>{l.status === 'DISBURSED' && can(Permission.REPAYMENTS_RECORD) && <Button size="sm" onClick={() => setRepay(true)}>Record repayment</Button>}</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">#</th><th className="font-medium">Due</th><th className="text-right font-medium">Principal</th><th className="text-right font-medium">Interest</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Status</th></tr></thead>
                <tbody>{l.schedule.map((i) => <tr key={i.id} className="border-t border-line"><td className="py-1.5">{i.number}</td><td>{date(i.dueDate)}</td><td className="text-right tabular-nums">{kes(i.principalCents)}</td><td className="text-right tabular-nums">{kes(i.interestCents)}</td><td className="text-right tabular-nums">{kes(i.paidCents)}</td><td className="text-right"><StatusBadge status={i.status} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
          {l.repayments.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Repayment history</h3>
              <ul className="divide-y divide-line rounded-md border border-line text-sm">{l.repayments.map((p) => <li key={p.id} className="flex items-center justify-between px-3 py-2"><span>{date(p.paidAt)} · {p.reference ?? LABELS.paymentMethod[p.method]}</span><span className="flex items-center gap-2 tabular-nums">{kes(p.amountCents)} <StatusBadge status={p.status} /></span></li>)}</ul>
            </div>
          )}
          <RecordPaymentDialog open={repay} onOpenChange={setRepay} purpose="LOAN_REPAYMENT" memberId={l.membershipId} targetId={l.id} />
        </div>
      )}
    </Sheet>
  );
}

export default function LoansPage() {
  const groupId = useGroupId();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const loans = useQuery({ queryKey: ['loans', groupId, 'all'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`) });
  const all = loans.data ?? [];
  const rows = all.filter((l) => !status || (status === 'OVERDUE' ? l.overdueCents > 0 : l.status === status));
  const active = all.filter((l) => l.status === 'DISBURSED');
  return (
    <>
      <PageHeader title="Loans" description="Applications, approvals, disbursements and the loan portfolio." />
      <StatStrip
        stats={[
          { label: 'Pending approval', value: all.filter((l) => l.status === 'PENDING_APPROVAL').length, tone: all.some((l) => l.status === 'PENDING_APPROVAL') ? 'warning' : 'default' },
          { label: 'Approved, not disbursed', value: all.filter((l) => l.status === 'APPROVED').length },
          { label: 'Outstanding principal + interest', value: kes(active.reduce((a, l) => a + l.outstandingCents, 0)) },
          { label: 'Interest on active loans', value: kes(active.reduce((a, l) => a + l.interestCents, 0)), hint: 'Recognised as income only when paid' },
          { label: 'Overdue', value: kes(all.reduce((a, l) => a + l.overdueCents, 0)), tone: all.some((l) => l.overdueCents) ? 'danger' : 'default' },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Panel flush>
          <Toolbar>
            <Input className="max-w-xs" placeholder="Search member" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All loans</option>
              {LOAN_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
              <option value="OVERDUE">With overdue installments</option>
            </Select>
          </Toolbar>
          <DataTable<LoanSummary>
            data={rows}
            loading={loans.isLoading}
            error={loans.error}
            globalFilter={q}
            onRowClick={(l) => setSel(l.id)}
            empty="No loans"
            columns={[
              { accessorKey: 'memberName', header: 'Member' },
              { accessorKey: 'appliedAt', header: 'Applied', cell: ({ row }) => date(row.original.appliedAt) },
              { accessorKey: 'principalCents', header: 'Principal', cell: ({ row }) => kes(row.original.principalCents), meta: { align: 'right' } },
              { accessorKey: 'interestCents', header: 'Interest', cell: ({ row }) => kes(row.original.interestCents), meta: { align: 'right' } },
              { accessorKey: 'outstandingCents', header: 'Outstanding', cell: ({ row }) => kes(row.original.outstandingCents), meta: { align: 'right' } },
              { id: 'next', header: 'Next due', cell: ({ row }) => (row.original.nextInstallment ? `${date(row.original.nextInstallment.dueDate)}` : '—') },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <span className="flex gap-1"><StatusBadge status={row.original.status} />{row.original.overdueCents > 0 && <StatusBadge status="OVERDUE" />}</span> },
              { id: 'ap', header: 'Approvals', cell: ({ row }) => (row.original.status === 'PENDING_APPROVAL' ? `${row.original.approvalsReceived}/${row.original.approvalsRequired}` : '') },
            ]}
          />
        </Panel>
        <Calculator />
      </div>
      <LoanDrawer loanId={sel} onClose={() => setSel(null)} />
    </>
  );
}
