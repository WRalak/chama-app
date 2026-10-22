import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { addDays, FREQUENCIES, Frequency, LABELS, MemberRow, parseKes, Permission, planRotation, RotationOrderMethod, todayInNairobi } from '@chamahub/shared';
import { OrderList } from '@/components/order-list';
import { Button, Chips, Field, KV, Loading, NoAccess, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/** Drafts a merry-go-round schedule. Nothing is owed until another officer approves it or the members' vote passes. */
export default function RotationNew() {
  const { groupId, group, can } = useGroupAccess();
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }) });
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('MONTHLY');
  const [startDate, setStartDate] = useState(todayInNairobi());
  const [method, setMethod] = useState<RotationOrderMethod>('AGREED');
  const [order, setOrder] = useState<string[]>([]);
  const [perRound, setPerRound] = useState('1');
  const [recipientContributes, setRecipientContributes] = useState(true);
  const [approval, setApproval] = useState<'OFFICERS' | 'MEMBER_VOTE'>('OFFICERS');
  const [voteDays, setVoteDays] = useState('3');
  const [review, setReview] = useState(false);
  useEffect(() => {
    if (members.data && order.length === 0) setOrder(members.data.map((m) => m.membershipId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.data]);
  const names = new Map((members.data ?? []).map((m) => [m.membershipId, m.fullName]));
  let cents = 0;
  try {
    cents = amount ? parseKes(amount) : 0;
  } catch {
    cents = 0;
  }
  const k = Number(perRound);
  const preview = useMemo(() => {
    try {
      return { rounds: planRotation({ startDate, frequency, contributionCents: cents || 1, order, recipientsPerRound: k, recipientContributes }), error: null as string | null };
    } catch (e) {
      return { rounds: [], error: (e as Error).message };
    }
  }, [startDate, frequency, cents, order, k, recipientContributes]);
  const create = useAct(
    () =>
      api(`groups/${groupId}/rotations`, {
        body: {
          name: name.trim(),
          contributionCents: cents,
          frequency,
          startDate,
          orderMethod: method,
          memberIds: order,
          recipientsPerRound: k,
          recipientContributes,
          approvalMode: approval,
          vote: approval === 'MEMBER_VOTE' ? { closesAt: new Date(Date.now() + Number(voteDays) * 86_400_000).toISOString(), quorumPercent: 50, passPercent: 50 } : undefined,
        },
      }),
    { invalidate: [['rotations', groupId], ['group-dashboard', groupId]], successMessage: approval === 'MEMBER_VOTE' ? 'Draft created and the members’ vote is open.' : 'Draft created. Another officer must approve it before it starts.', onSuccess: () => router.replace(`/(app)/group/${groupId}/manage/payouts` as never) },
  );
  const valid = name.trim().length >= 2 && cents > 0 && !preview.error && /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  if (group.data && !can(Permission.ROTATIONS_MANAGE)) return <Screen><Stack.Screen options={{ title: 'New rotation' }} /><NoAccess what="managing rotations" /></Screen>;

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: review ? 'Check the schedule' : 'New rotation' }} />
      {!members.data ? <Loading /> : review ? (
        <>
          <Notice tone="amber" icon="hourglass-outline">{approval === 'MEMBER_VOTE' ? `Members vote on this schedule for ${voteDays} day(s). It starts only if the vote passes.` : 'This is a draft. It starts only when another officer approves it.'}</Notice>
          <Section title={name}>
            <KV label="Contribution" value={`${kes(cents)} ${LABELS.frequency[frequency].toLowerCase()}`} />
            <KV label="Order" value={LABELS.rotationOrderMethod[method]} />
            <KV label="Pot per round" value={kes((preview.rounds[0]?.expectedCollectionCents ?? 0) * (cents ? 1 : 0))} />
            <KV label="Rounds" value={`${preview.rounds.length} · ${date(preview.rounds[0]?.payoutDate)} to ${date(preview.rounds.at(-1)?.payoutDate)}`} last />
          </Section>
          {method === 'AGREED' ? (
            <Section title="Payout calendar">
              {preview.rounds.map((r, i) => <KV key={r.round} label={`Round ${r.round} · ${date(r.payoutDate)}`} value={r.recipients.map((m) => names.get(m)).join(', ')} last={i === preview.rounds.length - 1} />)}
            </Section>
          ) : <Notice tone="neutral">{method === 'RANDOM_DRAW' ? 'The server draws the order when you submit and publishes the seed so any member can check it.' : 'The order follows the last completed rotation; new participants go to the end.'}</Notice>}
          <Button title="Submit draft" onPress={() => create.mutate(undefined)} loading={create.isPending} />
          <Button title="Go back and edit" variant="ghost" onPress={() => setReview(false)} style={{ marginTop: space.sm }} />
        </>
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. 2027 Cycle" />
          <Field label="Contribution per member per round" prefix="KSh" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Chips value={frequency} onChange={setFrequency} options={FREQUENCIES.map((f) => ({ value: f, label: LABELS.frequency[f] }))} />
          <Field label="First payout date" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" hint={`Later rounds follow ${LABELS.frequency[frequency].toLowerCase()} from this date (month-end dates are kept).`} />
          <T variant="label" style={{ marginBottom: 6 }}>Participants</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
            {members.data.map((m) => {
              const on = order.includes(m.membershipId);
              return (
                <Pressable key={m.membershipId} onPress={() => setOrder(on ? order.filter((x) => x !== m.membershipId) : [...order, m.membershipId])} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ minHeight: 40, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: on ? colors.berry : colors.border, backgroundColor: on ? colors.blush : colors.white }}>
                  <T variant="label" style={{ color: on ? colors.berry : colors.muted }}>{m.fullName}</T>
                </Pressable>
              );
            })}
          </View>
          <T variant="label" style={{ marginBottom: 6 }}>How is the order decided?</T>
          <Chips value={method} onChange={setMethod} options={[{ value: 'AGREED', label: 'Agreed order' }, { value: 'RANDOM_DRAW', label: 'Random draw' }, { value: 'CARRY_OVER', label: 'Same as last cycle' }]} />
          {method === 'AGREED' && <OrderList order={order} names={names} onChange={setOrder} perRound={k} />}
          <T variant="label" style={{ marginBottom: 6 }}>Recipients per round</T>
          <Chips value={perRound} onChange={setPerRound} options={['1', '2', '3'].map((v) => ({ value: v, label: v }))} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg }}>
            <T variant="body" style={{ flex: 1 }}>Recipients also contribute in their own round</T>
            <Switch value={recipientContributes} onValueChange={setRecipientContributes} trackColor={{ true: colors.rose }} />
          </View>
          <T variant="label" style={{ marginBottom: 6 }}>Who approves the schedule?</T>
          <Chips value={approval} onChange={setApproval} options={[{ value: 'OFFICERS', label: 'Another officer' }, { value: 'MEMBER_VOTE', label: 'Members vote' }]} />
          {approval === 'MEMBER_VOTE' && <Chips value={voteDays} onChange={setVoteDays} options={['1', '3', '7'].map((d) => ({ value: d, label: `Vote closes in ${d} day${d === '1' ? '' : 's'}` }))} />}
          {preview.error ? <Notice tone="red" icon="alert-circle-outline">{preview.error}</Notice> : <Notice tone="neutral">{`${preview.rounds.length} rounds · pot ${kes((preview.rounds[0]?.expectedCollectionCents ?? 0) * (cents ? 1 : 0))} per round · last payout ${date(preview.rounds.at(-1)?.payoutDate ?? addDays(startDate, 0))}`}</Notice>}
          <Button title="Review" onPress={() => setReview(true)} disabled={!valid} />
        </>
      )}
    </Screen>
  );
}
