'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { addMonths, DISTRIBUTION_METHODS, DistributionMethod, DistributionRecord, DistributionResult, LABELS, PAYMENT_METHODS, Permission, todayInNairobi } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { dateTime, date, kes, newIdempotencyKey } from '@/lib/utils';

function Breakdown({ r }: { r: DistributionResult }) {
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-line"><td className="py-1.5">Available cash (confirmed, per ledger)</td><td className="text-right tabular-nums">{kes(r.availableCashCents)}</td></tr>
          <tr className="border-b border-line"><td className="py-1.5">Less: liabilities</td><td className="text-right tabular-nums">({kes(r.liabilitiesCents)})</td></tr>
          <tr className="border-b border-line"><td className="py-1.5">Less: retained funds</td><td className="text-right tabular-nums">({kes(r.retainedCents)})</td></tr>
          <tr className="border-b border-line font-semibold"><td className="py-1.5">Distributable amount</td><td className="text-right tabular-nums">{kes(r.distributableCents)}</td></tr>
          <tr className="border-b border-line font-semibold text-forest"><td className="py-1.5">To be distributed</td><td className="text-right tabular-nums">{kes(r.distributedCents)}</td></tr>
          <tr><td className="py-1.5 text-muted">Outstanding member loans (not cash, not distributable)</td><td className="text-right tabular-nums text-muted">{kes(r.outstandingLoansCents)}</td></tr>
        </tbody>
      </table>
      {r.warnings.map((w) => <p key={w} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{w}</p>)}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5 font-medium">Member</th><th className="text-right font-medium">Basis</th><th className="text-right font-medium">Gross</th><th className="text-right font-medium">Loan offset</th><th className="text-right font-medium">Net payable</th></tr></thead>
        <tbody>
          {r.allocations.map((a) => (
            <tr key={a.memberId} className="border-b border-line">
              <td className="py-1.5">{a.name}</td>
              <td className="text-right tabular-nums text-muted">{r.method === 'CONTRIBUTION_PROPORTIONAL' ? kes(a.weight) : r.method === 'SHARE_BASED' ? `${a.weight} shares` : 'equal'}</td>
              <td className="text-right tabular-nums">{kes(a.grossCents)}</td>
              <td className="text-right tabular-nums">{a.loanOffsetCents ? `(${kes(a.loanOffsetCents)})` : '—'}</td>
              <td className="text-right font-medium tabular-nums">{kes(a.netPayableCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted">Remainders from rounding are allocated one cent at a time by largest remainder, so the parts always add up exactly.</p>
    </div>
  );
}

function Calculator({ onCreated }: { onCreated: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const t = todayInNairobi();
  const [f, setF] = useState({ title: `Distribution ${t.slice(0, 4)}`, method: 'CONTRIBUTION_PROPORTIONAL' as DistributionMethod, periodFrom: addMonths(t, -12), periodTo: t, liabilitiesCents: 0 as number | undefined, retainedCents: 0 as number | undefined, amountToDistributeCents: undefined as number | undefined, offsetOutstandingLoans: true });
  const body = { ...f, liabilitiesCents: f.liabilitiesCents ?? 0, retainedCents: f.retainedCents ?? 0 };
  const [preview, setPreview] = useState<DistributionResult | null>(null);
  const run = useAction(() => api<DistributionResult>(`groups/${groupId}/distributions/preview`, { body }), { onSuccess: setPreview });
  const create = useAction(() => api(`groups/${groupId}/distributions`, { body }), { success: 'Distribution submitted for approval', invalidate: [['distributions', groupId]], onSuccess: () => { setPreview(null); onCreated(); } });
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <Panel title="Parameters">
        <div className="space-y-3">
          <Field label="Title" htmlFor="d-t"><Input id="d-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Method" htmlFor="d-m"><Select id="d-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as DistributionMethod })}>{DISTRIBUTION_METHODS.map((m) => <option key={m} value={m}>{LABELS.distributionMethod[m]}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Period from" htmlFor="d-f"><Input id="d-f" type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} /></Field>
            <Field label="Period to" htmlFor="d-to"><Input id="d-to" type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} /></Field>
          </div>
          <Field label="Liabilities to settle first" htmlFor="d-l"><MoneyInput id="d-l" value={f.liabilitiesCents} onChange={(v) => setF({ ...f, liabilitiesCents: v })} /></Field>
          <Field label="Funds to retain (reserve)" htmlFor="d-r"><MoneyInput id="d-r" value={f.retainedCents} onChange={(v) => setF({ ...f, retainedCents: v })} /></Field>
          <Field label="Cap amount (optional)" htmlFor="d-c" hint="Distribute at most this much, e.g. profits only."><MoneyInput id="d-c" value={f.amountToDistributeCents} onChange={(v) => setF({ ...f, amountToDistributeCents: v })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.offsetOutstandingLoans} onChange={(e) => setF({ ...f, offsetOutstandingLoans: e.target.checked })} /> Offset members’ outstanding loans</label>
          <Button className="w-full" variant="secondary" onClick={() => run.mutate(undefined)} loading={run.isPending}>Calculate</Button>
        </div>
      </Panel>
      <Panel title="Calculation" actions={preview && can(Permission.DISTRIBUTIONS_MANAGE) && <Button size="sm" onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={preview.distributedCents <= 0}>Submit for approval</Button>}>
        {preview ? <Breakdown r={preview} /> : <p className="py-8 text-center text-sm text-muted">Set the parameters and calculate. Nothing is saved until you submit.</p>}
      </Panel>
    </div>
  );
}

function DistributionDrawer({ d, onClose }: { d: DistributionRecord | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const [comment, setComment] = useState('');
  const [pay, setPay] = useState({ method: 'MPESA', reference: '', paidAt: todayInNairobi() });
  const inv = [['distributions', groupId]];
  const decide = useAction((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/distributions/${d!.id}/decision`, { body: { decision, comment: comment || undefined } }), { success: 'Decision recorded', invalidate: inv, onSuccess: onClose });
  const payOne = useAction((allocationId: string) => api(`groups/${groupId}/distributions/${d!.id}/allocations/${allocationId}/pay`, { body: { ...pay, reference: pay.reference || undefined, idempotencyKey: newIdempotencyKey() } }), { success: 'Payment recorded', invalidate: inv });
  const cancel = useAction(() => api(`groups/${groupId}/distributions/${d!.id}/cancel`, { body: { reason: comment } }), { success: 'Distribution cancelled', invalidate: inv, onSuccess: onClose });
  if (!d) return null;
  return (
    <Sheet open={!!d} onOpenChange={(o) => !o && onClose()} title={d.title} subtitle={<span className="flex items-center gap-2"><StatusBadge status={d.status} /> {LABELS.distributionMethod[d.method]} · {date(d.periodFrom)} – {date(d.periodTo)}</span>} width="max-w-3xl">
      <div className="space-y-5">
        <Breakdown r={d.calculation} />
        <KeyValues items={[['Prepared by', `${d.createdByName} · ${dateTime(d.createdAt)}`], ['Approvals', `${d.approvals.filter((a) => a.decision === 'APPROVED').length}/${d.approvalsRequired}${d.approvals.length ? ` — ${d.approvals.map((a) => `${a.approverName} (${a.decision.toLowerCase()})`).join(', ')}` : ''}`]]} />
        {d.status === 'PENDING_APPROVAL' && can(Permission.DISTRIBUTIONS_APPROVE) && (
          <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
            <p className="text-sm">Approving confirms the group has resolved this distribution. Cash is re-checked at approval.</p>
            <Field label="Comment" htmlFor="dd-c"><Textarea id="dd-c" rows={2} className="min-h-0 bg-white" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="flex gap-2"><Button onClick={() => decide.mutate('APPROVE')} loading={decide.isPending}>Approve</Button><Button variant="danger" onClick={() => decide.mutate('REJECT')}>Reject</Button></div>
          </div>
        )}
        {d.status === 'APPROVED' && can(Permission.DISTRIBUTIONS_MANAGE) && (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-line p-3">
            <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} aria-label="Method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABELS.paymentMethod[m]}</option>)}</Select>
            <Input placeholder="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} aria-label="Reference" />
            <Input type="date" max={todayInNairobi()} value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} aria-label="Date" />
          </div>
        )}
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-1.5 font-medium">Member</th><th className="text-right font-medium">Net payable</th><th className="pl-4 font-medium">Payout</th><th /></tr></thead>
          <tbody>
            {d.allocations.map((a) => (
              <tr key={a.id} className="border-b border-line">
                <td className="py-1.5">{a.memberName}</td>
                <td className="text-right tabular-nums">{kes(a.netPayableCents)}</td>
                <td className="pl-4">{a.paidAt ? `${date(a.paidAt)} ${a.paymentReference ?? ''}` : '—'}</td>
                <td className="text-right">{!a.paidAt && d.status === 'APPROVED' && can(Permission.DISTRIBUTIONS_MANAGE) && <Button size="sm" variant="secondary" onClick={() => payOne.mutate(a.id)} loading={payOne.isPending}>Mark paid</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {['PENDING_APPROVAL', 'APPROVED'].includes(d.status) && !d.allocations.some((a) => a.paidAt) && can(Permission.DISTRIBUTIONS_MANAGE) && (
          <Button variant="ghost" onClick={() => cancel.mutate(undefined)} disabled={comment.trim().length < 5} title="Enter a reason in the comment box first">Cancel distribution</Button>
        )}
      </div>
    </Sheet>
  );
}

export default function DistributionsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [tab, setTab] = useState('records');
  const [sel, setSel] = useState<DistributionRecord | null>(null);
  const list = useQuery({ queryKey: ['distributions', groupId], queryFn: () => api<DistributionRecord[]>(`groups/${groupId}/distributions`) });
  const current = sel ? (list.data?.find((d) => d.id === sel.id) ?? sel) : null;
  return (
    <>
      <PageHeader title="Distributions" description="End-of-cycle sharing of funds. Cash balance is not the same as distributable profit." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList tabs={[{ value: 'records', label: 'Distributions' }, ...(can(Permission.DISTRIBUTIONS_MANAGE) ? [{ value: 'calc', label: 'Distribution calculator' }] : [])]} />
        <TabsContent value="records">
          <Panel flush>
            <DataTable<DistributionRecord>
              data={list.data}
              loading={list.isLoading}
              error={list.error}
              onRowClick={setSel}
              empty="No distributions yet"
              columns={[
                { accessorKey: 'title', header: 'Title' },
                { accessorKey: 'method', header: 'Method', cell: ({ row }) => LABELS.distributionMethod[row.original.method] },
                { id: 'period', header: 'Period', cell: ({ row }) => `${date(row.original.periodFrom)} – ${date(row.original.periodTo)}` },
                { id: 'amt', header: 'Amount', cell: ({ row }) => kes(row.original.calculation.distributedCents), meta: { align: 'right' } },
                { id: 'paid', header: 'Paid', cell: ({ row }) => `${row.original.allocations.filter((a) => a.paidAt).length}/${row.original.allocations.length}` },
                { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="calc"><Calculator onCreated={() => setTab('records')} /></TabsContent>
      </Tabs>
      <DistributionDrawer d={current} onClose={() => setSel(null)} />
    </>
  );
}
