'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AuditEventRow, Paginated, Permission } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api, fileUrl } from '@/lib/api';
import { useCan, useGroupId } from '@/lib/session';
import { dateTime } from '@/lib/utils';

const AREAS = ['payment', 'loan', 'expense', 'fine', 'payout', 'rotation', 'distribution', 'member', 'invitation', 'schedule', 'obligation', 'ledger', 'import', 'meeting', 'minutes', 'statement', 'group', 'support'];

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  return <pre className="max-h-72 overflow-auto rounded-md bg-canvas p-2 text-2xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ action: '', from: '', to: '' });
  const [sel, setSel] = useState<AuditEventRow | null>(null);
  const query = { page, pageSize: 50, action: f.action || undefined, from: f.from || undefined, to: f.to || undefined };
  const events = useQuery({ queryKey: ['audit', groupId, query], queryFn: () => api<Paginated<AuditEventRow>>(`groups/${groupId}/audit`, { query }), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Audit Logs" description={can(Permission.AUDIT_VIEW) ? 'An append-only record of every action. Entries cannot be edited or deleted — not even by ChamaHub staff.' : can(Permission.AUDIT_VIEW_AREA) ? 'Records for the areas you work in, plus your own actions. The full log is available to the chairperson and auditor.' : 'Your own recorded activity in this group.'} actions={<Button variant="secondary" asChild><a href={fileUrl(`groups/${groupId}/reports/audit`, { format: 'csv', from: f.from || undefined, to: f.to || undefined })}>Export CSV</a></Button>} />
      <Panel flush>
        <Toolbar>
          <Field label="Area" htmlFor="a-a"><Select id="a-a" value={f.action} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }}><option value="">Everything</option>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}</Select></Field>
          <Field label="From" htmlFor="a-f"><Input id="a-f" type="date" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} /></Field>
          <Field label="To" htmlFor="a-t"><Input id="a-t" type="date" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} /></Field>
        </Toolbar>
        <DataTable<AuditEventRow>
          data={events.data?.items}
          loading={events.isLoading}
          error={events.error}
          onRowClick={setSel}
          server={events.data ? { page, pageSize: 50, total: events.data.total, onPageChange: setPage } : undefined}
          empty="No audit events"
          columns={[
            { accessorKey: 'at', header: 'Time (EAT)', cell: ({ row }) => dateTime(row.original.at), enableSorting: false },
            { accessorKey: 'actorName', header: 'User', cell: ({ row }) => row.original.actorName ?? 'System', enableSorting: false },
            { accessorKey: 'action', header: 'Action', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>, enableSorting: false },
            { accessorKey: 'entityType', header: 'Record', enableSorting: false },
            { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => <span className="line-clamp-1 max-w-xs">{row.original.reason ?? ''}</span>, enableSorting: false },
            { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? ''}</span>, enableSorting: false },
          ]}
        />
      </Panel>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel?.action ?? ''} subtitle={sel && `${dateTime(sel.at)} · ${sel.actorName ?? 'System'}`}>
        {sel && (
          <div className="space-y-4">
            <KeyValues items={[['Record', `${sel.entityType} ${sel.entityId ?? ''}`], ['Reason', sel.reason ?? '—'], ['Reference', sel.reference ?? '—'], ['IP address', sel.ipAddress ?? '—']]} />
            <div className="grid gap-3 md:grid-cols-2">
              <div><p className="mb-1 text-xs font-semibold text-muted">Before</p><Json value={sel.before} /></div>
              <div><p className="mb-1 text-xs font-semibold text-muted">After</p><Json value={sel.after} /></div>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
