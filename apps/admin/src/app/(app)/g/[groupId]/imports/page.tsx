'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { IMPORT_KINDS, ImportBatchDetail, ImportBatchRow, ImportKind, Permission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { LoadingRows } from '@/components/ui/states';
import { api, fileUrl } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId, useMe } from '@/lib/session';
import { dateTime, kes } from '@/lib/utils';

const KIND_LABEL: Record<ImportKind, string> = {
  MEMBERS: 'Member register',
  CONTRIBUTIONS: 'Historical contributions',
  LOANS: 'Outstanding loans',
  REPAYMENTS: 'Loan repayments',
  FINES: 'Fines',
  PAYOUTS: 'Payout history',
  OPENING_BALANCE: 'Opening balances',
};

/** Spreadsheets are converted to CSV in the browser; the server only ever receives CSV text. */
async function fileToCsv(file: File): Promise<string> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { dateNF: 'yyyy-mm-dd', rawNumbers: true } as never);
  }
  return file.text();
}

function BatchDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const { data: me } = useMe();
  const [onlyProblems, setOnlyProblems] = useState(true);
  const b = useQuery({ queryKey: ['import', groupId, id], queryFn: () => api<ImportBatchDetail>(`groups/${groupId}/imports/${id}`), enabled: !!id });
  const inv = [['imports', groupId], ['import', groupId, id]];
  const commit = useAction(() => api<ImportBatchDetail & { created: number }>(`groups/${groupId}/imports/${id}/commit`, { method: 'POST' }), { success: (r) => `Committed ${r.created} records`, invalidate: inv });
  const discard = useAction(() => api(`groups/${groupId}/imports/${id}/discard`, { method: 'POST' }), { success: 'Import discarded', invalidate: inv, onSuccess: onClose });
  const d = b.data;
  const rows = d ? d.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length) : [];
  const cols = d?.rows[0] ? Object.keys(d.rows[0].data) : [];
  const ownUpload = d && me && d.uploadedByName === me.fullName;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={d ? `${KIND_LABEL[d.kind]} · ${d.fileName}` : 'Import'} subtitle={d && <StatusBadge status={d.status} />} width="max-w-5xl">
      {!d ? <LoadingRows /> : (
        <div className="space-y-4">
          <KeyValues items={[['Rows', d.rowCount], ['With errors', <span key="e" className={d.errorCount ? 'text-danger' : ''}>{d.errorCount}</span>], ['With warnings', d.warningCount], ['Uploaded by', `${d.uploadedByName} · ${dateTime(d.createdAt)}`], ['Reviewed by', d.reviewedByName ?? '—'], ...(d.summary.totalAmountCents !== undefined ? [['Total amount (valid rows)', kes(d.summary.totalAmountCents)] as [string, string]] : []), ...(d.summary.totalBalanceCents !== undefined ? [['Total outstanding balance', kes(d.summary.totalBalanceCents)] as [string, string]] : [])]} />
          {d.status === 'VALIDATED' && (
            <div className="rounded-md border border-line bg-canvas p-3 text-sm">
              <p>Committing creates authoritative records in the group’s books. Check the warnings below against the paper records first.</p>
              {ownUpload && <p className="mt-1 text-warning">You uploaded this file, so a different officer must review and commit it.</p>}
              <div className="mt-3 flex gap-2">
                {can(Permission.IMPORTS_APPROVE) && <Button onClick={() => commit.mutate(undefined)} loading={commit.isPending} disabled={!!ownUpload}>Commit {d.rowCount} rows</Button>}
                <Button variant="secondary" onClick={() => discard.mutate(undefined)}>Discard</Button>
              </div>
            </div>
          )}
          {d.status === 'HAS_ERRORS' && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Fix the rows with errors in your spreadsheet and upload it again. Nothing has been saved. <Button size="sm" variant="secondary" className="ml-2" onClick={() => discard.mutate(undefined)}>Discard</Button>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with errors or warnings</label>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-line bg-canvas text-left text-muted"><th className="px-2 py-1.5 font-medium">Row</th>{cols.map((c) => <th key={c} className="px-2 py-1.5 font-medium">{c}</th>)}<th className="px-2 py-1.5 font-medium">Issues</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber} className={r.errors.length ? 'bg-red-50/60' : r.warnings.length ? 'bg-amber-50/60' : ''}>
                    <td className="border-b border-line px-2 py-1.5 text-muted">{r.rowNumber}</td>
                    {cols.map((c) => <td key={c} className="border-b border-line px-2 py-1.5">{r.data[c]}</td>)}
                    <td className="border-b border-line px-2 py-1.5">{r.errors.map((e) => <p key={e} className="text-danger">{e}</p>)}{r.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="py-6 text-center text-sm text-muted">No problems found.</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export default function ImportsPage() {
  const groupId = useGroupId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>('MEMBERS');
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['imports', groupId], queryFn: () => api<ImportBatchRow[]>(`groups/${groupId}/imports`) });
  const upload = useAction(async (file: File) => api<ImportBatchDetail>(`groups/${groupId}/imports`, { body: { kind, fileName: file.name, csv: await fileToCsv(file) } }), {
    success: (r) => (r.errorCount ? `${r.errorCount} rows need fixing` : 'File checked — ready for review'),
    invalidate: [['imports', groupId]],
    onSuccess: (r) => setSel(r.id),
  });
  return (
    <>
      <PageHeader title="Imports and Migration" description="Move paper registers and old spreadsheets into ChamaHub. Every file is validated and must be reviewed by a second officer before it becomes part of the books." />
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Panel title="Upload a file">
          <div className="space-y-3">
            <Field label="What are you importing?" htmlFor="i-k">
              <Select id="i-k" value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>{IMPORT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
            </Field>
            <a className="block text-sm text-forest hover:underline" href={fileUrl(`groups/${groupId}/imports/templates/${kind}.csv`)}>Download the {KIND_LABEL[kind].toLowerCase()} template</a>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <Button className="w-full" onClick={() => fileRef.current?.click()} loading={upload.isPending}>Choose CSV or Excel file</Button>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
              <li>Import the member register first; other files match members by phone number.</li>
              <li>Import contribution history <em>or</em> an opening balance that already includes it — not both.</li>
              <li>Imported loan balances do not move cash; they carry the receivable into the books.</li>
              <li>Photo/OCR extraction from notebooks is planned. Extracted figures will always come here for review first and are never treated as final records.</li>
            </ul>
          </div>
        </Panel>
        <Panel title="Import history" flush>
          <DataTable<ImportBatchRow>
            data={list.data}
            loading={list.isLoading}
            error={list.error}
            onRowClick={(b) => setSel(b.id)}
            empty="No imports yet"
            columns={[
              { accessorKey: 'createdAt', header: 'Uploaded', cell: ({ row }) => dateTime(row.original.createdAt) },
              { accessorKey: 'kind', header: 'Type', cell: ({ row }) => KIND_LABEL[row.original.kind] },
              { accessorKey: 'fileName', header: 'File' },
              { accessorKey: 'rowCount', header: 'Rows', meta: { align: 'right' } },
              { accessorKey: 'errorCount', header: 'Errors', meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.errorCount ? 'text-danger' : ''}>{row.original.errorCount}</span> },
              { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              { accessorKey: 'uploadedByName', header: 'By' },
              { accessorKey: 'reviewedByName', header: 'Reviewed by', cell: ({ row }) => row.original.reviewedByName ?? '—' },
            ]}
          />
        </Panel>
      </div>
      <BatchDrawer id={sel} onClose={() => setSel(null)} />
    </>
  );
}
