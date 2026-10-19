'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FindingRow, Permission } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { dateTime } from '@/lib/utils';

export default function FindingsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', details: '', severity: 'MEDIUM', reference: '' });
  const [reply, setReply] = useState<{ id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' | 'REJECTED'; response: string } | null>(null);
  const list = useQuery({ queryKey: ['findings', groupId], queryFn: () => api<FindingRow[]>(`groups/${groupId}/findings`) });
  const inv = [['findings', groupId]];
  const raise = useAction(() => api(`groups/${groupId}/findings`, { body: { ...f, reference: f.reference || undefined } }), { success: 'Finding raised and officers notified', invalidate: inv, onSuccess: () => setOpen(false) });
  const respond = useAction(() => api(`groups/${groupId}/findings/${reply!.id}/respond`, { body: { status: reply!.status, response: reply!.response } }), { success: 'Response recorded', invalidate: inv, onSuccess: () => setReply(null) });
  const tone = { HIGH: 'red', MEDIUM: 'amber', LOW: 'neutral' } as const;

  return (
    <>
      <PageHeader title="Audit Findings" description="Discrepancies flagged by auditors. Officers respond; the auditor never corrects records themselves." actions={can(Permission.FINDINGS_RAISE) && <Button onClick={() => setOpen(true)}>Raise a finding</Button>} />
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : !list.data ? <LoadingRows /> : (
        <Panel flush>
          {list.data.length === 0 ? <EmptyState title="No findings" /> : (
            <ul className="divide-y divide-line">
              {list.data.map((x) => (
                <li key={x.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-navy">{x.title}</p>
                    <span className="flex gap-1"><Badge tone={tone[x.severity]}>{x.severity.toLowerCase()}</Badge><StatusBadge status={x.status} /></span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-navy">{x.details}</p>
                  <p className="mt-1 text-xs text-muted">Raised by {x.raisedByName} · {dateTime(x.createdAt)}{x.reference ? ` · ref ${x.reference}` : ''}</p>
                  {x.response && <p className="mt-2 rounded-md bg-canvas px-3 py-2 text-sm"><strong>{x.respondedByName}:</strong> {x.response}</p>}
                  {x.canRespond && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setReply({ id: x.id, status: 'ACKNOWLEDGED', response: '' })}>Acknowledge</Button>
                      <Button size="sm" onClick={() => setReply({ id: x.id, status: 'RESOLVED', response: '' })}>Resolve</Button>
                      <Button size="sm" variant="ghost" onClick={() => setReply({ id: x.id, status: 'REJECTED', response: '' })}>Dispute</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Raise an audit finding">
          <div className="space-y-3">
            <Field label="Title" htmlFor="f-t"><Input id="f-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="What did you find?" htmlFor="f-d"><Textarea id="f-d" rows={4} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severity" htmlFor="f-s"><Select id="f-s" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select></Field>
              <Field label="Transaction reference (optional)" htmlFor="f-r"><Input id="f-r" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => raise.mutate(undefined)} loading={raise.isPending} disabled={f.title.length < 5 || f.details.length < 10}>Raise finding</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reply} onOpenChange={(o) => !o && setReply(null)}>
        <DialogContent title={`${reply?.status === 'RESOLVED' ? 'Resolve' : reply?.status === 'REJECTED' ? 'Dispute' : 'Acknowledge'} finding`} description="Explain what was done. Corrections themselves go through reversals or adjustments.">
          <div className="space-y-3">
            <Textarea rows={3} value={reply?.response ?? ''} onChange={(e) => setReply(reply && { ...reply, response: e.target.value })} aria-label="Response" />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setReply(null)}>Cancel</Button><Button onClick={() => respond.mutate(undefined)} loading={respond.isPending} disabled={(reply?.response.trim().length ?? 0) < 5}>Submit</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
