import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { MeetingRow } from '@chamahub/shared';
import { Chips, Empty, ErrorView, Loading, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function Meetings() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const list = useQuery({ queryKey: ['meetings', groupId, scope], queryFn: () => api<MeetingRow[]>(`groups/${groupId}/meetings`, { query: { scope } }) });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Meetings' }} />
      <Chips value={scope} onChange={setScope} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past & minutes' }]} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section>
          {list.data.length === 0 ? <Empty title={scope === 'upcoming' ? 'No upcoming meetings' : 'No past meetings'} icon="calendar-outline" /> : list.data.map((m, i) => (
            <Row
              key={m.id}
              title={m.title}
              subtitle={`${dateTime(m.scheduledAt)}${m.location ? ` · ${m.location}` : m.virtualLink ? ' · Online' : ''}`}
              rightSub={<StatusBadge status={m.myAttendance ?? (m.minutesStatus === 'APPROVED' ? 'APPROVED' : m.status)} />}
              onPress={() => router.push(`/(app)/group/${groupId}/meetings/${m.id}`)}
              last={i === list.data!.length - 1}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
