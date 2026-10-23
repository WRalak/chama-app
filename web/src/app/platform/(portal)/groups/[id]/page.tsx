'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PlatformPermission } from '@chamahub/shared';
import { ConfirmAction } from '@/components/platform/confirm-action';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Field, Select, Textarea } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/platform-session';
import { date, dateTime } from '@/lib/utils';

interface GroupDetail {
  id: string; name: string; type: string; status: string; countryCode: string; currency: string; timezone: string; members: number; plan: string; subscriptionStatus: string | null; currentPeriodEnd: string | null; createdAt: string;
  officers: { role: string; name: string }[];
  supportCases: { id: string; number: string; subject: string; status: string; priority: string; createdAt: string }[];
  billingCases: { id: string; subject: string; status: string; priority: string; createdAt: string }[];
  interventions: { id: string; action: string; at: string; by: string; reason: string | null; details: { kind?: string } | null }[];
  accessGrants: { id: string; by: string; purpose: string; status: string; expiresAt: string | null; createdAt: string }[];
}

const KINDS = [['NOTE', 'Note'], ['CONTACTED_OFFICERS', 'Contacted the officers'], ['BILLING_ADJUSTMENT_REQUESTED', 'Billing adjustment requested'], ['FRAUD_REVIEW', 'Fraud review'], ['ESCALATION', 'Escalation']] as const;

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = usePlatformCan();
  const g = useQuery({ queryKey: ['platform-group', id], queryFn: () => api<GroupDetail>(`platform/groups/${id}`) });
  const inv = [['platform-group', id], ['platform-groups']];
  const suspend = useAction((reason: string) => api(`platform/groups/${id}/suspend`, { body: { reason } }), { success: 'Group paused; officers were notified', invalidate: inv });
  const reactivate = useAction((reason: string) => api(`platform/groups/${id}/reactivate`, { body: { reason } }), { success: 'Group active again', invalidate: inv });
  const [kind, setKind] = useState<string>('NOTE');
  const [note, setNote] = useState('');
  const record = useAction(() => api(`platform/groups/${id}/interventions`, { body: { kind, note } }), { success: 'Recorded', invalidate: inv, onSuccess: () => setNote('') });
  if (g.error) return <Panel><ErrorState error={g.error} onRetry={() => g.refetch()} /></Panel>;
  if (!g.data) return <Panel><LoadingRows rows={6} /></Panel>;
  const d = g.data;
  const manage = can(PlatformPermission.PLATFORM_MANAGE_GROUPS);
  return (
    <>
      <PageHeader title={d.name} description={<span className="inline-flex items-center gap-2"><StatusBadge status={d.status} /> {d.type.toLowerCase().replace(/_/g, ' ')} · {d.countryCode} · {d.currency}</span>} actions={<Link href="/platform/groups" className="text-sm text-berry hover:underline">All groups</Link>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Group" className="lg:col-span-2">
          <KeyValues items={[
            ['Group id', <code key="i" className="text-xs">{d.id}</code>],
            ['Members', d.members],
            ['Officers', d.officers.map((o) => `${o.name} (${o.role.toLowerCase()})`).join(', ') || '—'],
            ['Plan', d.plan],
            ['Subscription', d.subscriptionStatus ? `${d.subscriptionStatus.toLowerCase()}${d.currentPeriodEnd ? ` until ${date(d.currentPeriodEnd)}` : ''}` : 'Free'],
            ['Time zone', d.timezone],
            ['Created', date(d.createdAt)],
          ]} />
          {can(PlatformPermission.PLATFORM_VIEW_BILLING) && <Link href={`/platform/billing/${d.id}`} className="mt-3 inline-block text-sm text-berry hover:underline">Open billing for this group</Link>}
        </Panel>
        {manage && d.status !== 'ARCHIVED' && (
          <Panel title="Controls">
            {d.status === 'SUSPENDED' ? (
              <ConfirmAction trigger={(open) => <Button className="w-full" onClick={open}>Reactivate group</Button>} title="Reactivate this group?" description="Officers can record money and make changes again." confirmLabel="Reactivate" busy={reactivate.isPending} onConfirm={(r) => reactivate.mutateAsync(r)} />
            ) : (
              <ConfirmAction trigger={(open) => <Button variant="danger" className="w-full" onClick={open}>Pause group</Button>} danger title={`Pause ${d.name}?`} description="Members keep read access to every record, but nothing can be recorded or changed until you reactivate it. Officers are notified with your reason. Use for suspected fraud or abuse." confirmLabel="Pause group" busy={suspend.isPending} onConfirm={(r) => suspend.mutateAsync(r)} />
            )}
          </Panel>
        )}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Interventions & escalations">
          {(manage || can(PlatformPermission.PLATFORM_SUPPORT_MANAGE)) && (
            <form className="mb-4 space-y-2" onSubmit={(e) => { e.preventDefault(); record.mutate(undefined); }}>
              <div className="flex gap-2">
                <Select aria-label="Kind" className="w-56" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                <Button type="submit" variant="secondary" loading={record.isPending} disabled={note.trim().length < 5}>Record</Button>
              </div>
              <Field label="Details" htmlFor="iv-note"><Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </form>
          )}
          {d.interventions.length ? (
            <ul className="space-y-2 text-sm">{d.interventions.map((i) => <li key={i.id} className="rounded-lg bg-canvas px-3 py-2 ring-1 ring-line"><p className="text-xs text-muted">{dateTime(i.at)} · {i.by} · {(i.details?.kind ?? i.action.replace('platform.group_', '')).toLowerCase().replace(/_/g, ' ')}</p>{i.reason && <p className="text-plum">{i.reason}</p>}</li>)}</ul>
          ) : <p className="text-sm text-muted">Nothing recorded.</p>}
        </Panel>
        <div className="space-y-5">
          <Panel title="Support cases" flush>
            <DataTable data={d.supportCases} empty="No cases" columns={[
              { accessorKey: 'number', header: 'Case', cell: ({ row }) => <Link href={`/platform/support/${row.original.id}`} className="font-mono text-xs text-berry hover:underline">{row.original.number}</Link> },
              { accessorKey: 'subject', header: 'Subject' },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => row.original.status.toLowerCase().replace(/_/g, ' ') },
            ]} />
          </Panel>
          {can(PlatformPermission.PLATFORM_VIEW_BILLING) && (
            <Panel title="Billing cases" flush>
              <DataTable data={d.billingCases} empty="No billing cases" columns={[{ accessorKey: 'subject', header: 'Subject' }, { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> }, { accessorKey: 'createdAt', header: 'Opened', cell: ({ row }) => date(row.original.createdAt) }]} />
            </Panel>
          )}
          <Panel title="Support access to records" flush>
            <DataTable data={d.accessGrants} empty="Never requested" columns={[{ accessorKey: 'by', header: 'Requested by' }, { accessorKey: 'purpose', header: 'Purpose' }, { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> }]} />
          </Panel>
        </div>
      </div>
    </>
  );
}
