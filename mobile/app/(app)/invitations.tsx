import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { InvitationRow, LABELS } from '@chamahub/shared';
import { Button, Empty, ErrorView, Loading, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

export default function Invitations() {
  const list = useQuery({ queryKey: ['invitations'], queryFn: () => api<InvitationRow[]>('invitations') });
  const respond = useAct(({ id, accept }: { id: string; accept: boolean }) => api<{ groupId: string }>(`invitations/${id}/respond`, { body: { accept } }), {
    invalidate: [['invitations'], ['dashboard'], ['groups']],
    onSuccess: (r) => r.groupId && router.replace(`/(app)/group/${r.groupId}`),
  });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Invitations' }} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty title="No pending invitations" icon="mail-open-outline" /> : (
        <Section>
          {list.data.map((inv, i) => (
            <View key={inv.id} style={{ padding: space.lg, borderBottomWidth: i === list.data!.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <T variant="heading">{inv.groupName}</T>
              <T variant="small">{`${inv.invitedByName} invited you as ${LABELS.groupRole[inv.role].toLowerCase()} · expires ${date(inv.expiresAt)}`}</T>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Button title="Join" onPress={() => respond.mutate({ id: inv.id, accept: true })} style={{ flex: 1 }} loading={respond.isPending} />
                <Button title="Decline" variant="secondary" onPress={() => respond.mutate({ id: inv.id, accept: false })} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
        </Section>
      )}
    </Screen>
  );
}
