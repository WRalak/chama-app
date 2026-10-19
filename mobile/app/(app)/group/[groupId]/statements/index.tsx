import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Empty, ErrorView, Loading, Notice, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';

export default function Statements() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const list = useQuery({ queryKey: ['statements', groupId], queryFn: () => api<{ id: string; from: string; to: string; publishedAt: string; closingBalanceCents: number }[]>(`groups/${groupId}/statements`) });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Group statements' }} />
      <Notice tone="neutral">These are the financial summaries your officers have approved and published.</Notice>
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section>
          {list.data.length === 0 ? <Empty title="No statements published yet" icon="document-text-outline" /> : list.data.map((s, i) => (
            <Row key={s.id} title={`${date(s.from)} – ${date(s.to)}`} subtitle={`Published ${date(s.publishedAt)}`} right={kes(s.closingBalanceCents)} rightSub="Closing balance" onPress={() => router.push(`/(app)/group/${groupId}/statements/${s.id}`)} last={i === list.data!.length - 1} />
          ))}
        </Section>
      )}
    </Screen>
  );
}
