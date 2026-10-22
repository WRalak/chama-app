'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { NotificationItem, Paginated } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { cn, dateTime } from '@/lib/utils';

/** Alerts across all the member's Chamas. Group announcements are under each group's Notifications page. */
export default function AllNotificationsPage() {
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: () => api<Paginated<NotificationItem> & { unread: number }>('notifications', { query: { pageSize: 50 } }) });
  const readAll = useAction(() => api('notifications/read-all', { method: 'POST' }), { invalidate: [['notifications']] });
  const read = useAction((id: string) => api(`notifications/${id}/read`, { method: 'POST' }), { invalidate: [['notifications']] });
  return (
    <>
      <PageHeader title="Notifications" description="Reminders, confirmations and decisions across all your Chamas." />
      <Panel className="max-w-3xl" title={`Inbox${inbox.data?.unread ? ` · ${inbox.data.unread} unread` : ''}`} actions={inbox.data?.unread ? <Button size="sm" variant="ghost" onClick={() => readAll.mutate(undefined)}>Mark all read</Button> : null} flush>
        {inbox.error ? <ErrorState error={inbox.error} onRetry={inbox.refetch} /> : !inbox.data ? <LoadingRows /> : inbox.data.items.length === 0 ? <EmptyState title="No notifications" /> : (
          <ul className="divide-y divide-line">
            {inbox.data.items.map((n) => (
              <li key={n.id} className={cn('px-4 py-3', !n.readAt && 'bg-blush/50')}>
                <div className="flex items-start justify-between gap-3">
                  <p className={cn('text-sm text-plum', !n.readAt && 'font-semibold')}>{n.title}</p>
                  <span className="shrink-0 text-2xs text-muted">{dateTime(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                <div className="mt-1 flex items-center gap-3 text-2xs">
                  {n.groupId && <Link href={`/g/${n.groupId}/overview`} className="text-berry hover:underline">{n.groupName}</Link>}
                  {!n.readAt && <button className="text-muted hover:text-plum hover:underline" onClick={() => read.mutate(n.id)}>Mark read</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
