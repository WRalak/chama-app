import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { HandoverRow, LABELS, Permission } from '@chamahub/shared';
import { Badge, Button, Chips, Empty, ErrorView, Field, KV, Loading, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, dateTime, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

function Card({ h, groupId }: { h: HandoverRow; groupId: string }) {
  const [note, setNote] = useState('');
  const ack = useAct(() => api(`groups/${groupId}/handovers/${h.id}/acknowledge`, { body: { note: note.trim() || undefined } }), { invalidate: [['handovers', groupId]], successMessage: 'Acknowledged. The handover is now on record as received.' });
  const s = h.snapshot;
  return (
    <Section title={`${LABELS.groupRole[h.role]} · ${date(h.createdAt)}`} action={h.acknowledgedAt ? <Badge label="Acknowledged" tone="green" /> : <Badge label="Awaiting acknowledgement" tone="amber" />}>
      <KV label="From" value={h.outgoingName ?? '—'} />
      <KV label="To" value={h.incomingName ?? '—'} />
      <KV label="Figures read" value={dateTime(s.asOf)} />
      <KV label="Cash per ledger" value={kes(s.cashBalanceCents)} />
      <KV label="Confirmed contributions (all time)" value={kes(s.confirmedContributionsCents)} />
      <KV label="Owed by members" value={`${kes(s.outstandingContributionsCents)} · ${s.membersOwing} members`} />
      <KV label="Awaiting verification" value={`${kes(s.pendingVerification.cents)} · ${s.pendingVerification.count}`} />
      <KV label="Loans outstanding" value={`${kes(s.loansOutstanding.cents)} · ${s.loansOutstanding.count} loans`} />
      <KV label="Open reconciliation" value={`${s.unmatchedPayments} unmatched · ${s.openStatementLines} statement lines · ${s.openDisputes} disputes`} />
      <KV label="Waiting for approval" value={`${s.pendingApprovals.expenses} expenses · ${s.pendingApprovals.payouts} payouts · ${s.pendingApprovals.loans} loans · ${s.pendingApprovals.destinations} payment details`} />
      <KV label="Payment destinations" value={s.activeDestinations.join(', ') || '—'} />
      <KV label="Next payout" value={s.nextPayout ? `Round ${s.nextPayout.round}: ${s.nextPayout.recipientName}, ${date(s.nextPayout.payoutDate)}` : '—'} />
      <KV label="Open action items" value={String(s.openActionItems)} last={!h.notes && !h.acknowledgedAt && !h.can.acknowledge} />
      {h.notes && <View style={{ padding: space.lg }}><T variant="small">{`Notes from ${h.createdByName}:`}</T><T variant="body">{h.notes}</T></View>}
      {h.acknowledgedAt && <View style={{ padding: space.lg }}><T variant="small">{`Acknowledged by ${h.acknowledgedByName} · ${dateTime(h.acknowledgedAt)}${h.acknowledgementNote ? ` — “${h.acknowledgementNote}”` : ''}`}</T></View>}
      {h.can.acknowledge && (
        <View style={{ padding: space.lg }}>
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Cash box, receipt books and passbook received" />
          <Button title="I have received these records" onPress={() => askToConfirm('Acknowledge the handover?', 'This confirms you received the records as shown. It is kept permanently.', 'Acknowledge', () => ack.mutate(undefined))} loading={ack.isPending} />
        </View>
      )}
    </Section>
  );
}

/** Permanent records of what each officer handed over, read from the ledger at the time. */
export default function Handovers() {
  const { groupId, group, can } = useGroupAccess();
  const q = useQuery({ queryKey: ['handovers', groupId], queryFn: () => api<HandoverRow[]>(`groups/${groupId}/handovers`) });
  const myRole = group.data?.myMembership.role;
  const [notes, setNotes] = useState('');
  const officerRole = myRole && ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY'].includes(myRole) ? myRole : null;
  const [role, setRole] = useState<string>(officerRole ?? 'TREASURER');
  const prepare = useAct(() => api(`groups/${groupId}/handovers`, { body: { role, notes: notes.trim() || undefined } }), { invalidate: [['handovers', groupId]], successMessage: 'Handover recorded with today’s figures.', onSuccess: () => setNotes('') });
  const canPrepare = !!officerRole || can(Permission.GROUP_CONFIGURE);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Officer handovers' }} />
      <Notice tone="neutral" icon="lock-closed-outline">A handover is recorded automatically whenever a chairperson, vice chairperson, treasurer or secretary changes. Figures come from the ledger at that moment and cannot be edited.</Notice>
      {canPrepare && (
        <Section title="Prepare a handover">
          <View style={{ padding: space.lg }}>
            {can(Permission.GROUP_CONFIGURE) && <Chips value={role} onChange={setRole} options={['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY'].map((r) => ({ value: r, label: LABELS.groupRole[r as keyof typeof LABELS.groupRole] }))} />}
            <Field label="Notes for the next officer" value={notes} onChangeText={setNotes} multiline placeholder="Where the cash box, receipt books and passbook are; anything unfinished" />
            <Button title="Record handover with today’s figures" onPress={() => prepare.mutate(undefined)} loading={prepare.isPending} />
          </View>
        </Section>
      )}
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : q.data.length === 0 ? <Empty title="No handovers yet" icon="swap-horizontal-outline" /> : q.data.map((h) => <Card key={h.id} h={h} groupId={groupId} />)}
      <T variant="small" style={{ textAlign: 'center', color: colors.muted }}>Members see the handovers they took part in; officers and auditors see all.</T>
    </Screen>
  );
}
