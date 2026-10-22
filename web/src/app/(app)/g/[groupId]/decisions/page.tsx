'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Permission, ProposalRow } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { dateTime } from '@/lib/utils';

function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-canvas"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="w-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

export default function DecisionsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', closesAt: '', quorumPercent: 50, passPercent: 50 });
  const list = useQuery({ queryKey: ['votes', groupId], queryFn: () => api<ProposalRow[]>(`groups/${groupId}/votes`) });
  const inv = [['votes', groupId]];
  const create = useAction(() => api(`groups/${groupId}/votes`, { body: { ...f, closesAt: new Date(`${f.closesAt}:00+03:00`).toISOString() } }), { success: 'Vote opened and members notified', invalidate: inv, onSuccess: () => setOpen(false) });
  const cast = useAction(({ id, choice }: { id: string; choice: 'YES' | 'NO' | 'ABSTAIN' }) => api(`groups/${groupId}/votes/${id}/ballot`, { body: { choice } }), { success: 'Your vote was recorded. Votes cannot be changed.', invalidate: inv });
  const close = useAction(({ id, cancel }: { id: string; cancel: boolean }) => api(`groups/${groupId}/votes/${id}/close`, { body: { cancel } }), { success: 'Vote closed and decision published', invalidate: inv });

  return (
    <>
      <PageHeader title="Decisions & Votes" description="Group decisions put to eligible members. Ballots are final and secret: only totals are shown." actions={can(Permission.VOTES_CREATE) && <Button onClick={() => setOpen(true)}>Start a vote</Button>} />
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <LoadingRows /> : list.data.length === 0 ? <Panel><EmptyState title="No votes yet" /></Panel> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.map((p) => {
            const turnout = p.tally.YES + p.tally.NO + p.tally.ABSTAIN;
            return (
              <Panel key={p.id} title={p.title} actions={<StatusBadge status={p.status} />}>
                <p className="whitespace-pre-wrap text-sm text-plum">{p.description}</p>
                <p className="mt-2 text-xs text-muted">Started by {p.createdByName} · {p.status === 'OPEN' ? `closes ${dateTime(p.closesAt)}` : `closed ${dateTime(p.closedAt)}`} · needs {p.quorumPercent}% turnout and {p.passPercent}% yes</p>
                <div className="mt-3 space-y-1.5">
                  <Bar label="Yes" value={p.tally.YES} total={p.eligibleCount} tone="bg-rose" />
                  <Bar label="No" value={p.tally.NO} total={p.eligibleCount} tone="bg-danger" />
                  <Bar label="Abstain" value={p.tally.ABSTAIN} total={p.eligibleCount} tone="bg-muted" />
                  <p className="text-xs text-muted">{turnout} of {p.eligibleCount} eligible members have voted</p>
                </div>
                {p.myVote && <p className="mt-2 text-sm">You voted <strong>{p.myVote.toLowerCase()}</strong>.</p>}
                {p.canVote && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => cast.mutate({ id: p.id, choice: 'YES' })}>Vote yes</Button>
                    <Button size="sm" variant="secondary" onClick={() => cast.mutate({ id: p.id, choice: 'NO' })}>Vote no</Button>
                    <Button size="sm" variant="ghost" onClick={() => cast.mutate({ id: p.id, choice: 'ABSTAIN' })}>Abstain</Button>
                  </div>
                )}
                {p.canClose && (
                  <div className="mt-3 flex gap-2 border-t border-line pt-3">
                    <Button size="sm" variant="secondary" onClick={() => close.mutate({ id: p.id, cancel: false })}>Close and publish result</Button>
                    <Button size="sm" variant="ghost" onClick={() => close.mutate({ id: p.id, cancel: true })}>Cancel vote</Button>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Start a vote" description="All eligible members are notified. Read-only members do not vote.">
          <div className="space-y-3">
            <Field label="Question" htmlFor="v-t"><Input id="v-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Raise the monthly contribution to KSh 1,500" /></Field>
            <Field label="Details" htmlFor="v-d"><Textarea id="v-d" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Closes (EAT)" htmlFor="v-c"><Input id="v-c" type="datetime-local" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} /></Field>
              <Field label="Quorum %" htmlFor="v-q"><Input id="v-q" type="number" min={1} max={100} value={f.quorumPercent} onChange={(e) => setF({ ...f, quorumPercent: Number(e.target.value) })} /></Field>
              <Field label="Pass %" htmlFor="v-p"><Input id="v-p" type="number" min={50} max={100} value={f.passPercent} onChange={(e) => setF({ ...f, passPercent: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={f.title.length < 5 || f.description.length < 5 || !f.closesAt}>Open vote</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
