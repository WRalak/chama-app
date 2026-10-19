import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { NotificationItem, Paginated } from '@chamahub/shared';
import { Button, Empty, ErrorView, Loading, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAct } from '@/lib/queries';

export default function Notifications() {
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => api<Paginated<NotificationItem> & { unread: number }>('notifications', { query: { pageSize: 50 } }) });
  const readAll = useAct(() => api('notifications/read-all', { method: 'POST' }), { invalidate: [['notifications'], ['dashboard']] });
  const read = useAct((id: string) => api(`notifications/${id}/read`, { method: 'POST' }), { invalidate: [['notifications'], ['dashboard']] });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <>
          {list.data.unread > 0 && <Button title="Mark all as read" variant="ghost" onPress={() => readAll.mutate(undefined)} />}
          <Section>
            {list.data.items.length === 0 ? <Empty title="No notifications" icon="notifications-off-outline" /> : list.data.items.map((n, i) => (
              <Row
                key={n.id}
                icon={n.readAt ? undefined : 'ellipse'}
                title={n.title}
                subtitle={`${n.body}\n${n.groupName ? `${n.groupName} · ` : ''}${dateTime(n.createdAt)}`}
                onPress={() => {
                  if (!n.readAt) read.mutate(n.id);
                  if (n.type === 'INVITATION') router.push('/(app)/invitations');
                  else if (n.groupId) router.push(`/(app)/group/${n.groupId}`);
                }}
                last={i === list.data!.items.length - 1}
              />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
