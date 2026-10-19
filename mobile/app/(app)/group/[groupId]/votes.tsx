import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { ProposalRow } from '@chamahub/shared';
import { Button, Empty, ErrorView, Loading, Notice, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

const CHOICE_LABEL = { YES: 'Yes', NO: 'No', ABSTAIN: 'Abstain' } as const;

export default function Votes() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const list = useQuery({ queryKey: ['votes', groupId], queryFn: () => api<ProposalRow[]>(`groups/${groupId}/votes`) });
  const cast = useAct(({ id, choice }: { id: string; choice: 'YES' | 'NO' | 'ABSTAIN' }) => api(`groups/${groupId}/votes/${id}/ballot`, { body: { choice } }), { invalidate: [['votes', groupId]], successMessage: 'Your vote was recorded.' });
  const confirm = (p: ProposalRow, choice: 'YES' | 'NO' | 'ABSTAIN') =>
    Alert.alert(`Vote ${CHOICE_LABEL[choice].toLowerCase()}?`, `${p.title}\n\nVotes are final and cannot be changed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Cast vote', onPress: () => cast.mutate({ id: p.id, choice }) }]);
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Decisions & votes' }} />
      <Notice tone="neutral">Ballots are secret: everyone sees totals, nobody sees how you voted.</Notice>
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty title="No votes yet" icon="checkbox-outline" /> : list.data.map((p) => {
        const turnout = p.tally.YES + p.tally.NO + p.tally.ABSTAIN;
        return (
          <Section key={p.id}>
            <View style={{ padding: space.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <T variant="heading" style={{ flex: 1 }}>{p.title}</T>
                <StatusBadge status={p.status} />
              </View>
              <T variant="body" style={{ marginTop: space.sm }}>{p.description}</T>
              <T variant="small" style={{ marginTop: space.sm }}>{p.status === 'OPEN' ? `Closes ${dateTime(p.closesAt)}` : `Closed ${dateTime(p.closedAt)}`} · needs {p.quorumPercent}% turnout</T>
              {(['YES', 'NO', 'ABSTAIN'] as const).map((c) => (
                <View key={c} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <T variant="small" style={{ width: 64 }}>{CHOICE_LABEL[c]}</T>
                  <View style={{ flex: 1, height: 6, backgroundColor: colors.slateTint, borderRadius: 3 }}>
                    <View style={{ height: 6, borderRadius: 3, width: `${p.eligibleCount ? (p.tally[c] / p.eligibleCount) * 100 : 0}%`, backgroundColor: c === 'YES' ? colors.emerald : c === 'NO' ? colors.error : colors.muted }} />
                  </View>
                  <T variant="label" style={{ width: 28, textAlign: 'right' }}>{String(p.tally[c])}</T>
                </View>
              ))}
              <T variant="small" style={{ marginTop: 6 }}>{`${turnout} of ${p.eligibleCount} have voted`}</T>
              {p.myVote && <T variant="label" style={{ marginTop: space.sm }}>{`You voted ${CHOICE_LABEL[p.myVote].toLowerCase()}`}</T>}
              {p.canVote && (
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <Button title="Yes" onPress={() => confirm(p, 'YES')} style={{ flex: 1 }} />
                  <Button title="No" variant="secondary" onPress={() => confirm(p, 'NO')} style={{ flex: 1 }} />
                  <Button title="Abstain" variant="ghost" onPress={() => confirm(p, 'ABSTAIN')} style={{ flex: 1 }} />
                </View>
              )}
            </View>
          </Section>
        );
      })}
    </Screen>
  );
}
