'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PlatformPermission, SUPPORT_LABELS, SUPPORT_PRIORITIES, type SupportCaseDetail } from '@chamahub/shared';
import { CaseStatus, PRIORITY_TONE } from '@/components/platform/case-list';
import { ConfirmAction } from '@/components/platform/confirm-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/platform-session';
import { cn, date, dateTime } from '@/lib/utils';

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = usePlatformCan();
  const key = ['support-case', id];
  const c = useQuery({ queryKey: key, queryFn: () => api<SupportCaseDetail>(`platform/support/cases/${id}`) });
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const inv = [key, ['support-cases'], ['platform-attention']];
  const send = useAction((clarify: boolean) => api(`platform/support/cases/${id}/reply`, { body: { body: reply, requestClarification: clarify } }), { success: 'Reply sent to the user', invalidate: inv, onSuccess: () => setReply('') });
  const addNote = useAction(() => api(`platform/support/cases/${id}/notes`, { body: { body: note } }), { success: 'Internal note added', invalidate: inv, onSuccess: () => setNote('') });
  const status = useAction((v: { status: string; resolution?: string }) => api(`platform/support/cases/${id}/status`, { body: v }), { success: 'Status updated', invalidate: inv });
  const escalate = useAction((reason: string) => api(`platform/support/cases/${id}/escalate`, { body: { reason } }), { success: 'Escalated', invalidate: inv });
  const priority = useAction((p: string) => api(`platform/support/cases/${id}/priority`, { body: { priority: p } }), { success: 'Priority changed', invalidate: inv });

  if (c.error) return <Panel><ErrorState error={c.error} onRetry={() => c.refetch()} /></Panel>;
  if (!c.data) return <Panel><LoadingRows rows={8} /></Panel>;
  const d = c.data;
  const closed = d.status === 'CLOSED';

  return (
    <>
      <PageHeader
        title={`${d.number} · ${d.subject}`}
        description={<span className="inline-flex flex-wrap items-center gap-2"><CaseStatus status={d.status} /><Badge tone={PRIORITY_TONE[d.priority]} icon={false}>{SUPPORT_LABELS.priority[d.priority]} priority</Badge><span>{SUPPORT_LABELS.category[d.category]}</span><span>· opened {dateTime(d.createdAt)}</span></span>}
        actions={<Link href={can(PlatformPermission.PLATFORM_SUPPORT_MANAGE) ? '/platform/support' : '/platform/support/mine'} className="text-sm text-berry hover:underline">Back to cases</Link>}
      />
      {d.financialGuidance && (
        <div className="mb-5 flex gap-2 rounded-lg border border-pending/40 bg-pending-50 px-3 py-2 text-sm text-pending-ink" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{d.financialGuidance}</p>
        </div>
      )}
      {d.escalationReason && d.status === 'ESCALATED' && <p className="mb-5 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-ink">Escalated: {d.escalationReason}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Conversation with the user">
            <ol className="space-y-3">
              {d.messages.map((m) => (
                <li key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.from === 'STAFF' ? 'ml-auto bg-blush/70 text-plum' : 'bg-canvas text-plum ring-1 ring-line')}>
                  <p className="mb-0.5 text-xs text-muted">{m.authorName} · {dateTime(m.createdAt)}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ol>
            {d.canWork && !closed && (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <Field label="Reply to the user" htmlFor="reply" hint="The user sees this. Never ask for PINs, passwords or one-time codes.">
                  <Textarea id="reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" disabled={!reply.trim()} loading={send.isPending} onClick={() => send.mutate(true)}>Ask for more information</Button>
                  <Button disabled={!reply.trim()} loading={send.isPending} onClick={() => send.mutate(false)}>Send reply</Button>
                </div>
              </div>
            )}
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden /> Internal notes (staff only)</span>}>
            {d.notes.length ? (
              <ol className="space-y-2">
                {d.notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-[#FFF8E6] px-3 py-2 text-sm text-plum">
                    <p className="mb-0.5 text-xs text-muted">{n.authorName} · {dateTime(n.createdAt)}</p>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">No notes yet. Users never see notes.</p>}
            {d.canWork && (
              <div className="mt-3 flex gap-2">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for other staff" aria-label="Internal note" maxLength={5000} />
                <Button variant="secondary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(undefined)}>Add</Button>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Case">
            <div className="space-y-3">
              {d.canAssign && <AssignControl id={id} current={d.assignedTo?.id ?? null} onDone={() => c.refetch()} />}
              {!d.canAssign && <KeyValues items={[['Assigned to', d.assignedTo?.name ?? 'Unassigned']]} />}
              {d.canAssign && (
                <Field label="Priority" htmlFor="prio">
                  <Select id="prio" value={d.priority} onChange={(e) => priority.mutate(e.target.value)}>
                    {SUPPORT_PRIORITIES.map((p) => <option key={p} value={p}>{SUPPORT_LABELS.priority[p]}</option>)}
                  </Select>
                </Field>
              )}
              {d.canWork && !closed && (
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  {d.status !== 'IN_PROGRESS' && d.status !== 'RESOLVED' && <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: 'IN_PROGRESS' })}>Mark in progress</Button>}
                  {d.status === 'RESOLVED' && <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate({ status: 'IN_PROGRESS' })}>Reopen</Button>}
                  {d.status !== 'ESCALATED' && d.status !== 'RESOLVED' && (
                    <ConfirmAction trigger={(open) => <Button variant="secondary" onClick={open}>Escalate</Button>} title="Escalate this case?" description="It moves to the top of the inbox for a support manager." confirmLabel="Escalate" busy={escalate.isPending} onConfirm={(r) => escalate.mutateAsync(r)} />
                  )}
                  {d.status !== 'RESOLVED' && <ResolveDialog onResolve={(resolution) => status.mutateAsync({ status: 'RESOLVED', resolution })} busy={status.isPending} />}
                  {d.status === 'RESOLVED' && <ConfirmAction trigger={(open) => <Button onClick={open}>Close case</Button>} reason={false} title="Close the case?" description="The user can no longer reply; they can open a new case." confirmLabel="Close" busy={status.isPending} onConfirm={() => status.mutateAsync({ status: 'CLOSED' })} />}
                </div>
              )}
              {d.resolution && <div className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-ink"><p className="text-xs font-semibold">Resolution</p><p className="whitespace-pre-wrap">{d.resolution}</p></div>}
            </div>
          </Panel>

          <Panel title="Requester">
            <KeyValues
              items={[
                ['Name', d.requester.name],
                ['Phone', d.requester.phoneMasked],
                ['E-mail', d.requester.email ?? '—'],
                ['Account', d.requester.accountStatus.toLowerCase()],
                ['Member since', date(d.requester.memberSince)],
                ['Groups', d.requester.groups],
              ]}
            />
          </Panel>

          {d.group && (
            <Panel title="Group">
              <KeyValues items={[['Name', d.group.name], ['Country', d.group.countryCode], ['Members', d.group.members], ['Plan', d.group.plan], ['Status', d.group.status.toLowerCase()]]} />
              <p className="mt-3 text-xs text-muted">Group money is not shown here. If you need to see records, ask the chairperson for temporary read-only access.</p>
              {can(PlatformPermission.PLATFORM_REQUEST_GROUP_ACCESS) && !closed && <RequestAccess groupId={d.group.id} caseId={d.id} />}
            </Panel>
          )}

          {d.assignments.length > 0 && (
            <Panel title="Assignment history">
              <ul className="space-y-1 text-xs text-muted">{d.assignments.map((a, i) => <li key={i}>{dateTime(a.at)}: {a.to ? `to ${a.to}` : 'unassigned'} by {a.by}</li>)}</ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function ResolveDialog({ onResolve, busy }: { onResolve: (r: string) => Promise<unknown>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <>
      <Button onClick={() => setOpen(true)}>Resolve…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Resolve the case" description="The user sees this summary.">
          <div className="space-y-3">
            <Field label="Resolution summary" htmlFor="res" hint="What was wrong and what was done. Money corrections are made by the group's officers, not support.">
              <Textarea id="res" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button loading={busy} disabled={text.trim().length < 5} onClick={async () => { try { await onResolve(text.trim()); setOpen(false); setText(''); } catch { /* toast shown */ } }}>Resolve</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssignControl({ id, current, onDone }: { id: string; current: string | null; onDone: () => void }) {
  const people = useQuery({ queryKey: ['support-assignees'], queryFn: () => api<{ id: string; name: string; openCases: number }[]>('platform/support/assignees') });
  const assign = useAction((accountId: string | null) => api(`platform/support/cases/${id}/assign`, { body: { accountId } }), { success: 'Assignment updated', invalidate: [['support-cases'], ['support-assignees']], onSuccess: onDone });
  return (
    <Field label="Assigned to" htmlFor="assignee">
      <Select id="assignee" value={current ?? ''} disabled={assign.isPending} onChange={(e) => assign.mutate(e.target.value || null)}>
        <option value="">Unassigned</option>
        {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.openCases} open)</option>)}
      </Select>
    </Field>
  );
}

function RequestAccess({ groupId, caseId }: { groupId: string; caseId: string }) {
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [hours, setHours] = useState(2);
  const req = useAction(() => api('platform/support-access', { body: { groupId, caseId, purpose, hours } }), { success: 'Request sent to the chairperson', onSuccess: () => setOpen(false), invalidate: [['support-grants']] });
  return (
    <>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>Request read-only access</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Request read-only access" description="The group's chairperson decides. Access is read-only, time-limited and every view is recorded in both audit trails.">
          <div className="space-y-3">
            <Field label="Why you need it" htmlFor="purpose"><Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
            <Field label="Hours" htmlFor="hours" hint="Platform policy sets the maximum"><Input id="hours" type="number" min={1} max={72} value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={req.isPending} disabled={purpose.trim().length < 5} onClick={() => req.mutate(undefined)}>Send request</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
