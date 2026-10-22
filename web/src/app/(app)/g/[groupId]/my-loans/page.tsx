'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { LABELS, Permission, type LoanDetail, type LoanQuote, type LoanSummary } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { KeyValues, MoneyCard, PageHeader, Panel } from '@/components/ui/layout-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroup, useGroupId } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** The signed-in member's own loans in this Chama, and applying for a new one. */
export default function MyLoansPage() {
  const groupId = useGroupId();
  const group = useGroup();
  const can = useCan();
  const myId = group.data?.myMembership.membershipId;
  const loans = useQuery({ queryKey: ['loans', groupId, 'mine'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { memberId: myId } }), enabled: !!myId });
  const mine = (loans.data ?? []).filter((l) => l.membershipId === myId);
  const [selected, setSelected] = useState<string | null>(null);
  const balance = mine.reduce((s, l) => s + (l.status === 'DISBURSED' ? l.outstandingCents : 0), 0);
  const overdue = mine.reduce((s, l) => s + l.overdueCents, 0);
  const next = mine.map((l) => l.nextInstallment).filter(Boolean).sort((a, b) => a!.dueDate.localeCompare(b!.dueDate))[0];

  const cols: ColumnDef<LoanSummary, unknown>[] = [
    { header: 'Applied', accessorKey: 'appliedAt', cell: ({ row }) => date(row.original.appliedAt) },
    { header: 'Purpose', accessorKey: 'purpose' },
    { header: 'Principal', accessorKey: 'principalCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.principalCents) },
    { header: 'Total to repay', accessorKey: 'totalRepayableCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.totalRepayableCents) },
    { header: 'Outstanding', accessorKey: 'outstandingCents', meta: { align: 'right' }, cell: ({ row }) => <strong>{kes(row.original.outstandingCents)}</strong> },
    { header: 'Next payment', id: 'next', cell: ({ row }) => (row.original.nextInstallment ? `${kes(row.original.nextInstallment.amountCents)} by ${date(row.original.nextInstallment.dueDate)}` : '—') },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  return (
    <>
      <PageHeader title="My loans" description="Your loans in this Chama, their repayment schedules and approvals." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <MoneyCard label="Loan balance" amount={kes(balance)} hint="Disbursed loans, confirmed repayments deducted" />
        <MoneyCard label="Overdue" amount={kes(overdue)} status={overdue > 0 ? <StatusBadge status="OVERDUE" /> : undefined} />
        <MoneyCard label="Next installment" amount={next ? kes(next.amountCents) : '—'} hint={next ? `Due ${date(next.dueDate)}` : 'Nothing scheduled'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <Panel title="Loans" flush>
          <DataTable columns={cols} data={mine} loading={loans.isLoading || !myId} error={loans.error} onRetry={loans.refetch} onRowClick={(l) => setSelected(l.id)} empty="No loans yet" />
        </Panel>
        {group.data && !group.data.loanPolicy.enabled ? (
          <Panel title="Apply for a loan"><p className="text-sm text-muted">This Chama does not offer loans at the moment. Your officers can turn loans on in the group settings.</p></Panel>
        ) : can(Permission.LOANS_APPLY) && <Apply onApplied={setSelected} />}
      </div>
      <MyLoanDrawer loanId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Apply({ onApplied }: { onApplied: (id: string) => void }) {
  const groupId = useGroupId();
  const group = useGroup();
  const [cents, setCents] = useState<number | undefined>(500_000);
  const [n, setN] = useState(3);
  const [purpose, setPurpose] = useState('');
  const dc = useDebounced(cents);
  const dn = useDebounced(n);
  const quote = useQuery({ queryKey: ['quote', groupId, dc, dn], queryFn: () => api<LoanQuote>(`groups/${groupId}/loans/quote`, { query: { principalCents: dc, installments: dn } }), enabled: !!dc && dc > 0 && dn >= 1 });
  const apply = useAction(() => api<{ id: string }>(`groups/${groupId}/loans`, { body: { principalCents: cents, installments: n, purpose, guarantorMemberIds: [] } }), {
    success: 'Application submitted. Officers will review it.',
    invalidate: [['loans', groupId], ['me', 'dashboard']],
    onSuccess: (l) => { setPurpose(''); onApplied(l.id); },
  });
  const q = quote.data;
  const elig = q?.eligibility;
  const max = group.data?.loanPolicy.maxInstallments ?? 120;
  return (
    <Panel title="Apply for a loan">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount to borrow" htmlFor="ln-amt"><MoneyInput id="ln-amt" value={cents} onChange={setCents} /></Field>
          <Field label="Installments" htmlFor="ln-n" hint={`Up to ${max}`}><Input id="ln-n" type="number" min={1} max={max} value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} /></Field>
        </div>
        {quote.error && <p className="text-sm text-danger" role="alert">{(quote.error as Error).message}</p>}
        {elig && !elig.eligible && <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-ink" role="alert">{elig.reasons.join(' ')}</p>}
        {elig?.limitCents != null && <p className="text-xs text-muted">Your current limit: {kes(elig.limitCents)}</p>}
        {q && (
          <>
            <KeyValues items={[['Interest', kes(q.totalInterestCents)], ['Total to repay', <strong key="t">{kes(q.totalRepayableCents)}</strong>]]} />
            <details className="text-sm">
              <summary className="cursor-pointer text-berry">Estimated schedule ({q.installments.length} installments)</summary>
              <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                {q.installments.map((i) => <li key={i.number} className="flex justify-between px-3 py-1.5"><span>{i.number}. {date(i.dueDate)}</span><span className="tabular-nums">{kes(i.totalCents)}</span></li>)}
              </ul>
              <p className="mt-1 text-xs text-muted">Final dates are set when the treasurer disburses the loan.</p>
            </details>
          </>
        )}
        <Field label="What is the loan for?" htmlFor="ln-purpose"><Input id="ln-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. School fees" /></Field>
        <Button onClick={() => apply.mutate(undefined)} loading={apply.isPending} disabled={!elig?.eligible || purpose.trim().length < 3 || !cents}>Submit application</Button>
        <p className="text-xs text-muted">Officers review and approve applications. You cannot approve your own loan.</p>
      </div>
    </Panel>
  );
}

function MyLoanDrawer({ loanId, onClose }: { loanId: string | null; onClose: () => void }) {
  const groupId = useGroupId();
  const loan = useQuery({ queryKey: ['loan', groupId, loanId], queryFn: () => api<LoanDetail>(`groups/${groupId}/loans/${loanId}`), enabled: !!loanId });
  const cancel = useAction(() => api(`groups/${groupId}/loans/${loanId}/cancel`, { method: 'POST' }), { success: 'Application cancelled', invalidate: [['loans', groupId], ['loan', groupId, loanId]], onSuccess: onClose });
  const l = loan.data;
  return (
    <Sheet open={!!loanId} onOpenChange={(o) => !o && onClose()} title={l ? `${kes(l.principalCents)} · ${l.purpose}` : 'Loan'} subtitle={l ? <StatusBadge status={l.status} /> : undefined}>
      {!l ? <p className="text-sm text-muted">Loading…</p> : (
        <div className="space-y-5">
          {l.status === 'PENDING_APPROVAL' && <p className="rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Waiting for approval: {l.approvalsReceived} of {l.approvalsRequired}.</p>}
          {l.status === 'APPROVED' && <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink">Approved. The treasurer will disburse it and set your repayment dates.</p>}
          <KeyValues items={[
            ['Principal', kes(l.principalCents)],
            ['Interest', `${kes(l.interestCents)} · ${LABELS.interestMethod[l.interestMethod]} at ${(l.rateBps / 100).toFixed(2)}%`],
            ['Total to repay', kes(l.totalRepayableCents)],
            ['Paid (confirmed)', kes(l.paidCents)],
            ['Outstanding', kes(l.outstandingCents)],
            ['Disbursed', l.disbursedAt ? `${date(l.disbursedAt)}${l.disbursementReference ? ` · ${l.disbursementReference}` : ''}` : '—'],
          ]} />
          {l.schedule.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Repayment schedule</h3>
              <ul className="divide-y divide-line rounded-md border border-line text-sm">
                {l.schedule.map((i) => <li key={i.id} className="flex items-center justify-between gap-2 px-3 py-2"><span>{i.number}. {date(i.dueDate)}<span className="block text-xs text-muted">Paid {kes(i.paidCents)}</span></span><span className="flex items-center gap-2"><span className="tabular-nums">{kes(i.totalCents)}</span><StatusBadge status={i.status} /></span></li>)}
              </ul>
            </section>
          )}
          {l.repayments.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Repayments</h3>
              <ul className="divide-y divide-line rounded-md border border-line text-sm">
                {l.repayments.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2"><span>{date(p.paidAt)}{p.reference && <span className="ml-1 font-mono text-xs text-muted">{p.reference}</span>}</span><span className="flex items-center gap-2"><span className="tabular-nums">{kes(p.amountCents)}</span><StatusBadge status={p.status} /></span></li>)}
              </ul>
            </section>
          )}
          {l.approvals.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Approvals</h3>
              <ul className="divide-y divide-line rounded-md border border-line text-sm">
                {l.approvals.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2"><span>{a.approverName}<span className="block text-xs text-muted">{LABELS.groupRole[a.approverRole]} · {dateTime(a.createdAt)}{a.comment ? ` · ${a.comment}` : ''}</span></span><StatusBadge status={a.decision} /></li>)}
              </ul>
            </section>
          )}
          {['PENDING_APPROVAL', 'APPROVED'].includes(l.status) && <Button variant="secondary" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}>Cancel application</Button>}
        </div>
      )}
    </Sheet>
  );
}
