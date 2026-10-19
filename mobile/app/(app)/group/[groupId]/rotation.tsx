import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { LABELS, PayoutStatus, RotationCycle } from '@chamahub/shared';
import { Chips, Empty, ErrorView, Loading, Notice, Row, Screen, Section, Stat, StatGrid, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes, relativeDay } from '@/lib/format';
import { colors, space } from '@/theme';

/** Plain-language stage so members can tell a planned payout from a paid one. */
const STAGE: Record<PayoutStatus, string> = {
  SCHEDULED: 'Scheduled — not yet collecting',
  COLLECTING: 'Collecting contributions',
  READY: 'Fully collected, awaiting approval',
  APPROVED: 'Approved by officers, awaiting payment',
  COMPLETED: 'Paid out',
  DEFERRED: 'Deferred',
};

export default function Rotation() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const cycles = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`) });
  const [sel, setSel] = useState<string>('');
  const c = cycles.data?.find((x) => x.id === sel) ?? cycles.data?.find((x) => x.status === 'ACTIVE') ?? cycles.data?.[0];
  return (
    <Screen refreshing={cycles.isRefetching} onRefresh={cycles.refetch}>
      <Stack.Screen options={{ title: 'Payout rotation' }} />
      {cycles.error ? <ErrorView error={cycles.error} onRetry={cycles.refetch} /> : !cycles.data ? <Loading /> : !c ? <Empty title="No rotation yet" body="Your officers have not set up a payout cycle." icon="sync-outline" /> : (
        <>
          {cycles.data.length > 1 && <Chips value={c.id} onChange={setSel} options={cycles.data.map((x) => ({ value: x.id, label: x.name }))} />}
          <T variant="small" style={{ marginBottom: space.md }}>{`${c.name} · ${kes(c.contributionCents)} ${LABELS.frequency[c.frequency].toLowerCase()} · ${c.remainingRounds} round${c.remainingRounds === 1 ? '' : 's'} left`}</T>
          {c.myRounds.map((r) => (
            <Notice key={r.id} tone={r.status === 'COMPLETED' ? 'green' : 'blue'} icon="gift-outline">
              {r.status === 'COMPLETED'
                ? `You received ${kes(r.confirmedCents)} in round ${r.round}${r.payoutReference ? ` (ref ${r.payoutReference})` : ''}.`
                : `Your payout is round ${r.round}, scheduled for ${date(r.payoutDate)} (${relativeDay(r.payoutDate).toLowerCase()}). Expected ${kes(r.expectedCents)}. You are paid what is actually collected once officers approve.`}
            </Notice>
          ))}
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
                  title={`${r.round}. ${r.recipientName}${mine ? ' (you)' : ''}`}
                  subtitle={
                    <View>
                      <T variant="small">{`${date(r.payoutDate)} · ${STAGE[r.status]}`}</T>
                      {r.status !== 'SCHEDULED' && r.status !== 'COMPLETED' && (
                        <View style={{ height: 4, backgroundColor: colors.slateTint, borderRadius: 2, marginTop: 6 }} accessibilityLabel={`${pct}% collected`}>
                          <View style={{ height: 4, width: `${pct}%`, backgroundColor: colors.emerald, borderRadius: 2 }} />
                        </View>
                      )}
                    </View>
                  }
                  right={r.status === 'COMPLETED' ? kes(r.confirmedCents) : kes(r.expectedCents)}
                  rightSub={<StatusBadge status={r.status} />}
                  last={i === c.rounds.length - 1}
                />
              );
            })}
          </Section>
          {c.changeLog.length > 0 && (
            <Section title="Order changes">
              {c.changeLog.map((ch, i) => <Row key={ch.id} title={ch.reason} subtitle={`${date(ch.at)} · ${ch.byName}`} rightSub={<StatusBadge status={ch.status} />} last={i === c.changeLog.length - 1} />)}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
