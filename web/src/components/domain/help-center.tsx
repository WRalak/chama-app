'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type MySupportCase, SUPPORT_CATEGORIES, SUPPORT_LABELS, type SupportCategory } from '@chamahub/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useMyGroups } from '@/lib/session';
import { cn, dateTime } from '@/lib/utils';

const TONE: Record<string, Tone> = { OPEN: 'amber', ASSIGNED: 'blue', IN_PROGRESS: 'blue', WAITING_FOR_USER: 'rose', ESCALATED: 'blue', RESOLVED: 'green', CLOSED: 'neutral' };
/** Members see "being looked into" rather than internal routing such as escalation. */
const MEMBER_STATUS: Record<string, string> = { OPEN: 'Received', ASSIGNED: 'Being looked into', IN_PROGRESS: 'Being looked into', ESCALATED: 'Being looked into', WAITING_FOR_USER: 'Waiting for your reply', RESOLVED: 'Resolved', CLOSED: 'Closed' };

/** Members' help centre: open a case, follow the conversation with ChamaHub support, reply or close it. */
export function HelpCenter() {
  const cases = useQuery({ queryKey: ['my-support-cases'], queryFn: () => api<MySupportCase[]>('me/support-cases') });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = cases.data?.find((c) => c.id === openId) ?? null;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Panel title="Your support requests" actions={<Button size="sm" onClick={() => { setCreating(true); setOpenId(null); }}>New request</Button>} flush>
        {cases.error ? <ErrorState error={cases.error} onRetry={() => cases.refetch()} /> : !cases.data ? <LoadingRows rows={3} /> : !cases.data.length ? (
          <EmptyState title="No requests yet" description="Ask ChamaHub support about sign-in problems, the app, or your subscription." />
        ) : (
          <ul className="divide-y divide-line">
            {cases.data.map((c) => (
              <li key={c.id}>
                <button onClick={() => { setOpenId(c.id); setCreating(false); }} className={cn('w-full px-4 py-3 text-left hover:bg-canvas', openId === c.id && 'bg-blush/40')}>
                  <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-plum">{c.subject}</span><Badge tone={TONE[c.status]}>{MEMBER_STATUS[c.status]}</Badge></span>
                  <span className="text-xs text-muted">{c.number} · {SUPPORT_LABELS.category[c.category]}{c.groupName ? ` · ${c.groupName}` : ''} · {dateTime(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {creating ? <NewCase onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : selected ? <Thread c={selected} /> : (
        <Panel><p className="text-sm text-muted">For questions about your Chama’s money, ask your treasurer or chairperson first: only they can correct records. Never share your password, M-Pesa PIN or a verification code with anyone, including ChamaHub support.</p></Panel>
      )}
    </div>
  );
}

function NewCase({ onCreated }: { onCreated: (id: string) => void }) {
  const groups = useMyGroups();
  const [f, setF] = useState<{ subject: string; category: SupportCategory; description: string; groupId: string }>({ subject: '', category: 'TECHNICAL', description: '', groupId: '' });
  const send = useAction(() => api<MySupportCase>('me/support-cases', { body: { ...f, groupId: f.groupId || undefined } }), { success: (c) => `Request ${c.number} sent`, invalidate: [['my-support-cases']], onSuccess: (c) => onCreated(c.id) });
  const money = ['CONTRIBUTIONS_PAYMENTS', 'PAYOUT_ROTATION', 'LOANS_REPAYMENTS'].includes(f.category);
  return (
    <Panel title="New support request">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(undefined); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic" htmlFor="n-cat"><Select id="n-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as SupportCategory })}>{SUPPORT_CATEGORIES.map((c) => <option key={c} value={c}>{SUPPORT_LABELS.category[c]}</option>)}</Select></Field>
          <Field label="Which Chama? (optional)" htmlFor="n-grp"><Select id="n-grp" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}><option value="">Not about a Chama</option>{groups.data?.map((g) => <option key={g.groupId} value={g.groupId}>{g.name}</option>)}</Select></Field>
        </div>
        {money && <p className="rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Support can explain and check, but only your group’s officers can correct contributions, loans or payouts. Ask your treasurer too.</p>}
        <Field label="Subject" htmlFor="n-sub"><Input id="n-sub" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={200} /></Field>
        <Field label="What happened?" htmlFor="n-desc" hint="Include dates and M-Pesa confirmation codes if relevant. Never include your PIN, password or a verification code."><Textarea id="n-desc" rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} /></Field>
        <Button type="submit" loading={send.isPending} disabled={f.subject.trim().length < 3 || f.description.trim().length < 10}>Send request</Button>
      </form>
    </Panel>
  );
}

function Thread({ c }: { c: MySupportCase }) {
  const [body, setBody] = useState('');
  const reply = useAction(() => api(`me/support-cases/${c.id}/messages`, { body: { body } }), { success: 'Sent', invalidate: [['my-support-cases']], onSuccess: () => setBody('') });
  const close = useAction(() => api(`me/support-cases/${c.id}/close`, { body: {} }), { success: 'Request closed', invalidate: [['my-support-cases']] });
  return (
    <Panel title={`${c.number} · ${c.subject}`} actions={<Badge tone={TONE[c.status]}>{MEMBER_STATUS[c.status]}</Badge>}>
      <ol className="space-y-3">
        {c.messages.map((m) => (
          <li key={m.id} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.from === 'YOU' ? 'ml-auto bg-blush/70' : 'bg-canvas ring-1 ring-line')}>
            <p className="mb-0.5 text-xs text-muted">{m.authorName} · {dateTime(m.createdAt)}</p>
            <p className="whitespace-pre-wrap text-plum">{m.body}</p>
          </li>
        ))}
      </ol>
      {c.resolution && <div className="mt-4 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-ink"><p className="text-xs font-semibold">How it was resolved</p><p className="whitespace-pre-wrap">{c.resolution}</p></div>}
      {c.status !== 'CLOSED' && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <Field label={c.status === 'RESOLVED' ? 'Still need help? Reply to reopen' : 'Reply'} htmlFor="t-reply"><Textarea id="t-reply" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} /></Field>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" loading={close.isPending} onClick={() => close.mutate(undefined)}>Close request</Button>
            <Button loading={reply.isPending} disabled={!body.trim()} onClick={() => reply.mutate(undefined)}>Send</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
