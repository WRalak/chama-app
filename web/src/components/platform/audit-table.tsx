'use client';

import { useState } from 'react';
import type { PlatformAuditRow } from '@chamahub/shared';
import { Badge } from '@/components/ui/badge';
import { DataTable, type ServerPagination } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { KeyValues } from '@/components/ui/layout-parts';
import { dateTime } from '@/lib/utils';

const OUTCOME_TONE = { SUCCESS: 'green', FAILURE: 'red', DENIED: 'amber' } as const;

export function AuditTable({ rows, loading, error, server, onRetry }: { rows?: PlatformAuditRow[]; loading?: boolean; error?: unknown; server?: ServerPagination; onRetry?: () => void }) {
  const [open, setOpen] = useState<PlatformAuditRow | null>(null);
  return (
    <>
      <DataTable<PlatformAuditRow>
        data={rows}
        loading={loading}
        error={error}
        onRetry={onRetry}
        server={server}
        onRowClick={setOpen}
        empty="No events"
        columns={[
          { accessorKey: 'at', header: 'Time', enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap">{dateTime(row.original.at)}</span> },
          { accessorKey: 'actor', header: 'Actor', enableSorting: false, cell: ({ row }) => row.original.actor ?? 'System' },
          { accessorKey: 'action', header: 'Action', enableSorting: false, cell: ({ row }) => <code className="text-xs">{row.original.action}</code> },
          { id: 'target', header: 'Target', cell: ({ row }) => (row.original.targetType ? <span className="text-xs">{row.original.targetType}<span className="block font-mono text-2xs text-muted">{row.original.targetId}</span></span> : '—') },
          { accessorKey: 'outcome', header: 'Outcome', enableSorting: false, cell: ({ row }) => <Badge tone={OUTCOME_TONE[row.original.outcome]}>{row.original.outcome.toLowerCase()}</Badge> },
          { accessorKey: 'reason', header: 'Reason', enableSorting: false, cell: ({ row }) => <span className="line-clamp-2">{row.original.reason ?? ''}</span> },
        ]}
      />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.action ?? ''} subtitle={open ? dateTime(open.at) : ''}>
        {open && (
          <div className="space-y-4 text-sm">
            <KeyValues items={[['Actor', open.actor ?? 'System'], ['Outcome', open.outcome], ['Target', open.targetType ? `${open.targetType} ${open.targetId ?? ''}` : '—'], ['Reason', open.reason ?? '—'], ['Request id', open.requestId ?? '—'], ['IP address', open.ipAddress ?? '—']]} />
            {open.before != null && <div><p className="mb-1 text-xs font-semibold text-plum">Before</p><pre className="overflow-x-auto rounded-lg bg-canvas p-2 text-xs ring-1 ring-line">{JSON.stringify(open.before, null, 2)}</pre></div>}
            {open.after != null && <div><p className="mb-1 text-xs font-semibold text-plum">After</p><pre className="overflow-x-auto rounded-lg bg-canvas p-2 text-xs ring-1 ring-line">{JSON.stringify(open.after, null, 2)}</pre></div>}
            <p className="text-xs text-muted">Audit records cannot be edited or deleted. Passwords, tokens and codes are never recorded.</p>
          </div>
        )}
      </Sheet>
    </>
  );
}
