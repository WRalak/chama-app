import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Permission } from '@chamahub/shared';
import { Button, Empty, ErrorView, Field, Loading, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { dateTime } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/** Group announcements; the secretary (or another permitted officer) sends them to every member. */
export default function Announcements() {
  const { groupId, can } = useGroupAccess();
  const list = useQuery({ queryKey: ['announcements', groupId], queryFn: () => api<{ id: string; title: string; body: string; createdAt: string }[]>(`groups/${groupId}/announcements`) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const send = useAct(() => api(`groups/${groupId}/announcements`, { body: { title: title.trim(), body: body.trim() } }), { invalidate: [['announcements', groupId]], successMessage: 'Sent to every member.', onSuccess: () => { setTitle(''); setBody(''); } });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Announcements' }} />
      {can(Permission.ANNOUNCEMENTS_SEND) && (
        <Section title="New announcement">
          <View style={{ padding: space.lg }}>
            <Notice tone="neutral">Goes to every member in the app and by their chosen channels. Do not include anyone’s private balances or loans.</Notice>
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. AGM moved to Saturday" />
            <Field label="Message" value={body} onChangeText={setBody} multiline />
            <Button title="Send to all members" onPress={() => askToConfirm('Send to all members?', title, 'Send', () => send.mutate(undefined))} disabled={title.trim().length < 3 || body.trim().length < 3} loading={send.isPending} />
          </View>
        </Section>
      )}
      <Section title="Recent">
        {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty title="No announcements yet" icon="megaphone-outline" /> : list.data.map((a, i) => (
          <View key={a.id} style={{ padding: space.lg, borderBottomWidth: i === list.data!.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <T variant="label">{a.title}</T>
            <T variant="small">{dateTime(a.createdAt)}</T>
            <T variant="body" style={{ marginTop: 4 }}>{a.body}</T>
          </View>
        ))}
      </Section>
    </Screen>
  );
}
