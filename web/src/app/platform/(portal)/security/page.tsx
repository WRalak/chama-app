'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Paginated, PlatformAuditRow } from '@chamahub/shared';
import { AuditTable } from '@/components/platform/audit-table';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';

const MEMBER_LABEL: Record<string, string> = { 'auth.login_failed': 'Member sign-in failures', 'auth.refresh_reuse_detected': 'Stolen-token signals', 'auth.password_reset': 'Member password resets' };

export default function SecurityEventsPage() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['platform-security', page], queryFn: () => api<Paginated<PlatformAuditRow> & { memberAuth7d: { action: string; count: number }[] }>('platform/security-events', { query: { page, pageSize: 50 } }), placeholderData: (p) => p, refetchInterval: 60_000 });
  const counts = Object.keys(MEMBER_LABEL).map((a) => ({ label: `${MEMBER_LABEL[a]} (7 days)`, value: (q.data?.memberAuth7d.find((m) => m.action === a)?.count ?? 0).toLocaleString() }));
  return (
    <>
      <PageHeader title="Security Events" description="Failed and denied staff actions, sign-ins, lockouts, MFA and password changes, access changes and support access to group records." />
      {q.data && <StatStrip stats={counts} />}
      <Panel flush>
        <AuditTable rows={q.data?.items} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} server={q.data ? { page, pageSize: 50, total: q.data.total, onPageChange: setPage } : undefined} />
      </Panel>
    </>
  );
}
