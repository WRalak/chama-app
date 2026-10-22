import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LABELS, PayoutStatus, RotationCycle, RotationRoundRow } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Field, Loading, Notice, Row, Screen, Section, Stat, StatGrid, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, kes, relativeDay } from '@/lib/format';
import { shareSummary } from '@/lib/share';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/** Plain-language stage so members can tell a planned payout from a paid one. */
const STAGE: Record<PayoutStatus, string> = {
  SCHEDULED: 'Scheduled',
  READINESS_CHECK: 'Collecting and checking readiness',
  AWAITING_APPROVAL: 'Prepared, awaiting officer approval',
  APPROVED: 'Approved, waiting to be sent',
  PROCESSING: 'Sent, waiting for confirmation',
  COMPLETED: 'Paid out',
  FAILED: 'Sending failed, will be retried',
  CANCELLED: 'Cancelled by an amendment',
};

function MyPayout({ cycle, r }: { cycle: RotationCycle; r: RotationRoundRow }) {
  const inv = [['rotations', cycle.groupId], ['dashboard']];
  const base = `groups/${cycle.groupId}/rotations/${cycle.id}/rounds/${r.id}`;
  const [problem, setProblem] = useState('');
  const [reporting, setReporting] = useState(false);
  const confirm = useAct(() => api(`${base}/confirm`, { body: { note: 'Confirmed on the ChamaHub app' } }), { invalidate: inv, successMessage: 'Thank you. The payout is now complete and the group has been told.' });
  const report = useAct(() => api(`${base}/problem`, { body: { details: problem } }), { invalidate: inv, successMessage: 'Your officers have been told and will look into it.', onSuccess: () => { setReporting(false); setProblem(''); } });
  const share = r.recipientsInRound > 1 ? r.expectedShareCents : r.expectedCents;
  if (r.status === 'CANCELLED') return null;
  return (
    <Notice tone={r.status === 'COMPLETED' ? 'green' : r.status === 'PROCESSING' ? 'amber' : 'blue'} icon="gift-outline">
      <T variant="small" style={{ color: colors.text }}>
        {r.status === 'COMPLETED'
          ? `You received ${kes(r.payoutAmountCents ?? 0)} in round ${r.round}${r.payoutReference ? ` (ref ${r.payoutReference})` : ''}.`
          : r.status === 'PROCESSING' && r.disbursement
            ? `${kes(r.preparedAmountCents ?? 0)} was sent to you via ${LABELS.paymentMethod[r.disbursement.method]}${r.disbursement.reference ? ` (ref ${r.disbursement.reference})` : ''} on ${date(r.disbursement.sentAt)}. Please confirm once it reaches you.`
            : `Your payout is round ${r.round}, scheduled for ${date(r.payoutDate)} (${relativeDay(r.payoutDate).toLowerCase()}). Expected ${kes(share)}. You are paid what is actually collected and confirmed, once officers approve.`}
      </T>
      {r.readiness && !r.readiness.ready && r.status !== 'PROCESSING' && (
        <View style={{ marginTop: space.sm }}>
          <T variant="small" style={{ fontWeight: '600', color: colors.text }}>Waiting on:</T>
          {r.readiness.checks.filter((c) => c.status === 'FAIL').map((c) => <T key={c.key} variant="small" style={{ color: colors.text }}>{`• ${c.detail}`}</T>)}
        </View>
      )}
      {r.can.confirm && <Button title="I received it" onPress={() => askToConfirm('Confirm receipt?', 'Only confirm once the money is in your M-Pesa or account.', 'Yes, received', () => confirm.mutate(undefined))} loading={confirm.isPending} style={{ marginTop: space.sm }} />}
      {r.can.reportProblem && !reporting && <Button title="Report a problem" variant="secondary" onPress={() => setReporting(true)} style={{ marginTop: space.sm }} />}
      {reporting && (
        <View style={{ marginTop: space.sm }}>
          <Field label="What is wrong?" value={problem} onChangeText={setProblem} placeholder="e.g. Nothing has arrived on my line" multiline />
          <Button title="Send to officers" onPress={() => report.mutate(undefined)} loading={report.isPending} disabled={problem.trim().length < 5} />
        </View>
      )}
    </Notice>
  );
}

