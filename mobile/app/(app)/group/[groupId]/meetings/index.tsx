import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { isIsoDate, MeetingRow, Permission } from '@chamahub/shared';
import { View } from 'react-native';
import { Button, Chips, Empty, ErrorView, Field, Loading, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { useAct, useGroup } from '@/lib/queries';
import { space } from '@/theme';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function Meetings() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const group = useGroup(groupId);
  const canManage = group.data?.myMembership.permissions.includes(Permission.MEETINGS_MANAGE);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('14:00');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const create = useAct(() => api(`groups/${groupId}/meetings`, { body: { title, scheduledAt: `${day}T${time}:00+03:00`, location: location || undefined, agenda: agenda.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30), requiresRsvp: true } }), { invalidate: [['meetings', groupId]], successMessage: 'Meeting scheduled. Members were notified.', onSuccess: () => { setTitle(''); setDay(''); setLocation(''); setAgenda(''); } });
  const list = useQuery({ queryKey: ['meetings', groupId, scope], queryFn: () => api<MeetingRow[]>(`groups/${groupId}/meetings`, { query: { scope } }) });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Meetings' }} />
      {canManage && (
        <Section title="Schedule a meeting">
          <View style={{ padding: space.lg }}>
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field label="Date (YYYY-MM-DD)" value={day} onChangeText={setDay} placeholder="2026-11-05" />
            <Field label="Time (24h, EAT)" value={time} onChangeText={setTime} placeholder="14:00" />
            <Field label="Location" value={location} onChangeText={setLocation} />
            <Field label="Agenda (one item per line)" value={agenda} onChangeText={setAgenda} multiline placeholder={'Treasurer report\nPayout for round 4\nAOB'} />
            <Button title="Schedule and notify members" onPress={() => create.mutate(undefined)} loading={create.isPending} disabled={title.length < 3 || !isIsoDate(day) || !/^\d{2}:\d{2}$/.test(time)} />
          </View>
        </Section>
      )}
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
