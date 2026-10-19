import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { DistributionRecord, ExpenseRow, LABELS, LoanSummary, MemberRow, Paginated, parseKes, PaymentItem, Permission, RotationCycle, RotationRoundRow, todayInNairobi } from '@chamahub/shared';
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
  const inv = [['manage', groupId], ['rotations', groupId], ['dashboard'], ['groups']];
  const pending = useQuery({ queryKey: ['manage', groupId, 'payments'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 50 } }), enabled: can(Permission.CONTRIBUTIONS_VERIFY) });
  const loans = useQuery({ queryKey: ['manage', groupId, 'loans'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.LOANS_APPROVE) });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }), enabled: can(Permission.CONTRIBUTIONS_RECORD) });
  const expenses = useQuery({ queryKey: ['manage', groupId, 'expenses'], queryFn: () => api<ExpenseRow[]>(`groups/${groupId}/expenses`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.EXPENSES_APPROVE) });
  const payoutOfficer = can(Permission.PAYOUTS_APPROVE) || can(Permission.ROTATIONS_MANAGE);
  const cycles = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`), enabled: payoutOfficer });
  const dists = useQuery({ queryKey: ['manage', groupId, 'distributions'], queryFn: () => api<DistributionRecord[]>(`groups/${groupId}/distributions`), enabled: can(Permission.DISTRIBUTIONS_APPROVE) && can(Permission.REPORTS_VIEW) });
  const decideExpense = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/expenses/${id}/decision`, { body: { decision } }), { invalidate: inv });
  const decideChange = useAct(({ cycleId, changeId, decision }: { cycleId: string; changeId: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycleId}/changes/${changeId}/decision`, { body: { decision } }), { invalidate: inv });
  const decideActivation = useAct(({ cycleId, decision }: { cycleId: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycleId}/activation`, { body: { decision } }), { invalidate: [...inv, ['rotations', groupId]], successMessage: 'Decision recorded.' });
  const decideDist = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/distributions/${id}/decision`, { body: { decision } }), { invalidate: inv });
  const activeCycle = cycles.data?.find((c) => c.status === 'ACTIVE');
  const draftCycle = cycles.data?.find((c) => c.status === 'DRAFT');
  const actionable = (activeCycle?.rounds ?? []).filter((r) => r.can.prepare || r.can.approve || r.can.disburse || r.can.confirm || r.can.fail);
  const pendingChanges = activeCycle?.changeLog.filter((c) => c.status === 'PENDING') ?? [];
  const payoutCount = actionable.length + pendingChanges.length + (draftCycle?.can.approveActivation ? 1 : 0);
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
    ...(payoutOfficer ? [{ value: 'payouts' as const, label: `Payouts (${payoutCount})` }] : []),
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
              {draftCycle && (
                <Section title="Rotation awaiting approval">
                  <View style={{ padding: space.lg }}>
                    <T variant="label">{`${draftCycle.name} · ${draftCycle.rounds.length} payouts from ${date(draftCycle.startDate)}`}</T>
                    <T variant="small">{`${LABELS.rotationOrderMethod[draftCycle.orderMethod]} · drafted by ${draftCycle.createdByName}`}</T>
                    {draftCycle.rounds.map((r) => <T key={r.id} variant="small">{`${r.round}. ${r.recipientName} — ${date(r.payoutDate)}`}</T>)}
                    {draftCycle.can.approveActivation ? (
                      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                        <Button title="Approve schedule" onPress={() => decideActivation.mutate({ cycleId: draftCycle.id, decision: 'APPROVE' })} style={{ flex: 1 }} loading={decideActivation.isPending} />
                        <Button title="Reject" variant="secondary" onPress={() => decideActivation.mutate({ cycleId: draftCycle.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                      </View>
                    ) : <T variant="small" style={{ marginTop: space.sm }}>{draftCycle.approvalMode === 'MEMBER_VOTE' ? 'Members are voting on this schedule.' : 'Another officer approves this schedule.'}</T>}
                  </View>
                </Section>
              )}
              <Section title="Payouts needing action">
                {!cycles.data ? <Loading /> : !activeCycle ? <Empty title="No active rotation" /> : actionable.length === 0 ? (
                  <Empty title="Nothing for you right now" body={activeCycle.currentRound ? `Round ${activeCycle.currentRound.round} (${activeCycle.currentRound.recipientName}) is ${LABELS.payoutStatus[activeCycle.currentRound.status].toLowerCase()}.` : 'All rounds are paid.'} icon="checkmark-done-outline" />
                ) : actionable.map((r, i) => <PayoutCard key={r.id} groupId={groupId} cycleId={activeCycle.id} r={r} last={i === actionable.length - 1} />)}
              </Section>
              {pendingChanges.length > 0 && can(Permission.PAYOUTS_APPROVE) && (
                <Section title="Proposed amendments">
                  {pendingChanges.map((c, i) => (
                    <View key={c.id} style={{ padding: space.lg, borderBottomWidth: i === pendingChanges.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                      <T variant="label">{`${LABELS.rotationAmendment[c.kind]}: ${c.reason}`}</T>
                      <T variant="small">{`Proposed by ${c.byName} · new order: ${c.afterNames.join(' → ')}`}</T>
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

/** One payout step at a time; the API decides which steps this officer may take. */
function PayoutCard({ groupId, cycleId, r, last }: { groupId: string; cycleId: string; r: RotationRoundRow; last: boolean }) {
  const inv = [['rotations', groupId], ['dashboard']];
  const base = `groups/${groupId}/rotations/${cycleId}/rounds/${r.id}`;
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH'>('MPESA');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(newKey);
  const prepare = useAct(() => api(`${base}/prepare`, { body: { shortfallReason: reason || undefined } }), { invalidate: inv, successMessage: 'Prepared. Approvers have been notified.' });
  const decide = useAct((decision: 'APPROVE' | 'REJECT') => api(`${base}/approve`, { body: { decision, comment: note || undefined } }), { invalidate: inv, successMessage: 'Decision recorded.' });
  const send = useAct(() => api(`${base}/disburse`, { body: { method, reference: reference || undefined, sentAt: todayInNairobi(), evidenceNote: note || undefined, idempotencyKey: key } }), { invalidate: inv, successMessage: 'Recorded as sent. It completes when the recipient confirms or another officer verifies it.' });
  const verify = useAct(() => api(`${base}/confirm`, { body: { note: note || undefined } }), { invalidate: inv, successMessage: 'Payout completed.' });
  const fail = useAct(() => api(`${base}/fail`, { body: { reason } }), { invalidate: inv, successMessage: 'Marked as failed. Send it again when ready.' });
  const amount = r.preparedAmountCents ?? r.readiness?.payableCents ?? 0;
  return (
    <View style={{ padding: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      <T variant="label">{`Round ${r.round} · ${r.recipientName} · ${kes(amount)}`}</T>
      <T variant="small">{`${date(r.payoutDate)} · ${LABELS.payoutStatus[r.status]} · confirmed ${kes(r.confirmedCents)} of ${kes(r.expectedCents)}`}</T>
      {r.readiness && !r.readiness.ready && r.readiness.checks.filter((c) => c.status === 'FAIL').map((c) => <T key={c.key} variant="small" style={{ color: colors.error }}>{`• ${c.detail}`}</T>)}
      {r.readiness?.checks.filter((c) => c.status === 'WARN').map((c) => <T key={c.key} variant="small" style={{ color: colors.warning }}>{`• ${c.detail}`}</T>)}
      {r.can.prepare && (
        <View style={{ marginTop: space.sm }}>
          {r.readiness?.needsShortfallReason && <Field label="Why the group agrees to pay less" value={reason} onChangeText={setReason} />}
          <Button title={`Prepare payout of ${kes(r.readiness?.payableCents ?? 0)}`} onPress={() => prepare.mutate(undefined)} loading={prepare.isPending} disabled={!!r.readiness?.needsShortfallReason && reason.trim().length < 5} />
        </View>
      )}
      {r.can.approve && (
        <View style={{ marginTop: space.sm }}>
          <T variant="small">{`Prepared by ${r.preparedByName}${r.shortfallReason ? ` · short: ${r.shortfallReason}` : ''}`}</T>
          <Field label="Comment (needed to reject)" value={note} onChangeText={setNote} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve" onPress={() => decide.mutate('APPROVE')} style={{ flex: 1 }} loading={decide.isPending} />
            <Button title="Reject" variant="secondary" onPress={() => decide.mutate('REJECT')} style={{ flex: 1 }} disabled={note.trim().length < 5} />
          </View>
        </View>
      )}
      {r.can.disburse && (
        <View style={{ marginTop: space.sm }}>
          {r.failureReason && <T variant="small" style={{ color: colors.error }}>{`Last attempt failed: ${r.failureReason}`}</T>}
          <Chips value={method} onChange={setMethod} options={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK_TRANSFER', label: 'Bank' }, { value: 'CASH', label: 'Cash' }]} />
          {method !== 'CASH' && <Field label="Transaction code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
          <Field label={method === 'CASH' ? 'Who received it and who witnessed' : 'Note (optional)'} value={note} onChangeText={setNote} />
          <Button title={`Record ${kes(amount)} as sent`} onPress={() => send.mutate(undefined)} loading={send.isPending} disabled={method === 'CASH' ? note.trim().length < 5 : reference.trim().length < 4} />
        </View>
      )}
      {(r.can.confirm || r.can.fail) && (
        <View style={{ marginTop: space.sm }}>
          {r.disbursement && <T variant="small">{`Sent ${date(r.disbursement.sentAt)} by ${r.disbursement.byName}${r.disbursement.reference ? ` · ref ${r.disbursement.reference}` : ''}`}</T>}
          {r.can.confirm && (
            <>
              <Field label="Verification note" value={note} onChangeText={setNote} placeholder="e.g. Matched on the M-Pesa statement" />
              <Button title="Verify and complete" onPress={() => verify.mutate(undefined)} loading={verify.isPending} />
            </>
          )}
          {r.can.fail && (
            <>
              <Field label="If it failed, why?" value={reason} onChangeText={setReason} />
              <Button title="Mark as failed" variant="secondary" onPress={() => fail.mutate(undefined)} disabled={reason.trim().length < 5} />
            </>
          )}
        </View>
      )}
    </View>
  );
}
