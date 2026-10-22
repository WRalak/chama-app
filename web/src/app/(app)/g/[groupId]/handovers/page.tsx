'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { HandoverRow, LABELS, Permission } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroup, useGroupId } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

const ROLES = ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY'] as const;

function HandoverCard({ h }: { h: HandoverRow }) {
  const groupId = useGroupId();
  const [note, setNote] = useState('');
  const ack = useAction(() => api(`groups/${groupId}/handovers/${h.id}/acknowledge`, { body: { note: note.trim() || undefined } }), { success: 'Handover acknowledged', invalidate: [['handovers', groupId]] });
  const s = h.snapshot;
  const rows: [string, string][] = [
    ['Cash per ledger', kes(s.cashBalanceCents)],
    ['Confirmed contributions (all time)', kes(s.confirmedContributionsCents)],
    ['Owed by members', `${kes(s.outstandingContributionsCents)} · ${s.membersOwing} members`],
    ['Awaiting verification', `${kes(s.pendingVerification.cents)} · ${s.pendingVerification.count} payments`],
    ['Loans outstanding', `${kes(s.loansOutstanding.cents)} · ${s.loansOutstanding.count} loans`],
    ['Open reconciliation', `${s.unmatchedPayments} unmatched · ${s.openStatementLines} statement lines · ${s.openDisputes} disputes`],
    ['Waiting for approval', `${s.pendingApprovals.expenses} expenses · ${s.pendingApprovals.payouts} payouts · ${s.pendingApprovals.loans} loans · ${s.pendingApprovals.destinations} payment details`],
    ['Payment destinations', s.activeDestinations.join(', ') || '—'],
    ['Next payout', s.nextPayout ? `Round ${s.nextPayout.round}: ${s.nextPayout.recipientName}, ${date(s.nextPayout.payoutDate)}` : '—'],
    ['Open action items', String(s.openActionItems)],
  ];
  return (
    <Panel title={<span className="flex items-center gap-2">{LABELS.groupRole[h.role]} · {date(h.createdAt)} {h.acknowledgedAt ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="amber">Awaiting acknowledgement</Badge>}</span>}>
      <p className="mb-2 text-sm">
        <span className="text-muted">From</span> {h.outgoingName ?? '—'} <span className="text-muted">to</span> {h.incomingName ?? '—'} · <span className="text-muted">{h.trigger === 'manual' ? 'prepared by' : 'recorded when the role changed, by'}</span> {h.createdByName}
      </p>
      <dl className="grid grid-cols-[minmax(12rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-muted">Figures read from the ledger {dateTime(s.asOf)}. This record cannot be edited.</p>
      {h.notes && <p className="mt-3 rounded-lg bg-canvas p-3 text-sm"><span className="font-semibold">Notes:</span> {h.notes}</p>}
      {h.acknowledgedAt && <p className="mt-2 text-sm">Acknowledged by {h.acknowledgedByName} · {dateTime(h.acknowledgedAt)}{h.acknowledgementNote ? ` — “${h.acknowledgementNote}”` : ''}</p>}
      {h.can.acknowledge && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="Note (optional)" htmlFor={`n-${h.id}`} className="flex-1"><Textarea id={`n-${h.id}`} rows={2} className="min-h-0" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash box, receipt books and passbook received" /></Field>
          <Button loading={ack.isPending} onClick={() => { if (confirm('Acknowledge this handover? It confirms you received the records as shown and is kept permanently.')) ack.mutate(undefined); }}>I have received these records</Button>
        </div>
      )}
    </Panel>
  );
}

export default function HandoversPage() {
  const groupId = useGroupId();
  const can = useCan();
  const { data: group } = useGroup();
  const q = useQuery({ queryKey: ['handovers', groupId], queryFn: () => api<HandoverRow[]>(`groups/${groupId}/handovers`) });
  const myRole = group?.myMembership.role;
  const officer = myRole && (ROLES as readonly string[]).includes(myRole) ? myRole : null;
  const [role, setRole] = useState<string>(officer ?? 'TREASURER');
  const [notes, setNotes] = useState('');
  const prepare = useAction(() => api(`groups/${groupId}/handovers`, { body: { role, notes: notes.trim() || undefined } }), { success: 'Handover recorded with today’s figures', invalidate: [['handovers', groupId]], onSuccess: () => setNotes('') });
  const canPrepare = !!officer || can(Permission.GROUP_CONFIGURE);
  return (
    <>
      <PageHeader title="Officer handovers" description="Recorded automatically whenever a chairperson, vice chairperson, treasurer or secretary changes, with figures from the ledger at that moment. The incoming officer acknowledges receipt." />
      {canPrepare && (
        <Panel title="Prepare a handover" className="mb-5">
          <div className="flex flex-wrap items-end gap-3">
            {can(Permission.GROUP_CONFIGURE) && (
              <Field label="Office" htmlFor="h-role"><Select id="h-role" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{LABELS.groupRole[r]}</option>)}</Select></Field>
            )}
            <Field label="Notes for the next officer" htmlFor="h-notes" className="min-w-[18rem] flex-1"><Textarea id="h-notes" rows={2} className="min-h-0" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where the cash box, receipt books and passbook are; anything unfinished" /></Field>
            <Button onClick={() => prepare.mutate(undefined)} loading={prepare.isPending}>Record with today’s figures</Button>
          </div>
        </Panel>
      )}
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data ? <LoadingRows /> : q.data.length === 0 ? <EmptyState title="No handovers yet" description="They appear here when an officer role changes or an officer prepares one." /> : (
        <div className="grid gap-4 xl:grid-cols-2">{q.data.map((h) => <HandoverCard key={h.id} h={h} />)}</div>
      )}
    </>
  );
}
