import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LABELS, Permission, RotationCycle, RotationRoundRow, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Field, KV, Loading, NoAccess, Notice, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, dateTime, kes, newKey } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/**
 * The payout workflow on a phone: readiness → prepare (treasurer) →
 * independent approvals (one per approver) → record the send with its
 * reference → completion only when the recipient or another officer
 * confirms. Which buttons appear comes from the API's per-viewer flags.
 */
export default function Payouts() {
  const { groupId, group, can, canAny } = useGroupAccess();
  const P = Permission;
  const cycles = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`), enabled: canAny(P.ROTATIONS_MANAGE, P.PAYOUTS_APPROVE) });
  const active = cycles.data?.find((c) => c.status === 'ACTIVE');
  const draft = cycles.data?.find((c) => c.status === 'DRAFT');
  const inv = [['rotations', groupId], ['group-dashboard', groupId]];
  const decideActivation = useAct(({ id, decision, comment }: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) => api(`groups/${groupId}/rotations/${id}/activation`, { body: { decision, comment } }), { invalidate: inv, successMessage: 'Decision recorded.' });
  const decideChange = useAct(({ cycleId, changeId, decision }: { cycleId: string; changeId: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/rotations/${cycleId}/changes/${changeId}/decision`, { body: { decision } }), { invalidate: inv, successMessage: 'Decision recorded.' });
  const close = useAct((id: string) => api(`groups/${groupId}/rotations/${id}/close`, { method: 'POST' }), { invalidate: inv, successMessage: 'Cycle closed.' });
  const [comment, setComment] = useState('');
  if (group.data && !canAny(P.ROTATIONS_MANAGE, P.PAYOUTS_APPROVE)) return <Screen><Stack.Screen options={{ title: 'Payout approvals' }} /><NoAccess what="payout approvals" /></Screen>;
  const turn = active?.rounds.filter((r) => active.currentRound && r.round === active.currentRound.round) ?? [];
  const otherActionable = active?.rounds.filter((r) => !turn.includes(r) && (r.can.confirm || r.can.fail || r.can.reportProblem)) ?? [];
  const pendingChanges = active?.changeLog.filter((c) => c.status === 'PENDING') ?? [];
  return (
    <Screen refreshing={cycles.isRefetching} onRefresh={cycles.refetch}>
      <Stack.Screen options={{ title: 'Payout approvals' }} />
      {cycles.error ? <ErrorView error={cycles.error} onRetry={cycles.refetch} /> : !cycles.data ? <Loading /> : (
        <>
          {draft && (
            <Section title="Schedule awaiting approval">
              <View style={{ padding: space.lg }}>
                <T variant="label">{`${draft.name} · ${LABELS.rotationOrderMethod[draft.orderMethod]}`}</T>
                <T variant="small">{`${kes(draft.contributionCents)} ${LABELS.frequency[draft.frequency].toLowerCase()} · drafted by ${draft.createdByName}${draft.drawSeed ? ` · draw seed ${draft.drawSeed}` : ''}`}</T>
                {draft.rounds.map((r) => <T key={r.id} variant="small">{`${r.round}${draft.recipientsPerRound > 1 ? `.${r.slot}` : ''}. ${r.recipientName} — ${date(r.payoutDate)}`}</T>)}
                {draft.can.approveActivation ? (
                  <>
                    <Field label="Comment (required to reject)" value={comment} onChangeText={setComment} />
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <Button title="Approve schedule" onPress={() => askToConfirm('Approve this schedule?', 'Once approved it becomes binding and members start owing contributions under it.', 'Approve', () => decideActivation.mutate({ id: draft.id, decision: 'APPROVE', comment: comment || undefined }))} style={{ flex: 1 }} loading={decideActivation.isPending} />
                      <Button title="Reject" variant="secondary" onPress={() => decideActivation.mutate({ id: draft.id, decision: 'REJECT', comment })} style={{ flex: 1 }} disabled={comment.trim().length < 5} />
                    </View>
                  </>
                ) : <T variant="small" style={{ marginTop: space.sm }}>{draft.approvalMode === 'MEMBER_VOTE' ? 'Members are voting on it under Decisions & votes.' : 'An officer other than the drafter approves it.'}</T>}
              </View>
            </Section>
          )}
          {!active && !draft && (
            <Section>
              <Empty title="No active rotation" body={can(P.ROTATIONS_MANAGE) ? 'Draft a rotation; it starts once another officer approves it.' : undefined} icon="sync-outline" action={can(P.ROTATIONS_MANAGE) ? <Button title="Draft a rotation" onPress={() => router.push(`/(app)/group/${groupId}/manage/rotation-new` as never)} /> : undefined} />
            </Section>
          )}
          {active && (
            <>
              <T variant="small" style={{ marginBottom: space.md }}>{`${active.name} · ${active.remainingRounds} round${active.remainingRounds === 1 ? '' : 's'} left`}</T>
              {turn.length === 0 ? <Section><Empty title="All rounds are paid" icon="checkmark-done-outline" /></Section> : turn.map((r) => <PayoutCard key={r.id} groupId={groupId} cycle={active} r={r} />)}
              {otherActionable.map((r) => <PayoutCard key={r.id} groupId={groupId} cycle={active} r={r} />)}
              {pendingChanges.length > 0 && (
                <Section title="Amendments awaiting approval">
                  {pendingChanges.map((c, i) => (
                    <View key={c.id} style={{ padding: space.lg, borderBottomWidth: i === pendingChanges.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                      <T variant="label">{`${LABELS.rotationAmendment[c.kind]}: ${c.reason}`}</T>
                      <T variant="small">{`Proposed by ${c.byName}`}</T>
                      <T variant="small">{`Before: ${c.beforeNames.join(' → ')}`}</T>
                      <T variant="small">{`After: ${c.afterNames.join(' → ')}`}</T>
                      {can(P.PAYOUTS_APPROVE) && (
                        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                          <Button title="Approve" onPress={() => decideChange.mutate({ cycleId: active.id, changeId: c.id, decision: 'APPROVE' })} style={{ flex: 1 }} />
                          <Button title="Reject" variant="secondary" onPress={() => decideChange.mutate({ cycleId: active.id, changeId: c.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                        </View>
                      )}
                    </View>
                  ))}
                </Section>
              )}
              {can(P.ROTATIONS_MANAGE) && active.can.amend && <Button title="Propose a schedule amendment" variant="secondary" icon="swap-vertical-outline" onPress={() => router.push(`/(app)/group/${groupId}/manage/amend?cycleId=${active.id}` as never)} style={{ marginBottom: space.md }} />}
              <Button title="View the full rotation" variant="ghost" onPress={() => router.push(`/(app)/group/${groupId}/rotation` as never)} />
            </>
          )}
          {active?.can.close && (
            <>
              <Notice tone="green">Every round is paid. Close the cycle to stop its contribution schedule; then you can draft the next one.</Notice>
              <Button title="Close this cycle" onPress={() => askToConfirm('Close the cycle?', 'All rounds are paid. Closing ends its contribution schedule. This cannot be undone.', 'Close', () => close.mutate(active.id))} loading={close.isPending} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function PayoutCard({ groupId, cycle, r }: { groupId: string; cycle: RotationCycle; r: RotationRoundRow }) {
  const inv = [['rotations', groupId], ['group-dashboard', groupId]];
  const base = `groups/${groupId}/rotations/${cycle.id}/rounds/${r.id}`;
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'MPESA' | 'BANK_TRANSFER' | 'CASH'>('MPESA');
  const [reference, setReference] = useState('');
  const [destination, setDestination] = useState('');
  const [key] = useState(newKey);
  const prepare = useAct(() => api(`${base}/prepare`, { body: { shortfallReason: reason || undefined } }), { invalidate: inv, successMessage: 'Prepared and sent for approval.' });
  const decide = useAct((decision: 'APPROVE' | 'REJECT') => api(`${base}/approve`, { body: { decision, comment: note || undefined } }), { invalidate: inv, successMessage: 'Your decision is recorded.' });
  const send = useAct(() => api(`${base}/disburse`, { body: { method, reference: reference || undefined, destination: destination || undefined, sentAt: todayInNairobi(), evidenceNote: note || undefined, idempotencyKey: key } }), { invalidate: inv, successMessage: 'Recorded as sent. It completes when the recipient confirms or another officer verifies the reference.' });
  const verify = useAct(() => api(`${base}/confirm`, { body: { note: note || undefined } }), { invalidate: inv, successMessage: 'Payout completed and posted to the ledger.' });
  const fail = useAct(() => api(`${base}/fail`, { body: { reason } }), { invalidate: inv, successMessage: 'Marked as failed. It can be sent again.' });
  const amount = r.preparedAmountCents ?? r.readiness?.payableCents ?? 0;
  const approved = r.approvals.filter((a) => a.decision === 'APPROVED').length;
  return (
    <Section title={`Round ${r.round}${r.recipientsInRound > 1 ? `.${r.slot}` : ''} · ${r.recipientName}`} action={<StatusBadge status={r.status} />}>
      <KV label="Scheduled" value={date(r.payoutDate)} />
      <KV label="Expected collection" value={kes(r.expectedCents)} />
      <KV label="Confirmed collection" value={kes(r.confirmedCents)} />
      {r.pendingCents > 0 && <KV label="Awaiting verification (not counted)" value={kes(r.pendingCents)} />}
      {r.shortfallCents > 0 && <KV label="Outstanding" value={<T variant="body" style={{ color: colors.error, fontWeight: '700' }}>{kes(r.shortfallCents)}</T>} />}
      {r.preparedByName && <KV label="Prepared" value={`${kes(r.preparedAmountCents)} by ${r.preparedByName}`} />}
      {r.shortfallReason && <KV label="Shortfall reason" value={r.shortfallReason} />}
      <KV label="Approvals" value={`${approved} of ${r.approvalsRequired}`} last={!r.readiness && !r.disbursement && r.approvals.length === 0} />
      {r.approvals.map((a, i) => <KV key={a.id} label={`${a.decision === 'APPROVED' ? 'Approved' : 'Rejected'} by ${a.approverName}`} value={`${dateTime(a.createdAt)}${a.comment ? ` · ${a.comment}` : ''}`} last={i === r.approvals.length - 1 && !r.readiness && !r.disbursement} />)}
      {r.readiness && (
        <View style={{ padding: space.lg, gap: 6 }}>
          <T variant="label">{r.readiness.ready ? 'Readiness checks pass' : 'Not ready yet'}</T>
          {r.readiness.checks.map((c) => (
            <View key={c.key} style={{ flexDirection: 'row', gap: 8 }}>
              <Ionicons name={c.status === 'PASS' ? 'checkmark-circle' : c.status === 'WARN' ? 'warning' : 'close-circle'} size={18} color={c.status === 'PASS' ? colors.success : c.status === 'WARN' ? colors.warning : colors.error} accessibilityLabel={c.status} />
              <View style={{ flex: 1 }}>
                <T variant="label">{c.label}</T>
                <T variant="small">{c.detail}</T>
              </View>
            </View>
          ))}
        </View>
      )}
      {r.disbursement && (
        <View style={{ padding: space.lg }}>
          <T variant="label">{`Sent ${date(r.disbursement.sentAt)} by ${r.disbursement.byName}`}</T>
          <T variant="small">{`${LABELS.paymentMethod[r.disbursement.method]}${r.disbursement.reference ? ` · ${r.disbursement.reference}` : ''}${r.disbursement.destination ? ` · to ${r.disbursement.destination}` : ''}`}</T>
          {r.confirmation && <T variant="small" style={{ color: colors.success }}>{`${r.confirmation.kind === 'RECIPIENT' ? 'Receipt confirmed by the recipient' : `Verified by ${r.confirmation.byName}`} · ${dateTime(r.confirmation.at)}`}</T>}
          {r.failureReason && <T variant="small" style={{ color: colors.error }}>{`Last attempt failed: ${r.failureReason}`}</T>}
        </View>
      )}
      <View style={{ padding: space.lg, paddingTop: 0, gap: space.sm }}>
        {r.can.prepare && (
          <>
            {r.readiness?.needsShortfallReason && <Field label="Why the group agrees to pay a reduced amount" value={reason} onChangeText={setReason} />}
            <Button title={`Prepare ${kes(r.readiness?.payableCents ?? 0)} for approval`} onPress={() => askToConfirm('Prepare this payout?', `${kes(r.readiness?.payableCents ?? 0)} to ${r.recipientName}. Approvers will be asked to approve exactly this amount. You cannot approve it yourself.`, 'Prepare', () => prepare.mutate(undefined))} disabled={!!r.readiness?.needsShortfallReason && reason.trim().length < 5} loading={prepare.isPending} />
          </>
        )}
        {r.can.approve && (
          <>
            <Field label="Comment (required to reject)" value={note} onChangeText={setNote} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Approve" onPress={() => askToConfirm('Approve this payout?', `${kes(r.preparedAmountCents ?? 0)} to ${r.recipientName}, prepared by ${r.preparedByName}. Your approval is recorded in your name.`, 'Approve', () => decide.mutate('APPROVE'))} style={{ flex: 1 }} loading={decide.isPending} />
              <Button title="Reject" variant="secondary" onPress={() => decide.mutate('REJECT')} style={{ flex: 1 }} disabled={note.trim().length < 5} />
            </View>
          </>
        )}
        {r.can.disburse && (
          <>
            <Notice tone="neutral">{`Send ${kes(amount)} through the group's agreed channel first, then record it here. Recording does not complete the payout.`}</Notice>
            <Chips value={method} onChange={setMethod} options={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK_TRANSFER', label: 'Bank' }, { value: 'CASH', label: 'Cash' }]} />
            {method !== 'CASH' && <Field label="Transaction code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
            <Field label="Sent to" value={destination} onChangeText={setDestination} placeholder="e.g. M-Pesa 0712 *** 678" />
            <Field label={method === 'CASH' ? 'Who received it and who witnessed' : 'Note (optional)'} value={note} onChangeText={setNote} />
            <Button title="Record as sent" onPress={() => askToConfirm('Record as sent?', `${kes(amount)} to ${r.recipientName}${reference ? `, ref ${reference.toUpperCase()}` : ''}. The recipient will be asked to confirm.`, 'Record', () => send.mutate(undefined))} disabled={method === 'CASH' ? note.trim().length < 5 : reference.trim().length < 4} loading={send.isPending} />
          </>
        )}
        {r.can.confirm && (
          <>
            <Field label="Verification note" value={note} onChangeText={setNote} placeholder="e.g. Matched on the M-Pesa statement" />
            <Button title="Verify and complete" onPress={() => askToConfirm('Verify this payout?', 'Only confirm after checking the reference on the group statement. This posts the payout to the ledger.', 'Verify', () => verify.mutate(undefined))} loading={verify.isPending} />
          </>
        )}
        {r.can.fail && (
          <>
            <Field label="If it failed, why?" value={reason} onChangeText={setReason} />
            <Button title="Mark as failed" variant="secondary" onPress={() => fail.mutate(undefined)} disabled={reason.trim().length < 5} />
          </>
        )}
      </View>
    </Section>
  );
}
