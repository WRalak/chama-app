'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { EmptyState, ErrorState, LoadingRows } from './states';

export interface ServerPagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * Financial data table. Client-side sorting/filtering for small sets, or
 * pass `server` for API-paginated ledgers.
 */
export function DataTable<T>({
  columns,
  data,
  loading,
  error,
  onRetry,
  onRowClick,
  globalFilter,
  empty = 'Nothing to show yet',
  emptyDescription,
  server,
  pageSize = 25,
  rowClassName,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  globalFilter?: string;
  empty?: string;
  emptyDescription?: string;
  server?: ServerPagination;
  pageSize?: number;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(server ? { manualPagination: true, pageCount: Math.ceil(server.total / server.pageSize) } : { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize, pageIndex: 0 } } }),
  });

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !data) return <LoadingRows />;
  const rows = table.getRowModel().rows;
  const total = server ? server.total : table.getFilteredRowModel().rows.length;
  const page = server ? server.page : table.getState().pagination.pageIndex + 1;
  const size = server ? server.pageSize : table.getState().pagination.pageSize;
  const pages = Math.max(1, Math.ceil(total / size));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-canvas/60">
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as { align?: 'right' } | undefined;
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} scope="col" className={cn('whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted', meta?.align === 'right' && 'text-right')}>
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button className={cn('inline-flex items-center gap-1 hover:text-navy', meta?.align === 'right' && 'flex-row-reverse')} onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cn('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-canvas', rowClassName?.(r.original))}
                onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r.original) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {r.getVisibleCells().map((c) => {
                  const meta = c.column.columnDef.meta as { align?: 'right' } | undefined;
                  return (
                    <td key={c.id} className={cn('px-3 py-2 align-top text-navy', meta?.align === 'right' && 'text-right tabular-nums')}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState title={empty} description={emptyDescription} />}
      {total > size && (
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
          <span>
            {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => (server ? server.onPageChange(page - 1) : table.previousPage())}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button variant="ghost" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => (server ? server.onPageChange(page + 1) : table.nextPage())}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
