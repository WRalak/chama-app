'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FREQUENCIES, LABELS, PAYMENT_METHODS, Permission, RotationCycle, RotationRoundRow, todayInNairobi } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { KeyValues, PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction, useMembers } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { cn, date, dateTime, kes, newIdempotencyKey } from '@/lib/utils';

function OrderList({ order, setOrder, names }: { order: string[]; setOrder: (o: string[]) => void; names: Map<string, string> }) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <ol className="divide-y divide-line rounded-md border border-line">
      {order.map((id, i) => (
        <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="w-6 text-xs text-muted">{i + 1}.</span>
          <span className="flex-1">{names.get(id)}</span>
          <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </li>
      ))}
    </ol>
  );
}

function CreateCycle({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groupId = useGroupId();
  const members = useMembers('ACTIVE');
  const [form, setForm] = useState({ name: '', contributionCents: undefined as number | undefined, frequency: 'MONTHLY', startDate: todayInNairobi(), recipientContributes: true });
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (open && members.data) setOrder(members.data.map((m) => m.membershipId));
  }, [open, members.data]);
  const names = new Map((members.data ?? []).map((m) => [m.membershipId, m.fullName]));
  const create = useAction(() => api(`groups/${groupId}/rotations`, { body: { ...form, memberIdsInOrder: order } }), { success: 'Rotation created with its payout calendar', invalidate: [['rotations', groupId]], onSuccess: () => onOpenChange(false) });
  const per = form.contributionCents ?? 0;
  const pot = per * (form.recipientContributes ? order.length : Math.max(order.length - 1, 0));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New merry-go-round cycle" description="Each round, members contribute and one member receives the pot." className="max-w-2xl">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Field label="Cycle name" htmlFor="cy-n"><Input id="cy-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2026 Cycle" /></Field>
            <Field label="Contribution per member per round" htmlFor="cy-a"><MoneyInput id="cy-a" value={form.contributionCents} onChange={(v) => setForm({ ...form, contributionCents: v })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequency" htmlFor="cy-f"><Select id="cy-f" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>{FREQUENCIES.map((f) => <option key={f} value={f}>{LABELS.frequency[f]}</option>)}</Select></Field>
              <Field label="First payout date" htmlFor="cy-s"><Input id="cy-s" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recipientContributes} onChange={(e) => setForm({ ...form, recipientContributes: e.target.checked })} /> Recipient also contributes in their own round</label>
            <p className="rounded-md bg-canvas px-3 py-2 text-sm">Expected pot per round: <strong>{kes(pot)}</strong> · {order.length} rounds</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium">Payout order</p>
            <OrderList order={order} setOrder={setOrder} names={names} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={form.name.length < 2 || !per || order.length < 2}>Create cycle</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function RoundDrawer({ cycle, round, onClose }: { cycle: RotationCycle; round: RotationRoundRow | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({ method: 'MPESA', reference: '', paidAt: todayInNairobi(), key: newIdempotencyKey() });
  const inv = [['rotations', groupId]];
  const approve = useAction(() => api(`groups/${groupId}/rotations/${cycle.id}/rounds/${round!.id}/approve`, { body: { shortfallReason: reason || undefined } }), { success: 'Approval recorded', invalidate: inv, onSuccess: onClose });
  const complete = useAction(() => api(`groups/${groupId}/rotations/${cycle.id}/rounds/${round!.id}/complete`, { body: { method: pay.method, reference: pay.reference || undefined, paidAt: pay.paidAt, idempotencyKey: pay.key } }), { success: 'Payout recorded and recipient notified', invalidate: inv, onSuccess: onClose });
  if (!round) return null;
  const isNext = cycle.currentRound?.id === round.id;
  const pct = round.expectedCents ? Math.min(100, Math.round((round.confirmedCents / round.expectedCents) * 100)) : 0;
  return (
    <Sheet open={!!round} onOpenChange={(o) => !o && onClose()} title={`Round ${round.round} · ${round.recipientName}`} subtitle={<StatusBadge status={round.status} />}>
      <div className="space-y-5">
        <KeyValues items={[['Scheduled payout', date(round.payoutDate)], ['Expected collection', kes(round.expectedCents)], ['Confirmed collection', kes(round.confirmedCents)], ['Pending verification', kes(round.pendingCents)], ['Shortfall', round.shortfallCents ? <span key="s" className="text-danger">{kes(round.shortfallCents)}</span> : '—'], ['Payout reference', round.payoutReference ?? '—'], ['Completed', dateTime(round.completedAt)], ['Shortfall reason', round.shortfallReason ?? '—']]} />
        <div>
          <div className="h-2 overflow-hidden rounded bg-canvas"><div className="h-full bg-emerald" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-muted">{pct}% of the expected pot is confirmed</p>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Approvals ({round.approvals.length}/{round.approvalsRequired})</h3>
          {round.approvals.length ? <ul className="space-y-1 text-sm">{round.approvals.map((a) => <li key={a.id}>{a.approverName} · {dateTime(a.createdAt)}</li>)}</ul> : <p className="text-sm text-muted">None yet.</p>}
        </div>
        {!['APPROVED', 'COMPLETED'].includes(round.status) && can(Permission.PAYOUTS_APPROVE) && (
          <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
            {!isNext && <p className="text-sm text-warning">Earlier rounds must be paid first. Rounds are never skipped; propose an order change instead.</p>}
            {round.shortfallCents > 0 && <Field label="Reason for approving a reduced payout" htmlFor="sf"><Textarea id="sf" rows={2} className="min-h-0 bg-white" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agreed at the meeting on 3 March; Daniel will pay next week" /></Field>}
            <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending} disabled={!isNext || round.confirmedCents <= 0 || (round.shortfallCents > 0 && reason.trim().length < 5)}>Approve payout of {kes(round.confirmedCents)}</Button>
          </div>
        )}
        {round.status === 'APPROVED' && can(Permission.ROTATIONS_MANAGE) && (
          <div className="space-y-3 rounded-md border border-line p-3">
            <h3 className="text-sm font-semibold">Record payout to {round.recipientName}</h3>
            <div className="grid grid-cols-3 gap-2">
              <Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} aria-label="Method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABELS.paymentMethod[m]}</option>)}</Select>
              <Input placeholder="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} aria-label="Reference" />
              <Input type="date" max={todayInNairobi()} value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} aria-label="Date" />
            </div>
            <Button onClick={() => complete.mutate(undefined)} loading={complete.isPending}>Record payout of {kes(round.confirmedCents)}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export default function RotationsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const rotations = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`) });
  const [cycleId, setCycleId] = useState<string>('');
  const [create, setCreate] = useState(false);
  const [round, setRound] = useState<RotationRoundRow | null>(null);
  const [reorder, setReorder] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const cycle = rotations.data?.find((c) => c.id === cycleId) ?? rotations.data?.find((c) => c.status === 'ACTIVE') ?? rotations.data?.[0];
  const inv = [['rotations', groupId]];
  const propose = useAction(() => api(`groups/${groupId}/rotations/${cycle!.id}/reorder`, { body: { memberIdsInOrder: order, reason } }), { success: 'Order change proposed. Another officer must approve it.', invalidate: inv, onSuccess: () => setReorder(false) });
  const close = useAction(() => api(`groups/${groupId}/rotations/${cycle!.id}/close`, { method: 'POST' }), { success: 'Cycle closed', invalidate: inv });
  const pendingChange = cycle?.changeLog.find((c) => c.status === 'PENDING');
  const names = new Map((cycle?.rounds ?? []).map((r) => [r.recipientMembershipId, r.recipientName]));
  const movable = (cycle?.rounds ?? []).filter((r) => r.status !== 'APPROVED' && r.status !== 'COMPLETED');

  return (
    <>
      <PageHeader
        title="Payout Rotations"
        description="Merry-go-round cycles. Scheduled, approved and completed payouts are tracked separately."
        actions={
          <>
            {rotations.data && rotations.data.length > 1 && (
              <Select className="w-56" value={cycle?.id} onChange={(e) => setCycleId(e.target.value)} aria-label="Cycle">
                {rotations.data.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status.toLowerCase()})</option>)}
              </Select>
            )}
            {can(Permission.ROTATIONS_MANAGE) && <Button onClick={() => setCreate(true)}>New cycle</Button>}
          </>
        }
      />
      {rotations.error ? <ErrorState error={rotations.error} onRetry={rotations.refetch} /> : !rotations.data ? <LoadingRows /> : !cycle ? (
        <Panel><EmptyState title="No rotation cycles yet" description="Create a cycle to generate the payout calendar and per-round collections." /></Panel>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: 'Cycle', value: cycle.name, hint: `${LABELS.frequency[cycle.frequency]} · ${kes(cycle.contributionCents)} each` },
              { label: 'Current recipient', value: cycle.currentRound?.recipientName ?? '—', hint: cycle.currentRound ? `Round ${cycle.currentRound.round} · ${date(cycle.currentRound.payoutDate)}` : 'All rounds paid' },
              { label: 'Next recipient', value: cycle.nextRound?.recipientName ?? '—', hint: cycle.nextRound ? date(cycle.nextRound.payoutDate) : undefined },
              { label: 'Current round collected', value: cycle.currentRound ? `${kes(cycle.currentRound.confirmedCents)} of ${kes(cycle.currentRound.expectedCents)}` : '—', tone: cycle.currentRound?.shortfallCents ? 'warning' : 'default' },
              { label: 'Remaining rounds', value: cycle.remainingRounds },
            ]}
          />
          {pendingChange && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">An order change is awaiting approval: {pendingChange.reason} (proposed by {pendingChange.byName}). Review it in the change log below.</p>}
          <Panel
            title="Rounds"
            flush
            actions={
              cycle.status === 'ACTIVE' && can(Permission.ROTATIONS_MANAGE) && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setOrder(movable.map((r) => r.recipientMembershipId)); setReason(''); setReorder(true); }} disabled={movable.length < 2}>Propose order change</Button>
                  <Button size="sm" variant="secondary" onClick={() => close.mutate(undefined)} disabled={cycle.remainingRounds > 0} title={cycle.remainingRounds > 0 ? 'All rounds must be completed first' : undefined}>Close cycle</Button>
                </div>
              )
            }
          >
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Recipient</th><th className="px-3 py-2 font-medium">Payout date</th><th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Confirmed</th><th className="px-3 py-2 text-right font-medium">Shortfall</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 font-medium">Reference</th></tr></thead>
              <tbody>
                {cycle.rounds.map((r) => (
                  <tr key={r.id} className={cn('cursor-pointer border-b border-line last:border-0 hover:bg-canvas', cycle.currentRound?.id === r.id && 'bg-forest-50/60')} onClick={() => setRound(r)}>
                    <td className="px-3 py-2">{r.round}</td>
                    <td className="px-3 py-2 font-medium">{r.recipientName}</td>
                    <td className="px-3 py-2">{date(r.payoutDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kes(r.expectedCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kes(r.confirmedCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.shortfallCents && r.status !== 'SCHEDULED' ? <span className="text-danger">{kes(r.shortfallCents)}</span> : '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{r.payoutReference ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <ChangeLog cycle={cycle} />
          <RoundDrawer cycle={cycle} round={round ? (cycle.rounds.find((r) => r.id === round.id) ?? null) : null} onClose={() => setRound(null)} />
          <Dialog open={reorder} onOpenChange={setReorder}>
            <DialogContent title="Propose a new payout order" description="Only rounds not yet approved or paid can move. Another officer must approve the change.">
              <div className="space-y-3">
                <OrderList order={order} setOrder={setOrder} names={names} />
                <Field label="Reason" htmlFor="ro-r"><Textarea id="ro-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReorder(false)}>Cancel</Button><Button onClick={() => propose.mutate(undefined)} loading={propose.isPending} disabled={reason.trim().length < 5}>Submit for approval</Button></div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
      <CreateCycle open={create} onOpenChange={setCreate} />
    </>
  );
}

function ChangeLog({ cycle }: { cycle: RotationCycle }) {
  const groupId = useGroupId();
  const can = useCan();
  const names = new Map(cycle.rounds.map((r) => [r.recipientMembershipId, r.recipientName]));
  const decide = useAction(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycle.id}/changes/${id}/decision`, { body: { decision } }), { success: 'Decision recorded', invalidate: [['rotations', groupId]] });
  if (!cycle.changeLog.length) return null;
  return (
    <Panel title="Order change log" className="mt-5" flush>
      <ul className="divide-y divide-line text-sm">
        {cycle.changeLog.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <p>
                <StatusBadge status={c.status} /> {c.reason}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {dateTime(c.at)} · proposed by {c.byName} · new order: {c.after.map((id) => names.get(id)).join(' → ')}
              </p>
            </div>
            {c.status === 'PENDING' && can(Permission.PAYOUTS_APPROVE) && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide.mutate({ id: c.id, decision: 'APPROVE' })} loading={decide.isPending}>Approve</Button>
                <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: c.id, decision: 'REJECT' })}>Reject</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
