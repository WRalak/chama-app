import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { PaymentDestinationRow, Permission } from '@chamahub/shared';
import { DestinationCard } from '@/components/destination';
import { Button, Empty, ErrorView, Field, Loading, NoAccess, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useDestinations } from '@/lib/collections';
import { askToConfirm } from '@/lib/confirm';
import { dateTime } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

function Actions({ d, groupId }: { d: PaymentDestinationRow; groupId: string }) {
  const [mode, setMode] = useState<'none' | 'reject' | 'retire'>('none');
  const [text, setText] = useState('');
  const inv = { invalidate: [['destinations', groupId], ['group-dashboard', groupId]] };
  const decide = useAct((decision: 'APPROVE' | 'REJECT') => api<{ status: string }>(`groups/${groupId}/payment-destinations/${d.id}/decision`, { body: { decision, comment: text.trim() || undefined } }), { ...inv, onSuccess: (r) => { setMode('none'); setText(''); setTimeout(() => alert(r.status === 'ACTIVE' ? 'Approved. Members have been told about the new details.' : r.status === 'REJECTED' ? 'Rejected.' : 'Your approval is recorded. Another approval is still needed.'), 50); } });
  const retire = useAct(() => api(`groups/${groupId}/payment-destinations/${d.id}/retire`, { body: { reason: text.trim() } }), { ...inv, successMessage: 'Retired. Members have been told to stop paying there.' });
  return (
    <View style={{ marginTop: space.sm, gap: space.sm }}>
      {d.approvals.map((a) => <T key={a.id} variant="small">{`${a.decision === 'APPROVED' ? '✓ Approved' : '✕ Rejected'} by ${a.approverName} · ${dateTime(a.createdAt)}${a.comment ? ` — “${a.comment}”` : ''}`}</T>)}
      {d.status === 'PENDING_APPROVAL' && <T variant="small">{`Proposed by ${d.proposedByName}${d.proposalReason ? `: “${d.proposalReason}”` : ''} · ${d.approvals.filter((a) => a.decision === 'APPROVED').length} of ${d.approvalsRequired} approvals`}</T>}
      {d.rejectionReason && <T variant="small">{`Rejected: ${d.rejectionReason}`}</T>}
      {d.can.approve && mode === 'none' && (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Approve" style={{ flex: 1 }} onPress={() => askToConfirm('Approve these payment details?', 'Check the number, account name and reference with the account holder first. Members will be told to pay here.', 'Approve', () => decide.mutate('APPROVE'))} loading={decide.isPending} />
          <Button title="Reject" variant="secondary" style={{ flex: 1 }} onPress={() => setMode('reject')} />
        </View>
      )}
      {(d.can.replace || d.can.retire) && mode === 'none' && (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {d.can.replace && <Button title="Change details" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/(app)/group/[groupId]/manage/destination-new', params: { groupId, replacesId: d.id, type: d.type } })} />}
          {d.can.retire && <Button title="Stop using" variant="ghost" style={{ flex: 1 }} onPress={() => setMode('retire')} />}
        </View>
      )}
      {mode !== 'none' && (
        <>
          <Field label={mode === 'reject' ? 'Why are you rejecting it?' : 'Why stop using it? (members will be told)'} value={text} onChangeText={setText} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title={mode === 'reject' ? 'Reject' : 'Stop using'} variant="danger" style={{ flex: 1 }} disabled={text.trim().length < 5} onPress={() => (mode === 'reject' ? decide.mutate('REJECT') : retire.mutate(undefined))} loading={decide.isPending || retire.isPending} />
            <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => { setMode('none'); setText(''); }} />
          </View>
        </>
      )}
    </View>
  );
}

/** Where the group collects money. Every new or changed destination waits for another officer’s approval. */
export default function Destinations() {
  const { groupId, can, canAny } = useGroupAccess();
  const q = useDestinations(groupId);
  if (!canAny(Permission.DESTINATIONS_MANAGE, Permission.CONTRIBUTIONS_VIEW_ALL, Permission.AUDIT_VIEW, Permission.PAYOUTS_APPROVE)) return <NoAccess what="payment destinations" />;
  const rows = q.data ?? [];
  const groups: [string, PaymentDestinationRow[]][] = [
    ['Waiting for approval', rows.filter((d) => d.status === 'PENDING_APPROVAL')],
    ['In use', rows.filter((d) => d.status === 'ACTIVE')],
    ['History', rows.filter((d) => d.status === 'RETIRED' || d.status === 'REJECTED')],
  ];
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'Payment destinations' }} />
      <Notice tone="neutral" icon="lock-closed-outline">ChamaHub never asks for or stores a PIN, password or OTP, and does not log into these accounts. Payments are confirmed by an officer, an imported statement or a provider callback.</Notice>
      {can(Permission.DESTINATIONS_MANAGE) && <Button title="Add a payment destination" icon="add-circle-outline" onPress={() => router.push({ pathname: '/(app)/group/[groupId]/manage/destination-new', params: { groupId } })} style={{ marginBottom: space.lg }} />}
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : rows.length === 0 ? <Empty title="No payment destinations yet" body="Add the group’s Paybill, Till, bank account or the treasurer’s M-Pesa number so members know where to pay." icon="wallet-outline" /> : groups.filter(([, list]) => list.length).map(([title, list]) => (
        <Section key={title} title={title}>
          {list.map((d, i) => <DestinationCard key={d.id} d={d} last={i === list.length - 1} footer={<Actions d={d} groupId={groupId} />} />)}
        </Section>
      ))}
    </Screen>
  );
}
