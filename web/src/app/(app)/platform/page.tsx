'use client';

import { useQuery } from '@tanstack/react-query';
import { PlatformOverview } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { dateTime, kes } from '@/lib/utils';

export default function PlatformPage() {
  const o = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<PlatformOverview>('platform/overview'), refetchInterval: 60_000 });
  if (o.error) return <ErrorState error={o.error} onRetry={o.refetch} />;
  if (!o.data) return <LoadingRows />;
  const d = o.data;
  return (
    <>
      <PageHeader title="Platform overview" description="SaaS health and usage. Group finances are not visible here." />
      <StatStrip
        stats={[
          { label: 'Registered Chamas', value: d.totalGroups.toLocaleString(), hint: `${d.activeGroups} active in 30 days` },
          { label: 'Registered users', value: d.totalUsers.toLocaleString(), hint: `+${d.newUsers30d} in 30 days` },
          { label: 'Subscriptions', value: (d.subscriptions.ACTIVE ?? 0).toLocaleString(), hint: `${d.subscriptions.TRIALING ?? 0} trials · ${d.subscriptions.PAST_DUE ?? 0} in grace` },
          { label: 'Failed jobs / deliveries (24h)', value: d.failedJobs24h, tone: d.failedJobs24h ? 'danger' : 'success' },
          { label: 'Open support requests', value: d.openSupportRequests, tone: d.openSupportRequests ? 'warning' : 'default' },
        ]}
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="System health" flush>
          <ul className="divide-y divide-line text-sm">
            <li className="flex items-center justify-between px-4 py-2"><span>Database</span><StatusBadge status={d.health.database === 'ok' ? 'ACTIVE' : 'FAILED'} /></li>
            {d.health.integrations.map((i) => <li key={i.name} className="flex items-center justify-between gap-3 px-4 py-2"><span>{i.name}</span><span className="text-right text-xs text-muted">{i.status}</span></li>)}
          </ul>
        </Panel>
        <Panel title="Subscriptions" flush>
          <ul className="divide-y divide-line text-sm">
            {Object.entries(d.subscriptions).map(([k, v]) => <li key={k} className="flex justify-between px-4 py-2"><StatusBadge status={k} /><span className="tabular-nums">{v}</span></li>)}
            {Object.keys(d.subscriptions).length === 0 && <li className="px-4 py-6 text-center text-muted">No subscriptions yet.</li>}
          </ul>
        </Panel>
        <Panel title="Recent security events" flush className="xl:col-span-2">
          <table className="w-full text-sm">
            <tbody>
              {d.securityEvents.map((e) => <tr key={e.id} className="border-b border-line last:border-0"><td className="px-4 py-2 text-muted">{dateTime(e.at)}</td><td className="px-4 py-2 font-mono text-xs">{e.action}</td><td className="px-4 py-2">{e.actorName ?? 'System'}</td><td className="px-4 py-2 text-muted">{e.reason ?? ''}</td><td className="px-4 py-2 text-xs text-muted">{e.ipAddress ?? ''}</td></tr>)}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
