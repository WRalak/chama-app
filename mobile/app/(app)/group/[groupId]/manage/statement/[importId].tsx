import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MemberRow, Permission, STATEMENT_MATCH_LABELS, StatementLineRow } from '@chamahub/shared';
import { Badge, Button, Chips, Empty, ErrorView, Field, Loading, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { dateTime, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

const TONE = { REPORT_MATCH: 'green', STRONG: 'green', SUGGESTED: 'amber', AMBIGUOUS: 'red', UNMATCHED: 'red', DUPLICATE: 'neutral', OUTGOING: 'neutral' } as const;

function Line({ l, groupId, members, canManage, last }: { l: StatementLineRow; groupId: string; members: MemberRow[]; canManage: boolean; last: boolean }) {
  const [choice, setChoice] = useState(l.suggestedMemberId ?? '');
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const inv = { invalidate: [['statement-lines', groupId], ['statement-imports', groupId], ['group-dashboard', groupId]] };
  const resolve = useAct((body: object) => api<{ paymentStatus?: string }>(`groups/${groupId}/statement-lines/${l.id}/resolve`, { body }), { ...inv, onSuccess: (r) => setTimeout(() => alert(r.paymentStatus === 'CONFIRMED' ? 'Confirmed: the member’s report matched the statement.' : r.paymentStatus === 'PENDING' ? 'Recorded for the member. A second officer must verify it.' : 'Done.'), 50) });
  const candidateIds = new Set(l.candidates.map((c) => c.membershipId));
  const others = members.filter((m) => !candidateIds.has(m.membershipId) && (!search || m.fullName.toLowerCase().includes(search.toLowerCase()))).slice(0, 8);
  const open = l.state === 'OPEN';
  const blocked = l.match === 'DUPLICATE' || l.match === 'OUTGOING';
  const name = (id: string) => members.find((m) => m.membershipId === id)?.fullName ?? l.candidates.find((c) => c.membershipId === id)?.fullName ?? 'this member';
  return (
    <View style={{ padding: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, opacity: open ? 1 : 0.7 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T variant="label">{`${kes(l.amountCents)}${l.reference ? ` · ${l.reference}` : ''}`}</T>
          <T variant="small">{`Row ${l.rowNo} · ${dateTime(l.transactionAt)}`}</T>
          <T variant="small">{[l.payerName, l.payerPhone, l.accountReference && `A/C ${l.accountReference}`].filter(Boolean).join(' · ') || l.description || 'No payer details'}</T>
        </View>
        <Badge label={open ? STATEMENT_MATCH_LABELS[l.match] : l.state === 'CONFIRMED' ? 'Done' : 'Ignored'} tone={open ? TONE[l.match] : l.state === 'CONFIRMED' ? 'green' : 'neutral'} />
      </View>
      <T variant="small" style={{ marginTop: 4 }}>{l.explanation}</T>
      {!open && <T variant="small">{l.state === 'CONFIRMED' ? `Assigned to ${l.resolvedMemberName} by ${l.resolvedByName}${l.resolvedPaymentStatus === 'PENDING' ? ' — waiting for a second officer' : ''}` : `Ignored by ${l.resolvedByName}: ${l.resolutionNote}`}</T>}
      {open && canManage && !blocked && !ignoring && (
        <View style={{ marginTop: space.sm, gap: space.xs }}>
          {l.candidates.length > 0 && <T variant="small">{l.match === 'AMBIGUOUS' ? 'Several members fit. Choose the right one:' : 'Candidates:'}</T>}
          {l.candidates.length > 0 && <Chips value={choice} onChange={setChoice} options={l.candidates.map((c) => ({ value: c.membershipId, label: `${c.fullName} (${c.reasons[0]?.toLowerCase() ?? 'match'})` }))} />}
          <Field label="Or find another member" value={search} onChangeText={setSearch} placeholder="Type a name" />
          {search.length > 0 && <Chips value={choice} onChange={setChoice} options={others.map((m) => ({ value: m.membershipId, label: m.fullName }))} />}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title={choice ? `Assign to ${name(choice).split(' ')[0]}` : 'Choose a member'} style={{ flex: 1 }} disabled={!choice} loading={resolve.isPending} onPress={() => askToConfirm('Assign this payment?', `${kes(l.amountCents)} to ${name(choice)}.${l.reportPaymentId ? '' : ' It still needs a second officer to verify it.'}`, 'Assign', () => resolve.mutate({ action: 'CONFIRM', memberId: choice, purpose: 'CONTRIBUTION' }))} />
            <Button title="Ignore" variant="secondary" style={{ flex: 1 }} onPress={() => setIgnoring(true)} />
          </View>
        </View>
      )}
      {open && canManage && (blocked || ignoring) && (
        <View style={{ marginTop: space.sm, gap: space.xs }}>
          <Field label="Why ignore it? (kept in the audit log)" value={reason} onChangeText={setReason} placeholder={l.match === 'OUTGOING' ? 'e.g. Bank charges' : l.match === 'DUPLICATE' ? 'e.g. Already recorded' : 'e.g. Not a member payment'} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Ignore line" variant="secondary" style={{ flex: 1 }} disabled={reason.trim().length < 5} loading={resolve.isPending} onPress={() => resolve.mutate({ action: 'IGNORE', reason: reason.trim() })} />
            {ignoring && <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setIgnoring(false)} />}
          </View>
        </View>
      )}
    </View>
  );
}

/** The review queue for one imported statement. */
export default function StatementReview() {
  const { groupId, can } = useGroupAccess();
  const { importId } = useLocalSearchParams<{ importId: string }>();
  const [filter, setFilter] = useState<'review' | 'clear' | 'done' | 'all'>('review');
  const lines = useQuery({ queryKey: ['statement-lines', groupId, importId], queryFn: () => api<StatementLineRow[]>(`groups/${groupId}/statement-imports/${importId}/lines`) });
  const members = useQuery({ queryKey: ['members', groupId, 'ALL'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`), enabled: can(Permission.MEMBERS_VIEW) });
  const canManage = can(Permission.RECONCILIATION_MANAGE);
  const inv = { invalidate: [['statement-lines', groupId], ['statement-imports', groupId], ['group-dashboard', groupId]] };
  const all = lines.data ?? [];
  const clear = all.filter((l) => l.state === 'OPEN' && (l.match === 'REPORT_MATCH' || l.match === 'STRONG'));
  const bulk = useAct(() => api<{ confirmed: number; failed: { error: string }[] }>(`groups/${groupId}/statement-lines/confirm-matches`, { body: { lineIds: clear.map((l) => l.id) } }), { ...inv, onSuccess: (r) => setTimeout(() => alert(`${r.confirmed} confirmed.${r.failed.length ? ` ${r.failed.length} need attention: ${r.failed[0].error}` : ''}`), 50) });
  const close = useAct(() => api(`groups/${groupId}/statement-imports/${importId}/close`, { body: {} }), { ...inv, successMessage: 'Statement closed.' });
  const discard = useAct(() => api(`groups/${groupId}/statement-imports/${importId}/discard`, { body: {} }), { ...inv, successMessage: 'Statement discarded.' });
  const shown = all.filter((l) => (filter === 'all' ? true : filter === 'done' ? l.state !== 'OPEN' : filter === 'clear' ? clear.includes(l) : l.state === 'OPEN' && !clear.includes(l)));
  const openNeedingDecision = all.filter((l) => l.state === 'OPEN' && l.match !== 'DUPLICATE' && l.match !== 'OUTGOING').length;
  return (
    <Screen refreshing={lines.isRefetching} onRefresh={lines.refetch} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Review statement' }} />
      {lines.error ? <ErrorView error={lines.error} onRetry={lines.refetch} /> : !lines.data ? <Loading /> : (
        <>
          {canManage && clear.length > 0 && (
            <Notice tone="green" icon="checkmark-circle-outline">{`${clear.length} clear match${clear.length > 1 ? 'es' : ''}: the member reported the code, or paid from their registered phone. Check them, then confirm together.`}</Notice>
          )}
          {canManage && clear.length > 0 && <Button title={`Confirm ${clear.length} clear matches`} onPress={() => askToConfirm('Confirm clear matches?', 'Reported payments are confirmed now; the others are recorded for a second officer to verify.', 'Confirm', () => bulk.mutate(undefined))} loading={bulk.isPending} style={{ marginBottom: space.lg }} />}
          <Chips value={filter} onChange={setFilter} options={[{ value: 'review', label: 'Needs a person' }, { value: 'clear', label: `Clear (${clear.length})` }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
          <Section>
            {shown.length === 0 ? <Empty title="Nothing here" icon="checkmark-done-outline" /> : shown.map((l, i) => <Line key={l.id} l={l} groupId={groupId} members={members.data ?? []} canManage={canManage} last={i === shown.length - 1} />)}
          </Section>
          {canManage && (
            <View style={{ gap: space.sm }}>
              <Button title="Close statement" variant="secondary" disabled={openNeedingDecision > 0} onPress={() => close.mutate(undefined)} loading={close.isPending} />
              {openNeedingDecision > 0 && <T variant="small">{`${openNeedingDecision} line${openNeedingDecision > 1 ? 's' : ''} still need a decision before closing.`}</T>}
              {!all.some((l) => l.state === 'CONFIRMED') && <Button title="Discard this import" variant="ghost" onPress={() => askToConfirm('Discard this import?', 'Use this if the wrong file or columns were used. Nothing was recorded from it.', 'Discard', () => discard.mutate(undefined))} />}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
