'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Paginated, PlatformAuditRow } from '@chamahub/shared';
import { AuditTable } from '@/components/platform/audit-table';
import { Input, Select } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';

export default function AuditPage() {
  const [f, setF] = useState({ action: '', outcome: '', targetType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['platform-audit', f, page],
    queryFn: () => api<Paginated<PlatformAuditRow>>('platform/audit', { query: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page, pageSize: 50 } }),
    placeholderData: (p) => p,
  });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Audit Logs" description="Every staff action, sign-in and permission check that failed. Append-only; viewing it is itself recorded." />
      <Panel flush>
        <Toolbar>
          <Input className="w-56" placeholder="Action starts with, e.g. platform.staff" aria-label="Action" value={f.action} onChange={(e) => set('action', e.target.value)} />
          <Select className="w-36" aria-label="Outcome" value={f.outcome} onChange={(e) => set('outcome', e.target.value)}><option value="">Any outcome</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option><option value="DENIED">Denied</option></Select>
          <Select className="w-44" aria-label="Target type" value={f.targetType} onChange={(e) => set('targetType', e.target.value)}>
            <option value="">Any target</option>
            {['PlatformAccount', 'PlatformRole', 'SupportCase', 'User', 'Group', 'BillingPayment', 'Plan', 'PlanPrice', 'Region', 'PlatformSetting', 'Route'].map((t) => <option key={t}>{t}</option>)}
          </Select>
          <Input type="date" className="w-40" aria-label="From" value={f.from} onChange={(e) => set('from', e.target.value)} />
          <Input type="date" className="w-40" aria-label="To" value={f.to} onChange={(e) => set('to', e.target.value)} />
        </Toolbar>
        <AuditTable rows={q.data?.items} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} server={q.data ? { page, pageSize: 50, total: q.data.total, onPageChange: setPage } : undefined} />
      </Panel>
    </>
  );
}