export default function Rotation() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const cycles = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`) });
  const [sel, setSel] = useState<string>('');
  const c = cycles.data?.find((x) => x.id === sel) ?? cycles.data?.find((x) => x.status === 'ACTIVE' || x.status === 'DRAFT') ?? cycles.data?.[0];
  const multi = (c?.recipientsPerRound ?? 1) > 1;
  return (
    <Screen refreshing={cycles.isRefetching} onRefresh={cycles.refetch}>
      <Stack.Screen options={{ title: 'Payout rotation' }} />
      {cycles.error ? <ErrorView error={cycles.error} onRetry={cycles.refetch} /> : !cycles.data ? <Loading /> : !c ? <Empty title="No rotation yet" body="Your officers have not set up a payout cycle." icon="sync-outline" /> : (
        <>
          {cycles.data.length > 1 && <Chips value={c.id} onChange={setSel} options={cycles.data.map((x) => ({ value: x.id, label: x.name }))} />}
          <T variant="small" style={{ marginBottom: space.md }}>{`${c.name} · ${kes(c.contributionCents)} ${LABELS.frequency[c.frequency].toLowerCase()} · ${c.remainingRounds} round${c.remainingRounds === 1 ? '' : 's'} left · ${LABELS.rotationOrderMethod[c.orderMethod]}`}</T>
          {c.status === 'DRAFT' && (
            <Notice tone="amber" icon="hourglass-outline">
              {c.approvalMode === 'MEMBER_VOTE' ? 'This schedule is a draft. Members are voting on it under Decisions & votes; nothing is due until it passes.' : 'This schedule is a draft awaiting officer approval. Nothing is due until it is approved.'}
            </Notice>
          )}
          {c.status === 'CANCELLED' && <Notice tone="neutral">This rotation was cancelled before it started.</Notice>}
          {c.drawSeed && <Notice tone="neutral" icon="shuffle-outline">{`The order was drawn at random. Draw seed: ${c.drawSeed}. Anyone can re-run the draw with this seed to check it.`}</Notice>}
          {c.myRounds.map((r) => <MyPayout key={r.id} cycle={c} r={r} />)}
          <StatGrid>
            <Stat label="Current recipient" value={c.currentRound?.recipientName ?? '—'} sub={c.currentRound ? date(c.currentRound.payoutDate) : 'Cycle complete'} />
            <Stat label="Next recipient" value={c.nextRound?.recipientName ?? '—'} sub={c.nextRound ? date(c.nextRound.payoutDate) : undefined} />
            <Stat label="Expected this round" value={kes(c.currentRound?.expectedCents ?? 0, true)} />
            <Stat label="Confirmed so far" value={kes(c.currentRound?.confirmedCents ?? 0, true)} tone={c.currentRound?.shortfallCents ? 'warning' : 'success'} />
          </StatGrid>
          <Section title="Payout order">
            {c.rounds.map((r, i) => {
              const mine = c.myRounds.some((m) => m.id === r.id);
              const pct = r.expectedCents ? Math.min(100, Math.round((r.confirmedCents / r.expectedCents) * 100)) : 0;
              return (
                <Row
                  key={r.id}
                  title={`${r.round}${multi ? `.${r.slot}` : ''}. ${r.recipientName}${mine ? ' (you)' : ''}`}
                  subtitle={
                    <View>
                      <T variant="small">{`${date(r.payoutDate)} · ${STAGE[r.status]}`}</T>
                      {['READINESS_CHECK', 'AWAITING_APPROVAL', 'APPROVED'].includes(r.status) && (
                        <View style={{ height: 4, backgroundColor: colors.neutralTint, borderRadius: 2, marginTop: 6 }} accessibilityLabel={`${pct}% collected`}>
                          <View style={{ height: 4, width: `${pct}%`, backgroundColor: colors.rose, borderRadius: 2 }} />
                        </View>
                      )}
                    </View>
                  }
                  right={r.status === 'COMPLETED' ? kes(r.payoutAmountCents ?? 0) : kes(multi ? r.expectedShareCents : r.expectedCents)}
                  rightSub={<StatusBadge status={r.status} />}
                  onPress={r.status === 'COMPLETED' ? () => askToConfirm('Share on WhatsApp?', `Round ${r.round} payout to ${r.recipientName}, from the group’s confirmed records.`, 'Share', () => shareSummary(`groups/${groupId}/share/payout/${r.id}`)) : undefined}
                  last={i === c.rounds.length - 1}
                />
              );
            })}
          </Section>
          {c.changeLog.length > 0 && (
            <Section title="Schedule amendments">
              {c.changeLog.map((ch, i) => (
                <Row
                  key={ch.id}
                  title={`${LABELS.rotationAmendment[ch.kind]}: ${ch.reason}`}
                  subtitle={`${date(ch.at)} · ${ch.byName}${ch.leftNames.length ? ` · leaving: ${ch.leftNames.join(', ')}` : ''}${ch.joinedNames.length ? ` · joining: ${ch.joinedNames.join(', ')}` : ''}`}
                  rightSub={<StatusBadge status={ch.status} />}
                  last={i === c.changeLog.length - 1}
                />
              ))}
            </Section>
          )}
          {c.approvedPlan && c.changeLog.some((ch) => ch.status === 'APPROVED') && (
            <Section title="Order as originally approved">
              {c.approvedPlan.map((p, i) => <Row key={`${p.round}.${p.slot}`} title={`${p.round}${multi ? `.${p.slot}` : ''}. ${p.memberName}`} subtitle={date(p.payoutDate)} last={i === c.approvedPlan!.length - 1} />)}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
