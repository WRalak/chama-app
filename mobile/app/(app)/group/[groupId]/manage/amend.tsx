import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { LABELS, MemberRow, Permission, ROTATION_AMENDMENT_KINDS, RotationAmendmentKind, RotationCycle } from '@chamahub/shared';
import { OrderList } from '@/components/order-list';
import { Button, Chips, Field, Loading, NoAccess, Notice, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

const LOCKED = ['AWAITING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED'];

/** Proposes a change to rounds that have not entered payout; another officer must approve it. */
export default function Amend() {
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();
  const { groupId, group, can } = useGroupAccess();
  const cycle = useQuery({ queryKey: ['rotations', groupId, cycleId], queryFn: () => api<RotationCycle>(`groups/${groupId}/rotations/${cycleId}`) });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }) });
  const [kind, setKind] = useState<RotationAmendmentKind>('REORDER');
  const [order, setOrder] = useState<string[]>([]);
  const [memberId, setMemberId] = useState('');
  const [joining, setJoining] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const c = cycle.data;
  const lockedRounds = new Set(c?.rounds.filter((r) => LOCKED.includes(r.status)).map((r) => r.round));
  const live = c?.rounds.filter((r) => r.status !== 'CANCELLED') ?? [];
  const movable = live.filter((r) => !lockedRounds.has(r.round));
  const inRotation = new Set(live.map((r) => r.recipientMembershipId));
  const outside = (members.data ?? []).filter((m) => !inRotation.has(m.membershipId));
  const names = new Map([...live.map((r) => [r.recipientMembershipId, r.recipientName] as const), ...(members.data ?? []).map((m) => [m.membershipId, m.fullName] as const)]);
  useEffect(() => {
    if (c && order.length === 0) setOrder(movable.map((r) => r.recipientMembershipId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);
  const body = kind === 'REORDER' ? { kind, order, reason } : kind === 'ADD_MEMBERS' ? { kind, memberIds: joining, reason } : kind === 'REMOVE_MEMBER' ? { kind, memberId, reason } : { kind, memberId, replacementId: joining[0], reason };
  const propose = useAct(() => api(`groups/${groupId}/rotations/${cycleId}/amendments`, { body }), { invalidate: [['rotations', groupId], ['group-dashboard', groupId]], successMessage: 'Proposed. It applies only after another officer approves it, and affected members are told.', onSuccess: () => router.back() });
  const k = c?.recipientsPerRound ?? 1;
  const valid = reason.trim().length >= 5 && (kind === 'REORDER' ? movable.length > 1 : kind === 'ADD_MEMBERS' ? joining.length > 0 && joining.length % k === 0 : kind === 'REMOVE_MEMBER' ? !!memberId : !!memberId && joining.length === 1);
  if (group.data && !can(Permission.ROTATIONS_MANAGE)) return <Screen><Stack.Screen options={{ title: 'Amend schedule' }} /><NoAccess what="managing rotations" /></Screen>;
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Amend schedule' }} />
      {!c || !members.data ? <Loading /> : (
        <>
          <Notice tone="neutral">Only rounds that have not entered payout can change. The approved schedule is kept, and this amendment is recorded with your name and reason.</Notice>
          <Chips value={kind} onChange={(v) => { setKind(v); setMemberId(''); setJoining([]); }} options={ROTATION_AMENDMENT_KINDS.filter((x) => !(x === 'REMOVE_MEMBER' && k > 1)).map((x) => ({ value: x, label: LABELS.rotationAmendment[x] }))} />
          {kind === 'REORDER' && <OrderList order={order} names={names} onChange={setOrder} perRound={k} firstRound={movable[0]?.round ?? 1} />}
          {(kind === 'REMOVE_MEMBER' || kind === 'REPLACE_MEMBER') && (
            <>
              <T variant="label" style={{ marginBottom: 6 }}>{kind === 'REMOVE_MEMBER' ? 'Member leaving the rotation' : 'Member handing over their slot'}</T>
              <Chips value={memberId} onChange={setMemberId} options={movable.map((r) => ({ value: r.recipientMembershipId, label: `${r.recipientName} (round ${r.round})` }))} />
            </>
          )}
          {(kind === 'ADD_MEMBERS' || kind === 'REPLACE_MEMBER') && (
            <>
              <T variant="label" style={{ marginBottom: 6 }}>{kind === 'ADD_MEMBERS' ? `Joining at the end${k > 1 ? ` (in groups of ${k})` : ''}` : 'Replacement'}</T>
              {outside.length === 0 ? <Notice tone="neutral">Every active member is already in this rotation.</Notice> : (
                <Chips value={joining[joining.length - 1] ?? ''} onChange={(v) => setJoining(kind === 'REPLACE_MEMBER' ? [v] : joining.includes(v) ? joining.filter((x) => x !== v) : [...joining, v])} options={outside.map((m) => ({ value: m.membershipId, label: `${joining.includes(m.membershipId) ? '✓ ' : ''}${m.fullName}` }))} />
              )}
              <T variant="small" style={{ marginBottom: space.md }}>New members owe contributions only from the day the amendment is approved.</T>
            </>
          )}
          {kind === 'REMOVE_MEMBER' && <T variant="small" style={{ marginBottom: space.md }}>Later recipients move up a round and the last round is cancelled. What the member already owes stays owed.</T>}
          <Field label="Reason" value={reason} onChangeText={setReason} multiline placeholder="e.g. Agreed at the meeting on 3 March" />
          <Button title="Submit for approval" onPress={() => propose.mutate(undefined)} disabled={!valid} loading={propose.isPending} />
        </>
      )}
    </Screen>
  );
}
