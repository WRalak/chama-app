'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Health { database: 'ok' | 'down'; failedJobs24h: number; failedDeliveries24h: number; integrations: { key: string; name: string; configured: boolean; status: string }[] }

export default function IntegrationsPage() {
  const q = useQuery({ queryKey: ['platform-integrations'], queryFn: () => api<Health>('platform/integrations'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="Integrations" description="What is configured on this server. Configured does not mean verified: payment providers still need end-to-end tests with real credentials." />
      {q.error ? <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel> : !q.data ? <Panel><LoadingRows /></Panel> : (
        <>
          <StatStrip stats={[
            { label: 'Database', value: q.data.database === 'ok' ? 'Reachable' : 'Down', tone: q.data.database === 'ok' ? 'success' : 'danger' },
            { label: 'Failed background jobs (24 h)', value: q.data.failedJobs24h, tone: q.data.failedJobs24h ? 'warning' : 'default' },
            { label: 'Failed notifications (24 h)', value: q.data.failedDeliveries24h, tone: q.data.failedDeliveries24h ? 'warning' : 'default' },
          ]} />
          <Panel flush>
            <ul className="divide-y divide-line">
              {q.data.integrations.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div><p className="text-sm font-medium text-plum">{i.name}</p><p className="text-xs text-muted">{i.status}</p></div>
                  <Badge tone={i.configured ? 'green' : 'neutral'}>{i.configured ? 'Configured' : 'Not configured'}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="mt-3 text-xs text-muted">Credentials are set as server environment variables (see docs/PLATFORM_ADMIN.md and backend/.env.example). They are never shown or entered here.</p>
        </>
      )}
    </>
  );
}
