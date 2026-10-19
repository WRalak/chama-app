import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { DistributionRecord, ExpenseRow, LABELS, LoanSummary, MemberRow, Paginated, parseKes, PaymentItem, Permission, RotationCycle, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Empty, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes, newKey } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { colors, space } from '@/theme';

/** The officer essentials on a phone. Full administration lives in the web dashboard. */
export default function Manage() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const perms = group.data?.myMembership.permissions ?? [];
  const can = (p: Permission) => perms.includes(p);
  const [tab, setTab] = useState<'verify' | 'loans' | 'record' | 'expenses' | 'payouts' | 'distributions'>('verify');
  const inv = [['manage', groupId], ['dashboard'], ['groups']];
  const pending = useQuery({ queryKey: ['manage', groupId, 'payments'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 50 } }), enabled: can(Permission.CONTRIBUTIONS_VERIFY) });
  const loans = useQuery({ queryKey: ['manage', groupId, 'loans'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.LOANS_APPROVE) });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }), enabled: can(Permission.CONTRIBUTIONS_RECORD) });
  const expenses = useQuery({ queryKey: ['manage', groupId, 'expenses'], queryFn: () => api<ExpenseRow[]>(`groups/${groupId}/expenses`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.EXPENSES_APPROVE) });
  const cycles = useQuery({ queryKey: ['manage', groupId, 'rotations'], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`), enabled: can(Permission.PAYOUTS_APPROVE) });
  const dists = useQuery({ queryKey: ['manage', groupId, 'distributions'], queryFn: () => api<DistributionRecord[]>(`groups/${groupId}/distributions`), enabled: can(Permission.DISTRIBUTIONS_APPROVE) && can(Permission.REPORTS_VIEW) });
  const decideExpense = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/expenses/${id}/decision`, { body: { decision } }), { invalidate: inv });
  const approvePayout = useAct(({ cycleId, roundId, shortfallReason }: { cycleId: string; roundId: string; shortfallReason?: string }) => api(`groups/${groupId}/rotations/${cycleId}/rounds/${roundId}/approve`, { body: { shortfallReason } }), { invalidate: inv, successMessage: 'Approval recorded.' });
  const decideChange = useAct(({ cycleId, changeId, decision }: { cycleId: string; changeId: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycleId}/changes/${changeId}/decision`, { body: { decision } }), { invalidate: inv });
  const decideDist = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/distributions/${id}/decision`, { body: { decision } }), { invalidate: inv });
  const activeCycle = cycles.data?.find((c) => c.status === 'ACTIVE');
  const [shortfall, setShortfall] = useState('');
  const round = activeCycle?.currentRound;
  const roundNeedsMe = round && !['APPROVED', 'COMPLETED'].includes(round.status) && round.confirmedCents > 0 && round.recipientMembershipId !== group.data?.myMembership.membershipId;
  const pendingChanges = activeCycle?.changeLog.filter((c) => c.status === 'PENDING') ?? [];
  const pendingDists = (dists.data ?? []).filter((d) => d.status === 'PENDING_APPROVAL');
  const verify = useAct(({ id, decision }: { id: string; decision: 'CONFIRM' | 'FAIL' }) => api(`groups/${groupId}/payments/${id}/verify`, { body: { decision } }), { invalidate: inv });
  const decide = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/loans/${id}/decision`, { body: { decision } }), { invalidate: inv });

  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'MPESA'>('CASH');
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(newKey);
  let cents: number | null = null;
  try {
    cents = amount ? parseKes(amount) : null;
  } catch {
    cents = null;
  }
  const record = useAct(() => api(`groups/${groupId}/payments`, { body: { memberId, amountCents: cents, method, reference: reference || undefined, paidAt: todayInNairobi(), purpose: 'CONTRIBUTION', idempotencyKey: key } }), {
    invalidate: inv,
    successMessage: 'Recorded as pending. Another officer must verify it.',
    onSuccess: () => { setAmount(''); setReference(''); setKey(newKey()); },
  });

  const tabs = [
    ...(can(Permission.CONTRIBUTIONS_VERIFY) ? [{ value: 'verify' as const, label: `Verify (${pending.data?.total ?? 0})` }] : []),
    ...(can(Permission.LOANS_APPROVE) ? [{ value: 'loans' as const, label: `Loans (${loans.data?.length ?? 0})` }] : []),
    ...(can(Permission.EXPENSES_APPROVE) ? [{ value: 'expenses' as const, label: `Expenses (${expenses.data?.filter((e) => e.canApprove).length ?? 0})` }] : []),
    ...(can(Permission.PAYOUTS_APPROVE) ? [{ value: 'payouts' as const, label: `Payouts (${(roundNeedsMe ? 1 : 0) + pendingChanges.length})` }] : []),
    ...(can(Permission.DISTRIBUTIONS_APPROVE) && can(Permission.REPORTS_VIEW) ? [{ value: 'distributions' as const, label: `Distributions (${pendingDists.length})` }] : []),
    ...(can(Permission.CONTRIBUTIONS_RECORD) ? [{ value: 'record' as const, label: 'Record cash' }] : []),
  ];
  const confirm = (p: PaymentItem) =>
    Alert.alert('Confirm payment?', `${kes(p.amountCents)} from ${p.memberName}${p.reference ? `, ref ${p.reference}` : ''}.\n\nOnly confirm once you have checked the money is in the group account or cash box.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Not received', style: 'destructive', onPress: () => verify.mutate({ id: p.id, decision: 'FAIL' }) },
      { text: 'Confirm', onPress: () => verify.mutate({ id: p.id, decision: 'CONFIRM' }) },
    ]);

  return (
    <Screen refreshing={pending.isRefetching} onRefresh={() => { pending.refetch(); loans.refetch(); }}>
      <Stack.Screen options={{ title: 'Approvals & recording' }} />
      {!group.data ? <Loading /> : tabs.length === 0 ? <Empty title="No officer actions for your role" /> : (
        <>
          <Chips value={tabs.some((t) => t.value === tab) ? tab : tabs[0].value} onChange={setTab} options={tabs} />
          {tab === 'verify' && (
            <Section title="Payments awaiting verification">
              {!pending.data ? <Loading /> : pending.data.items.length === 0 ? <Empty title="All caught up" icon="checkmark-done-outline" /> : pending.data.items.map((p, i) => (
                <Row key={p.id} title={`${p.memberName} · ${kes(p.amountCents)}`} subtitle={`${date(p.paidAt)} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''} · by ${p.recordedByName ?? 'M-Pesa'}`} onPress={() => confirm(p)} last={i === pending.data!.items.length - 1} />
              ))}
            </Section>
          )}
          {tab === 'loans' && (
            <Section title="Loan applications">
              {!loans.data ? <Loading /> : loans.data.length === 0 ? <Empty title="No applications waiting" /> : loans.data.map((l, i) => (
                <View key={l.id} style={{ padding: space.lg, borderBottomWidth: i === loans.data!.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <T variant="label">{`${l.memberName} · ${kes(l.principalCents)}`}</T>
                  <T variant="small">{`${l.purpose} · ${l.installments} installments · interest ${kes(l.interestCents)} · ${l.approvalsReceived}/${l.approvalsRequired} approvals`}</T>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Approve" onPress={() => decide.mutate({ id: l.id, decision: 'APPROVE' })} style={{ flex: 1 }} loading={decide.isPending} />
                    <Button title="Reject" variant="secondary" onPress={() => decide.mutate({ id: l.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
          {tab === 'expenses' && (
            <Section title="Expenses awaiting approval">
              {!expenses.data ? <Loading /> : expenses.data.filter((e) => e.canApprove).length === 0 ? <Empty title="Nothing to approve" /> : expenses.data.filter((e) => e.canApprove).map((e, i, arr) => (
                <View key={e.id} style={{ padding: space.lg, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <T variant="label">{`${kes(e.amountCents)} · ${e.category}`}</T>
                  <T variant="small">{`${e.description}${e.payee ? ` · ${e.payee}` : ''} · recorded by ${e.recordedByName} · ${e.approvals.filter((a) => a.decision === 'APPROVED').length}/${e.approvalsRequired} approvals`}</T>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Approve" onPress={() => decideExpense.mutate({ id: e.id, decision: 'APPROVE' })} style={{ flex: 1 }} />
                    <Button title="Reject" variant="secondary" onPress={() => decideExpense.mutate({ id: e.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
          {tab === 'payouts' && (
            <>
              <Section title="Current round">
                {!cycles.data ? <Loading /> : !round ? <Empty title="No active rotation" /> : (
                  <View style={{ padding: space.lg }}>
                    <T variant="label">{`Round ${round.round} · ${round.recipientName} · ${date(round.payoutDate)}`}</T>
                    <T variant="small">{`Confirmed ${kes(round.confirmedCents)} of ${kes(round.expectedCents)} · ${round.approvals.length}/${round.approvalsRequired} approvals · ${round.status.toLowerCase()}`}</T>
                    {roundNeedsMe ? (
                      <View style={{ marginTop: space.sm }}>
                        {round.shortfallCents > 0 && <Field label={`Reason for approving ${kes(round.shortfallCents)} less than expected`} value={shortfall} onChangeText={setShortfall} />}
                        <Button title={`Approve payout of ${kes(round.confirmedCents)}`} disabled={round.shortfallCents > 0 && shortfall.trim().length < 5} loading={approvePayout.isPending} onPress={() => approvePayout.mutate({ cycleId: activeCycle!.id, roundId: round.id, shortfallReason: shortfall || undefined })} />
                      </View>
                    ) : (
                      <T variant="small" style={{ marginTop: space.sm }}>{round.recipientMembershipId === group.data.myMembership.membershipId ? 'This is your own payout — another officer approves it.' : round.confirmedCents <= 0 ? 'Nothing confirmed for this round yet.' : 'No approval needed from you now.'}</T>
                    )}
                  </View>
                )}
              </Section>
              {pendingChanges.length > 0 && (
                <Section title="Proposed order changes">
                  {pendingChanges.map((c, i) => (
                    <View key={c.id} style={{ padding: space.lg, borderBottomWidth: i === pendingChanges.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                      <T variant="label">{c.reason}</T>
                      <T variant="small">{`Proposed by ${c.byName}`}</T>
                      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                        <Button title="Approve" onPress={() => decideChange.mutate({ cycleId: activeCycle!.id, changeId: c.id, decision: 'APPROVE' })} style={{ flex: 1 }} />
                        <Button title="Reject" variant="secondary" onPress={() => decideChange.mutate({ cycleId: activeCycle!.id, changeId: c.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                      </View>
                    </View>
                  ))}
                </Section>
              )}
            </>
          )}
          {tab === 'distributions' && (
            <Section title="Distributions awaiting approval">
              {!dists.data ? <Loading /> : pendingDists.length === 0 ? <Empty title="Nothing to approve" /> : pendingDists.map((d, i) => (
                <View key={d.id} style={{ padding: space.lg, borderBottomWidth: i === pendingDists.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <T variant="label">{`${d.title} · ${kes(d.calculation.distributedCents)}`}</T>
                  <T variant="small">{`${LABELS.distributionMethod[d.method]} · cash ${kes(d.calculation.availableCashCents)}, retained ${kes(d.calculation.retainedCents)} · prepared by ${d.createdByName}`}</T>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Approve" onPress={() => decideDist.mutate({ id: d.id, decision: 'APPROVE' })} style={{ flex: 1 }} />
                    <Button title="Reject" variant="secondary" onPress={() => decideDist.mutate({ id: d.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
          {tab === 'record' && (
            <>
              <Notice tone="neutral">Records a contribution as pending. A second officer must verify it before it counts.</Notice>
              <T variant="label" style={{ marginBottom: 6 }}>Member</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
                {members.data?.map((m) => (
                  <Pressable key={m.membershipId} onPress={() => setMemberId(m.membershipId)} accessibilityRole="button" accessibilityState={{ selected: memberId === m.membershipId }} style={{ paddingHorizontal: space.md, minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: memberId === m.membershipId ? colors.forest : colors.border, backgroundColor: memberId === m.membershipId ? colors.forestTint : colors.white }}>
                    <T variant="label">{m.fullName}</T>
                  </Pressable>
                ))}
              </View>
              <Field label="Amount" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === null ? 'Enter a valid amount' : undefined} />
              <Chips value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'MPESA', label: 'M-Pesa' }]} />
              {method === 'MPESA' && <Field label="M-Pesa code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
              <Button title="Record payment" onPress={() => record.mutate(undefined)} loading={record.isPending} disabled={!memberId || !cents || cents <= 0 || (method === 'MPESA' && !reference)} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
