'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  FREQUENCIES,
  LABELS,
  PAYMENT_METHODS,
  Permission,
  planRotation,
  ReadinessCheck,
  ROTATION_AMENDMENT_KINDS,
  RotationAmendmentKind,
  RotationCycle,
  RotationOrderMethod,
  RotationRoundRow,
  todayInNairobi,
} from '@chamahub/shared';
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

const LOCKED = ['AWAITING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED'];

function OrderList({ order, setOrder, names, perRound = 1 }: { order: string[]; setOrder: (o: string[]) => void; names: Map<string, string>; perRound?: number }) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <ol className="max-h-80 divide-y divide-line overflow-auto rounded-md border border-line">
      {order.map((id, i) => (
        <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span className="w-14 text-xs text-muted">Round {Math.floor(i / perRound) + 1}</span>
          <span className="flex-1">{names.get(id)}</span>
          <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </li>
      ))}
    </ol>
  );
}

const METHOD_HELP: Record<RotationOrderMethod, string> = {
  AGREED: 'Set the order the members agreed on.',
  RANDOM_DRAW: 'The server draws the order when you submit and publishes the seed, so any member can re-check the draw.',
  CARRY_OVER: 'Keeps the order from the last completed cycle; new participants go to the end.',
};

function CreateCycle({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groupId = useGroupId();
  const members = useMembers('ACTIVE');
  const [form, setForm] = useState({ name: '', contributionCents: undefined as number | undefined, frequency: 'MONTHLY', startDate: todayInNairobi(), recipientContributes: true, recipientsPerRound: 1, orderMethod: 'AGREED' as RotationOrderMethod, approvalMode: 'OFFICERS', voteCloses: '' });
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (open && members.data) setOrder(members.data.map((m) => m.membershipId));
  }, [open, members.data]);
  const names = new Map((members.data ?? []).map((m) => [m.membershipId, m.fullName]));
  const included = new Set(order);
  const toggle = (id: string) => setOrder(included.has(id) ? order.filter((x) => x !== id) : [...order, id]);
  const per = form.contributionCents ?? 0;
  const preview = useMemo(() => {
    try {
      return { rounds: planRotation({ startDate: form.startDate, frequency: form.frequency as never, contributionCents: per || 1, order, recipientsPerRound: form.recipientsPerRound, recipientContributes: form.recipientContributes }), error: null };
    } catch (e) {
      return { rounds: [], error: (e as Error).message };
    }
  }, [form.startDate, form.frequency, per, order, form.recipientsPerRound, form.recipientContributes]);
  const create = useAction(
    () =>
      api(`groups/${groupId}/rotations`, {
        body: {
          name: form.name,
          contributionCents: per,
          frequency: form.frequency,
          startDate: form.startDate,
          recipientContributes: form.recipientContributes,
          recipientsPerRound: form.recipientsPerRound,
          orderMethod: form.orderMethod,
          memberIds: order,
          approvalMode: form.approvalMode,
          vote: form.approvalMode === 'MEMBER_VOTE' ? { closesAt: new Date(form.voteCloses).toISOString(), quorumPercent: 50, passPercent: 50 } : undefined,
        },
      }),
    { success: form.approvalMode === 'MEMBER_VOTE' ? 'Draft created and the members’ vote is open' : 'Draft created. Another officer must approve it before it starts.', invalidate: [['rotations', groupId]], onSuccess: () => onOpenChange(false) },
  );
  const ready = form.name.length >= 2 && per > 0 && !preview.error && (form.approvalMode === 'OFFICERS' || !!form.voteCloses);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Draft a merry-go-round cycle" description="The schedule binds nobody until it is approved by another officer or by the members’ vote." className="max-w-4xl">
        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <Field label="Cycle name" htmlFor="cy-n"><Input id="cy-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 2027 Cycle" /></Field>
            <Field label="Contribution per member per round" htmlFor="cy-a"><MoneyInput id="cy-a" value={form.contributionCents} onChange={(v) => setForm({ ...form, contributionCents: v })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequency" htmlFor="cy-f"><Select id="cy-f" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>{FREQUENCIES.map((f) => <option key={f} value={f}>{LABELS.frequency[f]}</option>)}</Select></Field>
              <Field label="First payout date" htmlFor="cy-s"><Input id="cy-s" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recipients per round" htmlFor="cy-k"><Select id="cy-k" value={form.recipientsPerRound} onChange={(e) => setForm({ ...form, recipientsPerRound: Number(e.target.value) })}>{[1, 2, 3, 4].map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
              <Field label="How the order is set" htmlFor="cy-m"><Select id="cy-m" value={form.orderMethod} onChange={(e) => setForm({ ...form, orderMethod: e.target.value as RotationOrderMethod })}>{(['AGREED', 'RANDOM_DRAW', 'CARRY_OVER'] as const).map((m) => <option key={m} value={m}>{LABELS.rotationOrderMethod[m]}</option>)}</Select></Field>
            </div>
            <p className="text-xs text-muted">{METHOD_HELP[form.orderMethod]}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.recipientContributes} onChange={(e) => setForm({ ...form, recipientContributes: e.target.checked })} /> Recipients also contribute in their own round</label>
            <Field label="Who approves the schedule" htmlFor="cy-ap">
              <Select id="cy-ap" value={form.approvalMode} onChange={(e) => setForm({ ...form, approvalMode: e.target.value })}>
                <option value="OFFICERS">Another officer (payout approver)</option>
                <option value="MEMBER_VOTE">Members, by vote</option>
              </Select>
            </Field>
            {form.approvalMode === 'MEMBER_VOTE' && <Field label="Vote closes" htmlFor="cy-v" hint="At least one hour from now. Quorum 50%, simple majority."><Input id="cy-v" type="datetime-local" value={form.voteCloses} onChange={(e) => setForm({ ...form, voteCloses: e.target.value })} /></Field>}
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium">Participants ({order.length})</p>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
                {(members.data ?? []).map((m) => (
                  <button key={m.membershipId} type="button" onClick={() => toggle(m.membershipId)} className={cn('rounded border px-2 py-0.5 text-xs', included.has(m.membershipId) ? 'border-rose bg-blush text-berry' : 'border-line text-muted')}>{m.fullName}</button>
                ))}
              </div>
            </div>
            {form.orderMethod === 'AGREED' ? (
              <div>
                <p className="mb-1 text-xs font-medium">Payout order</p>
                <OrderList order={order} setOrder={setOrder} names={names} perRound={form.recipientsPerRound} />
              </div>
            ) : null}
            <div className="rounded-md bg-canvas px-3 py-2 text-sm">
              {preview.error ? <p className="text-danger">{preview.error}</p> : (
                <>
                  <p>Pot per round: <strong>{kes((preview.rounds[0]?.expectedCollectionCents ?? 0) * (per ? 1 : 0))}</strong>{form.recipientsPerRound > 1 && <> · <strong>{kes(per ? preview.rounds[0]?.expectedShares[0] ?? 0 : 0)}</strong> each</>}</p>
                  <p className="text-xs text-muted">{preview.rounds.length} rounds · {date(preview.rounds[0]?.payoutDate)} to {date(preview.rounds.at(-1)?.payoutDate)}</p>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={!ready}>Submit for approval</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function CheckRow({ c }: { c: ReadinessCheck }) {
  const Icon = c.status === 'PASS' ? CheckCircle2 : c.status === 'WARN' ? AlertTriangle : XCircle;
  return (
    <li className="flex gap-2 py-1.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', c.status === 'PASS' ? 'text-success' : c.status === 'WARN' ? 'text-warning' : 'text-danger')} aria-label={c.status} />
      <div>
        <p className="text-sm font-medium">{c.label}</p>
        <p className="text-xs text-muted">{c.detail}</p>
      </div>
    </li>
  );
}

function RoundDrawer({ cycle, round, onClose }: { cycle: RotationCycle; round: RotationRoundRow | null; onClose: () => void }) {
  const groupId = useGroupId();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [failReason, setFailReason] = useState('');
  const [send, setSend] = useState({ method: 'MPESA', reference: '', destination: '', sentAt: todayInNairobi(), evidenceNote: '', key: newIdempotencyKey() });
  useEffect(() => {
    setReason('');
    setComment('');
    setFailReason('');
    setSend((s) => ({ ...s, reference: '', evidenceNote: '', key: newIdempotencyKey() }));
  }, [round?.id, round?.status]);
  const inv = [['rotations', groupId]];
  const base = round ? `groups/${groupId}/rotations/${cycle.id}/rounds/${round.id}` : '';
  const prepare = useAction(() => api(`${base}/prepare`, { body: { shortfallReason: reason || undefined } }), { success: 'Prepared. Approvers have been notified.', invalidate: inv });
  const decide = useAction((decision: 'APPROVE' | 'REJECT') => api(`${base}/approve`, { body: { decision, comment: comment || undefined } }), { success: 'Decision recorded', invalidate: inv });
  const disburse = useAction(() => api(`${base}/disburse`, { body: { method: send.method, reference: send.reference || undefined, destination: send.destination || undefined, sentAt: send.sentAt, evidenceNote: send.evidenceNote || undefined, idempotencyKey: send.key } }), { success: 'Recorded as sent. It completes once confirmed.', invalidate: inv });
  const confirm = useAction(() => api(`${base}/confirm`, { body: { note: comment || undefined } }), { success: 'Payout completed and posted to the ledger', invalidate: inv });
  const fail = useAction(() => api(`${base}/fail`, { body: { reason: failReason } }), { success: 'Marked as failed. It can be sent again.', invalidate: inv });
  if (!round) return null;
  const r = round;
  const pct = r.expectedCents ? Math.min(100, Math.round((r.confirmedCents / r.expectedCents) * 100)) : 0;
  const needsRef = ['MPESA', 'BANK_TRANSFER', 'CHEQUE'].includes(send.method);
  return (
    <Sheet open={!!round} onOpenChange={(o) => !o && onClose()} title={`Round ${r.round}${r.recipientsInRound > 1 ? `.${r.slot}` : ''} · ${r.recipientName}`} subtitle={<StatusBadge status={r.status} />} width="max-w-2xl">
      <div className="space-y-5">
        <KeyValues
          items={[
            ['Scheduled payout', date(r.payoutDate)],
            ['Round collection', `${kes(r.confirmedCents)} confirmed of ${kes(r.expectedCents)}`],
            ...(r.recipientsInRound > 1 ? ([['This recipient’s share', kes(r.expectedShareCents)]] as [string, React.ReactNode][]) : []),
            ['Awaiting verification', r.pendingCents ? <span key="p" className="text-warning">{kes(r.pendingCents)} (not counted)</span> : '—'],
            ['Prepared', r.preparedByName ? `${kes(r.preparedAmountCents ?? 0)} by ${r.preparedByName}, ${dateTime(r.preparedAt)}` : '—'],
            ['Shortfall reason', r.shortfallReason ?? '—'],
          ]}
        />
        <div>
          <div className="h-2 overflow-hidden rounded bg-canvas"><div className="h-full bg-rose" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-muted">{pct}% of the expected pot is confirmed. Unverified payment claims are never counted.</p>
        </div>

        {r.readiness && (
          <div>
            <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Readiness check {r.readiness.ready ? <span className="text-success">· ready</span> : <span className="text-danger">· not ready</span>}
            </h3>
            <ul className="divide-y divide-line rounded-md border border-line px-3">{r.readiness.checks.map((c) => <CheckRow key={c.key} c={c} />)}</ul>
            {r.readiness.ready && <p className="mt-1 text-xs text-muted">Payable now: <strong>{kes(r.readiness.payableCents)}</strong></p>}
          </div>
        )}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Approvals ({r.approvals.filter((a) => a.decision === 'APPROVED').length}/{r.approvalsRequired})</h3>
          {r.approvals.length ? <ul className="space-y-1 text-sm">{r.approvals.map((a) => <li key={a.id}><StatusBadge status={a.decision} /> {a.approverName} · {dateTime(a.createdAt)}{a.comment ? ` — ${a.comment}` : ''}</li>)}</ul> : <p className="text-sm text-muted">None for the current preparation.</p>}
        </div>

        {r.disbursement && (
          <div className="rounded-md border border-line p-3 text-sm">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Disbursement{r.attempts > 1 ? ` · attempt ${r.attempts}` : ''}</h3>
            <p>{LABELS.paymentMethod[r.disbursement.method]} {r.disbursement.reference && <span className="font-mono">{r.disbursement.reference}</span>} · sent {date(r.disbursement.sentAt)} by {r.disbursement.byName}</p>
            {r.disbursement.destination && <p className="text-xs text-muted">To {r.disbursement.destination}</p>}
            {r.disbursement.evidenceNote && <p className="text-xs text-muted">{r.disbursement.evidenceNote}</p>}
            {r.confirmation && <p className="mt-1 flex items-center gap-1 text-success"><ShieldCheck className="h-4 w-4" /> {r.confirmation.kind === 'RECIPIENT' ? 'Receipt confirmed by the recipient' : 'Reference verified by'} {r.confirmation.kind === 'RECIPIENT' ? '' : r.confirmation.byName} · {dateTime(r.confirmation.at)}</p>}
            {r.failureReason && <p className="mt-1 text-danger">Last attempt failed: {r.failureReason}</p>}
          </div>
        )}

        {r.can.prepare && (
          <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
            <h3 className="text-sm font-semibold">{r.status === 'READINESS_CHECK' ? 'Prepare this payout' : 'Prepare again'}</h3>
            <p className="text-xs text-muted">Fixes the amount from confirmed contributions and sends it to approvers. You cannot approve a payout you prepared.</p>
            {r.readiness?.needsShortfallReason && <Field label="Why the group agrees to pay a reduced amount" htmlFor="sf"><Textarea id="sf" rows={2} className="min-h-0 bg-white" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agreed at the meeting on 3 March; Daniel will pay next week" /></Field>}
            <Button onClick={() => prepare.mutate(undefined)} loading={prepare.isPending} disabled={!!r.readiness?.needsShortfallReason && reason.trim().length < 5}>Prepare payout of {kes(r.readiness?.payableCents ?? 0)}</Button>
          </div>
        )}
        {r.can.approve && (
          <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
            <h3 className="text-sm font-semibold">Approve {kes(r.preparedAmountCents ?? 0)} to {r.recipientName}</h3>
            <Field label="Comment (required to reject)" htmlFor="ac"><Input id="ac" className="bg-white" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="flex gap-2"><Button onClick={() => decide.mutate('APPROVE')} loading={decide.isPending}>Approve</Button><Button variant="secondary" onClick={() => decide.mutate('REJECT')} disabled={comment.trim().length < 5}>Reject</Button></div>
          </div>
        )}
        {r.can.disburse && (
          <div className="space-y-3 rounded-md border border-line p-3">
            <h3 className="text-sm font-semibold">{r.status === 'FAILED' ? 'Send again' : 'Record that you sent the payout'}</h3>
            <p className="text-xs text-muted">Send {kes(r.preparedAmountCents ?? 0)} through the group’s agreed channel, then record it here. It completes only when the recipient confirms or another officer verifies the reference.</p>
            <div className="grid grid-cols-3 gap-2">
              <Select value={send.method} onChange={(e) => setSend({ ...send, method: e.target.value })} aria-label="Method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABELS.paymentMethod[m]}</option>)}</Select>
              <Input placeholder={needsRef ? 'Transaction code (required)' : 'Reference (optional)'} value={send.reference} onChange={(e) => setSend({ ...send, reference: e.target.value.toUpperCase() })} aria-label="Reference" />
              <Input type="date" max={todayInNairobi()} value={send.sentAt} onChange={(e) => setSend({ ...send, sentAt: e.target.value })} aria-label="Date sent" />
            </div>
            <Input placeholder="Sent to (e.g. M-Pesa 0712 *** 678)" value={send.destination} onChange={(e) => setSend({ ...send, destination: e.target.value })} aria-label="Destination" />
            <Textarea rows={2} placeholder={send.method === 'CASH' ? 'Who handed over the cash, where, and who witnessed it (required)' : 'Evidence note (optional)'} value={send.evidenceNote} onChange={(e) => setSend({ ...send, evidenceNote: e.target.value })} aria-label="Evidence" />
            <Button onClick={() => disburse.mutate(undefined)} loading={disburse.isPending} disabled={(needsRef && send.reference.length < 4) || (send.method === 'CASH' && send.evidenceNote.trim().length < 5)}>Record as sent</Button>
          </div>
        )}
        {(r.can.confirm || r.can.fail) && (
          <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
            <h3 className="text-sm font-semibold">Confirm the outcome</h3>
            {r.can.confirm && (
              <>
                <p className="text-xs text-muted">Check the reference against the group’s M-Pesa or bank statement before verifying.</p>
                <Input className="bg-white" placeholder="Verification note (e.g. matched on statement)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Note" />
                <Button onClick={() => confirm.mutate(undefined)} loading={confirm.isPending}>Verify and complete</Button>
              </>
            )}
            {r.can.fail && (
              <div className="flex gap-2 pt-1">
                <Input className="bg-white" placeholder="Why it failed (e.g. reversed: wrong number)" value={failReason} onChange={(e) => setFailReason(e.target.value)} aria-label="Failure reason" />
                <Button variant="secondary" onClick={() => fail.mutate(undefined)} loading={fail.isPending} disabled={failReason.trim().length < 5}>Mark failed</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function AmendDialog({ cycle, open, onOpenChange }: { cycle: RotationCycle; open: boolean; onOpenChange: (o: boolean) => void }) {
  const groupId = useGroupId();
  const members = useMembers('ACTIVE');
  const lockedRounds = new Set(cycle.rounds.filter((r) => LOCKED.includes(r.status)).map((r) => r.round));
  const live = cycle.rounds.filter((r) => r.status !== 'CANCELLED');
  const movable = live.filter((r) => !lockedRounds.has(r.round));
  const inRotation = new Set(live.map((r) => r.recipientMembershipId));
  const outside = (members.data ?? []).filter((m) => !inRotation.has(m.membershipId));
  const names = new Map([...live.map((r) => [r.recipientMembershipId, r.recipientName] as const), ...(members.data ?? []).map((m) => [m.membershipId, m.fullName] as const)]);
  const [kind, setKind] = useState<RotationAmendmentKind>('REORDER');
  const [order, setOrder] = useState<string[]>([]);
  const [memberId, setMemberId] = useState('');
  const [other, setOther] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setOrder(movable.map((r) => r.recipientMembershipId));
      setReason('');
      setMemberId('');
      setOther([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cycle.id]);
  const body = kind === 'REORDER' ? { kind, order, reason } : kind === 'ADD_MEMBERS' ? { kind, memberIds: other, reason } : kind === 'REMOVE_MEMBER' ? { kind, memberId, reason } : { kind, memberId, replacementId: other[0], reason };
  const propose = useAction(() => api(`groups/${groupId}/rotations/${cycle.id}/amendments`, { body }), { success: 'Amendment proposed. Another officer must approve it.', invalidate: [['rotations', groupId]], onSuccess: () => onOpenChange(false) });
  const valid = reason.trim().length >= 5 && (kind === 'REORDER' ? true : kind === 'ADD_MEMBERS' ? other.length > 0 && other.length % cycle.recipientsPerRound === 0 : kind === 'REMOVE_MEMBER' ? !!memberId : !!memberId && other.length === 1);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Propose a schedule amendment" description="Only rounds that have not entered payout can change. The approved schedule is kept; the amendment applies after another officer approves it, and affected members are told their new position.">
        <div className="space-y-3">
          <Field label="Change" htmlFor="am-k"><Select id="am-k" value={kind} onChange={(e) => setKind(e.target.value as RotationAmendmentKind)}>{ROTATION_AMENDMENT_KINDS.map((k) => <option key={k} value={k} disabled={k === 'REMOVE_MEMBER' && cycle.recipientsPerRound > 1}>{LABELS.rotationAmendment[k]}</option>)}</Select></Field>
          {kind === 'REORDER' && <OrderList order={order} setOrder={setOrder} names={names} perRound={cycle.recipientsPerRound} />}
          {(kind === 'REMOVE_MEMBER' || kind === 'REPLACE_MEMBER') && (
            <Field label={kind === 'REMOVE_MEMBER' ? 'Member leaving the rotation' : 'Member handing over their slot'} htmlFor="am-m">
              <Select id="am-m" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Choose…</option>{movable.map((r) => <option key={r.id} value={r.recipientMembershipId}>{r.recipientName} (round {r.round})</option>)}</Select>
            </Field>
          )}
          {(kind === 'ADD_MEMBERS' || kind === 'REPLACE_MEMBER') && (
            <div>
              <p className="mb-1 text-xs font-medium">{kind === 'ADD_MEMBERS' ? `Members joining at the end${cycle.recipientsPerRound > 1 ? ` (in groups of ${cycle.recipientsPerRound})` : ''}` : 'Replacement'}</p>
              {outside.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {outside.map((m) => {
                    const on = other.includes(m.membershipId);
                    return <button key={m.membershipId} type="button" onClick={() => setOther(kind === 'REPLACE_MEMBER' ? [m.membershipId] : on ? other.filter((x) => x !== m.membershipId) : [...other, m.membershipId])} className={cn('rounded border px-2 py-0.5 text-xs', on ? 'border-rose bg-blush text-berry' : 'border-line text-muted')}>{m.fullName}</button>;
                  })}
                </div>
              ) : <p className="text-sm text-muted">Every active member is already in this rotation.</p>}
              <p className="mt-1 text-xs text-muted">New members owe contributions from the day the amendment is approved, not for earlier rounds.</p>
            </div>
          )}
          {kind === 'REMOVE_MEMBER' && <p className="text-xs text-muted">Later recipients move up one round and the last round is cancelled. What the member already owes stays owed.</p>}
          <Field label="Reason" htmlFor="am-r"><Textarea id="am-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agreed at the meeting on 3 March" /></Field>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => propose.mutate(undefined)} loading={propose.isPending} disabled={!valid}>Submit for approval</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DraftPanel({ cycle }: { cycle: RotationCycle }) {
  const groupId = useGroupId();
  const [comment, setComment] = useState('');
  const inv = [['rotations', groupId]];
  const decide = useAction((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/rotations/${cycle.id}/activation`, { body: { decision, comment: comment || undefined } }), { success: 'Decision recorded', invalidate: inv });
  const cancel = useAction(() => api(`groups/${groupId}/rotations/${cycle.id}/cancel`, { body: { reason: comment } }), { success: 'Draft cancelled', invalidate: inv });
  if (cycle.status !== 'DRAFT') return null;
  return (
    <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="font-semibold text-amber-900">Awaiting approval — this schedule is not binding yet and no contributions are due under it.</p>
      <p className="mt-1 text-amber-800">
        Drafted by {cycle.createdByName}. {cycle.approvalMode === 'MEMBER_VOTE' ? <>Members are voting on it. <Link className="underline" href={`/g/${groupId}/decisions`}>Open the vote</Link>.</> : `Needs ${cycle.activationApprovalsRequired} approval(s) from an officer other than the drafter (${cycle.activationApprovals.length} so far).`}
      </p>
      {(cycle.can.approveActivation || cycle.can.cancel) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input className="max-w-sm bg-white" placeholder="Comment (required to reject or cancel)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
          {cycle.can.approveActivation && <><Button size="sm" onClick={() => decide.mutate('APPROVE')} loading={decide.isPending}>Approve schedule</Button><Button size="sm" variant="secondary" onClick={() => decide.mutate('REJECT')} disabled={comment.trim().length < 5}>Reject</Button></>}
          {cycle.can.cancel && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(undefined)} disabled={comment.trim().length < 5}>Cancel draft</Button>}
        </div>
      )}
    </div>
  );
}

export default function RotationsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const rotations = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`) });
  const [cycleId, setCycleId] = useState<string>('');
  const [create, setCreate] = useState(false);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [amend, setAmend] = useState(false);
  const cycle = rotations.data?.find((c) => c.id === cycleId) ?? rotations.data?.find((c) => c.status === 'ACTIVE' || c.status === 'DRAFT') ?? rotations.data?.[0];
  const inv = [['rotations', groupId]];
  const close = useAction(() => api(`groups/${groupId}/rotations/${cycle!.id}/close`, { method: 'POST' }), { success: 'Cycle closed', invalidate: inv });
  const pendingChange = cycle?.changeLog.find((c) => c.status === 'PENDING');
  const round = cycle?.rounds.find((r) => r.id === roundId) ?? null;
  const multi = (cycle?.recipientsPerRound ?? 1) > 1;

  return (
    <>
      <PageHeader
        title="Payout Rotations"
        description="Merry-go-round cycles. Each payout moves through readiness, preparation, independent approval, sending and confirmed completion."
        actions={
          <>
            {rotations.data && rotations.data.length > 1 && (
              <Select className="w-56" value={cycle?.id} onChange={(e) => setCycleId(e.target.value)} aria-label="Cycle">
                {rotations.data.map((c) => <option key={c.id} value={c.id}>{c.name} ({LABELS.cycleStatus[c.status].toLowerCase()})</option>)}
              </Select>
            )}
            {can(Permission.ROTATIONS_MANAGE) && <Button onClick={() => setCreate(true)}>New cycle</Button>}
          </>
        }
      />
      {rotations.error ? <ErrorState error={rotations.error} onRetry={rotations.refetch} /> : !rotations.data ? <LoadingRows /> : !cycle ? (
        <Panel><EmptyState title="No rotation cycles yet" description="Draft a cycle to generate the payout calendar. It starts once approved." /></Panel>
      ) : (
        <>
          <DraftPanel cycle={cycle} />
          <StatStrip
            stats={[
              { label: 'Cycle', value: cycle.name, hint: `${LABELS.frequency[cycle.frequency]} · ${kes(cycle.contributionCents)} each · ${LABELS.cycleStatus[cycle.status]}` },
              { label: 'Current recipient', value: cycle.currentRound?.recipientName ?? '—', hint: cycle.currentRound ? `Round ${cycle.currentRound.round} · ${date(cycle.currentRound.payoutDate)}` : 'All rounds paid' },
              { label: 'Next recipient', value: cycle.nextRound?.recipientName ?? '—', hint: cycle.nextRound ? date(cycle.nextRound.payoutDate) : undefined },
              { label: 'Current round collected', value: cycle.currentRound ? `${kes(cycle.currentRound.confirmedCents)} of ${kes(cycle.currentRound.expectedCents)}` : '—', tone: cycle.currentRound?.shortfallCents ? 'warning' : 'default' },
              { label: 'Remaining rounds', value: cycle.remainingRounds },
            ]}
          />
          <p className="mb-4 text-xs text-muted">
            {LABELS.rotationOrderMethod[cycle.orderMethod]}
            {cycle.drawSeed && <> · draw seed <span className="font-mono">{cycle.drawSeed}</span> (anyone can re-run the draw with this seed)</>}
            {multi && <> · {cycle.recipientsPerRound} recipients per round</>}
            {cycle.activatedAt && <> · approved {dateTime(cycle.activatedAt)}</>}
          </p>
          {pendingChange && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">An amendment is awaiting approval: {pendingChange.reason} (proposed by {pendingChange.byName}). Payouts are on hold until it is decided.</p>}
          <Panel
            title="Rounds"
            flush
            actions={
              cycle.status === 'ACTIVE' && can(Permission.ROTATIONS_MANAGE) && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAmend(true)} disabled={!cycle.can.amend}>Propose amendment</Button>
                  <Button size="sm" variant="secondary" onClick={() => close.mutate(undefined)} disabled={!cycle.can.close} title={cycle.can.close ? undefined : 'All rounds must be completed first'}>Close cycle</Button>
                </div>
              )
            }
          >
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Round</th><th className="px-3 py-2 font-medium">Recipient</th><th className="px-3 py-2 font-medium">Payout date</th><th className="px-3 py-2 text-right font-medium">{multi ? 'Share' : 'Expected'}</th><th className="px-3 py-2 text-right font-medium">Confirmed</th><th className="px-3 py-2 text-right font-medium">Shortfall</th><th className="px-3 py-2 font-medium">Stage</th><th className="px-3 py-2 font-medium">Reference</th></tr></thead>
              <tbody>
                {cycle.rounds.map((r) => (
                  <tr key={r.id} className={cn('cursor-pointer border-b border-line last:border-0 hover:bg-canvas', cycle.currentRound?.round === r.round && 'bg-blush/60', r.status === 'CANCELLED' && 'text-muted line-through')} onClick={() => setRoundId(r.id)}>
                    <td className="px-3 py-2">{r.round}{multi ? `.${r.slot}` : ''}</td>
                    <td className="px-3 py-2 font-medium">{r.recipientName}</td>
                    <td className="px-3 py-2">{date(r.payoutDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kes(multi ? r.expectedShareCents : r.expectedCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kes(r.confirmedCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.shortfallCents && !['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(r.status) ? <span className="text-danger">{kes(r.shortfallCents)}</span> : '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{r.payoutReference ?? r.disbursement?.reference ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <ChangeLog cycle={cycle} />
          {cycle.approvedPlan && cycle.changeLog.some((c) => c.status === 'APPROVED') && (
            <Panel title="Schedule as originally approved" className="mt-5">
              <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {cycle.approvedPlan.map((p) => <li key={`${p.round}.${p.slot}`}><span className="text-muted">Round {p.round}{multi ? `.${p.slot}` : ''} · {date(p.payoutDate)}</span> — {p.memberName}</li>)}
              </ol>
            </Panel>
          )}
          <RoundDrawer cycle={cycle} round={round} onClose={() => setRoundId(null)} />
          <AmendDialog cycle={cycle} open={amend} onOpenChange={setAmend} />
        </>
      )}
      <CreateCycle open={create} onOpenChange={setCreate} />
    </>
  );
}

function ChangeLog({ cycle }: { cycle: RotationCycle }) {
  const groupId = useGroupId();
  const can = useCan();
  const decide = useAction(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycle.id}/changes/${id}/decision`, { body: { decision } }), { success: 'Decision recorded', invalidate: [['rotations', groupId]] });
  if (!cycle.changeLog.length) return null;
  return (
    <Panel title="Amendments" className="mt-5" flush>
      <ul className="divide-y divide-line text-sm">
        {cycle.changeLog.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div>
              <p>
                <StatusBadge status={c.status} /> <strong>{LABELS.rotationAmendment[c.kind]}</strong> — {c.reason}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {dateTime(c.at)} · proposed by {c.byName}
                {c.leftNames.length > 0 && <> · leaving: {c.leftNames.join(', ')}</>}
                {c.joinedNames.length > 0 && <> · joining: {c.joinedNames.join(', ')}</>}
              </p>
              <p className="mt-0.5 text-xs text-muted">Order of remaining rounds: {c.beforeNames.join(' → ')} <span className="mx-1">⇒</span> {c.afterNames.join(' → ')}</p>
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
