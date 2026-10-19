'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NotificationItem, Paginated, Permission } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { cn, dateTime } from '@/lib/utils';

export default function NotificationsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [form, setForm] = useState({ title: '', body: '' });
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: () => api<Paginated<NotificationItem> & { unread: number }>('notifications', { query: { pageSize: 50 } }) });
  const announcements = useQuery({ queryKey: ['announcements', groupId], queryFn: () => api<{ id: string; title: string; body: string; createdAt: string }[]>(`groups/${groupId}/announcements`) });
  const send = useAction(() => api(`groups/${groupId}/announcements`, { body: form }), { success: 'Announcement sent to all members', invalidate: [['announcements', groupId]], onSuccess: () => setForm({ title: '', body: '' }) });
  const readAll = useAction(() => api('notifications/read-all', { method: 'POST' }), { invalidate: [['notifications']] });
  const read = useAction((id: string) => api(`notifications/${id}/read`, { method: 'POST' }), { invalidate: [['notifications']] });
  return (
    <>
      <PageHeader title="Notifications" description="Your alerts across all Chamas, and announcements for this group." />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title={`Inbox${inbox.data?.unread ? ` · ${inbox.data.unread} unread` : ''}`} actions={inbox.data?.unread ? <Button size="sm" variant="ghost" onClick={() => readAll.mutate(undefined)}>Mark all read</Button> : null} flush>
          {!inbox.data ? <LoadingRows /> : inbox.data.items.length === 0 ? <EmptyState title="No notifications" /> : (
            <ul className="divide-y divide-line">
              {inbox.data.items.map((n) => (
                <li key={n.id} className={cn('px-4 py-3', !n.readAt && 'bg-forest-50/50')} onClick={() => !n.readAt && read.mutate(n.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn('text-sm', !n.readAt && 'font-medium')}>{n.title}</p>
                    <span className="shrink-0 text-2xs text-muted">{dateTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                  {n.groupName && <p className="mt-1 text-2xs text-muted">{n.groupName}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-5">
          {can(Permission.ANNOUNCEMENTS_SEND) && (
            <Panel title="Send an announcement">
              <div className="space-y-3">
                <Field label="Title" htmlFor="an-t"><Input id="an-t" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
                <Field label="Message" htmlFor="an-b" hint="Delivered in-app, and by SMS/WhatsApp where members have enabled it and the channel is configured."><Textarea id="an-b" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
                <Button onClick={() => send.mutate(undefined)} loading={send.isPending} disabled={form.title.length < 3 || form.body.length < 3}>Send to all members</Button>
              </div>
            </Panel>
          )}
          <Panel title="Past announcements" flush>
            {announcements.data?.length ? (
              <ul className="divide-y divide-line text-sm">{announcements.data.map((a) => <li key={a.id} className="px-4 py-2"><p className="font-medium">{a.title}</p><p className="text-muted">{a.body}</p><p className="mt-0.5 text-2xs text-muted">{dateTime(a.createdAt)}</p></li>)}</ul>
            ) : <p className="px-4 py-6 text-center text-sm text-muted">No announcements yet.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
