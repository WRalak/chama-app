'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { PaymentDestinationRow, Permission, STATEMENT_FIELDS, STATEMENT_MATCH_LABELS, StatementImportRow, StatementLineRow, StatementMapping, StatementPreview } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { MemberSelect } from '@/components/domain/member-select';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, dateTime, kes } from '@/lib/utils';

type FilePayload = { fileName: string; csv?: string; xlsxBase64?: string };
const TONE = { REPORT_MATCH: 'green', STRONG: 'green', SUGGESTED: 'amber', AMBIGUOUS: 'red', UNMATCHED: 'red', DUPLICATE: 'neutral', OUTGOING: 'neutral' } as const;

async function readStatement(file: File): Promise<FilePayload> {
  if (/\.xlsx$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { fileName: file.name, xlsxBase64: btoa(s) };
  }
  return { fileName: file.name, csv: await file.text() };
}

function LineActions({ l, onDone }: { l: StatementLineRow; onDone: () => void }) {
  const groupId = useGroupId();
  const [memberId, setMemberId] = useState(l.suggestedMemberId ?? '');
  const [reason, setReason] = useState('');
  const inv = [['statement-lines', groupId], ['statement-imports', groupId], ['overview', groupId], ['payments', groupId]];
  const resolve = useAction((body: object) => api<{ paymentStatus?: string }>(`groups/${groupId}/statement-lines/${l.id}/resolve`, { body }), { success: (r) => (r.paymentStatus === 'CONFIRMED' ? 'Confirmed — it matched the member’s report' : r.paymentStatus === 'PENDING' ? 'Recorded — a second officer must verify it' : 'Line ignored'), invalidate: inv, onSuccess: onDone });
  if (l.state !== 'OPEN') return <p className="text-sm text-muted">{l.state === 'CONFIRMED' ? `Assigned to ${l.resolvedMemberName} by ${l.resolvedByName}${l.resolvedPaymentStatus === 'PENDING' ? ' — waiting for a second officer' : ''}.` : `Ignored by ${l.resolvedByName}: ${l.resolutionNote}`}</p>;
  const blocked = l.match === 'DUPLICATE' || l.match === 'OUTGOING';
  return (
    <div className="space-y-3">
      {!blocked && (
        <>
          {l.candidates.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">{l.match === 'AMBIGUOUS' ? 'Several members fit — choose the right one' : 'Candidates'}</p>
              <ul className="space-y-1">{l.candidates.map((c) => <li key={c.membershipId}><label className="flex items-start gap-2 text-sm"><input type="radio" name={`c-${l.id}`} checked={memberId === c.membershipId} onChange={() => setMemberId(c.membershipId)} className="mt-1" /><span><b>{c.fullName}</b> <span className="text-muted">· score {c.score} · {c.reasons.join('; ')}</span></span></label></li>)}</ul>
            </div>
          )}
          <Field label="Member" htmlFor={`m-${l.id}`}><MemberSelect id={`m-${l.id}`} value={memberId} onChange={setMemberId} /></Field>
          <Button disabled={!memberId} loading={resolve.isPending} onClick={() => { if (confirm(`Assign ${kes(l.amountCents)} to this member?${l.reportPaymentId ? '' : ' It will still need a second officer to verify it.'}`)) resolve.mutate({ action: 'CONFIRM', memberId, purpose: 'CONTRIBUTION' }); }}>Assign to member</Button>
        </>
      )}
      <div className="flex items-end gap-2 border-t border-line pt-3">
        <Field label="Or ignore, with a reason" htmlFor={`r-${l.id}`} className="flex-1"><Input id={`r-${l.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={l.match === 'OUTGOING' ? 'e.g. Bank charges' : 'e.g. Not a member payment'} /></Field>
        <Button variant="secondary" disabled={reason.trim().length < 5} onClick={() => resolve.mutate({ action: 'IGNORE', reason: reason.trim() })}>Ignore</Button>
      </div>
    </div>
  );
}

function ImportDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const groupId = useGroupId();
  const can = useCan();
  const [filter, setFilter] = useState<'review' | 'clear' | 'done' | 'all'>('review');
  const [open, setOpen] = useState<StatementLineRow | null>(null);
  const q = useQuery({ queryKey: ['statement-lines', groupId, id], queryFn: () => api<StatementLineRow[]>(`groups/${groupId}/statement-imports/${id}/lines`), enabled: !!id });
  const inv = [['statement-lines', groupId], ['statement-imports', groupId], ['overview', groupId], ['payments', groupId]];
  const all = q.data ?? [];
  const clear = all.filter((l) => l.state === 'OPEN' && (l.match === 'REPORT_MATCH' || l.match === 'STRONG'));
  const bulk = useAction(() => api<{ confirmed: number; failed: unknown[] }>(`groups/${groupId}/statement-lines/confirm-matches`, { body: { lineIds: clear.map((l) => l.id) } }), { success: (r) => `${r.confirmed} confirmed${r.failed.length ? `, ${r.failed.length} need attention` : ''}`, invalidate: inv });
  const close = useAction(() => api(`groups/${groupId}/statement-imports/${id}/close`, { method: 'POST' }), { success: 'Statement closed', invalidate: inv, onSuccess: onClose });
  const discard = useAction(() => api(`groups/${groupId}/statement-imports/${id}/discard`, { method: 'POST' }), { success: 'Import discarded', invalidate: inv, onSuccess: onClose });
  const shown = all.filter((l) => (filter === 'all' ? true : filter === 'done' ? l.state !== 'OPEN' : filter === 'clear' ? clear.includes(l) : l.state === 'OPEN' && !clear.includes(l)));
  const manage = can(Permission.RECONCILIATION_MANAGE);
  const undecided = all.filter((l) => l.state === 'OPEN' && l.match !== 'DUPLICATE' && l.match !== 'OUTGOING').length;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title="Review statement" subtitle={`${all.length} lines · ${undecided} need a decision`} width="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['review', 'clear', 'done', 'all'] as const).map((f) => <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>{f === 'review' ? 'Needs a person' : f === 'clear' ? `Clear matches (${clear.length})` : f === 'done' ? 'Done' : 'All'}</Button>)}
        <span className="flex-1" />
        {manage && clear.length > 0 && <Button size="sm" onClick={() => { if (confirm('Confirm all clear matches? Reported payments are confirmed now; the rest are recorded for a second officer to verify.')) bulk.mutate(undefined); }} loading={bulk.isPending}>Confirm {clear.length} clear matches</Button>}
      </div>
      <DataTable<StatementLineRow>
        data={shown}
        loading={q.isLoading}
        error={q.error}
        onRowClick={manage ? setOpen : undefined}
        empty="Nothing here"
        columns={[
          { accessorKey: 'rowNo', header: 'Row' },
          { accessorKey: 'transactionAt', header: 'When', cell: ({ row }) => dateTime(row.original.transactionAt) },
          { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => <span className={row.original.amountCents < 0 ? 'text-danger' : ''}>{kes(row.original.amountCents)}</span>, meta: { align: 'right' } },
          { accessorKey: 'reference', header: 'Code', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
          { id: 'payer', header: 'Payer', cell: ({ row }) => <div className="text-xs">{row.original.payerName ?? '—'}<p className="text-muted">{[row.original.payerPhone, row.original.accountReference && `A/C ${row.original.accountReference}`].filter(Boolean).join(' · ')}</p></div> },
          { id: 'match', header: 'Match', cell: ({ row }) => <div className="max-w-xs"><Badge tone={row.original.state === 'OPEN' ? TONE[row.original.match] : row.original.state === 'CONFIRMED' ? 'green' : 'neutral'}>{row.original.state === 'OPEN' ? STATEMENT_MATCH_LABELS[row.original.match] : row.original.state.toLowerCase()}</Badge><p className="mt-0.5 text-xs text-muted">{row.original.state === 'CONFIRMED' ? row.original.resolvedMemberName : row.original.explanation}</p></div> },
        ]}
      />
      {manage && (
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" disabled={undecided > 0} onClick={() => close.mutate(undefined)} loading={close.isPending}>Close statement</Button>
          {!all.some((l) => l.state === 'CONFIRMED') && <Button variant="ghost" onClick={() => { if (confirm('Discard this import? Nothing was recorded from it.')) discard.mutate(undefined); }}>Discard import</Button>}
        </div>
      )}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `${kes(open.amountCents)} · ${open.reference ?? `row ${open.rowNo}`}` : ''} subtitle={open?.explanation}>
        {open && <LineActions key={open.id} l={open} onDone={() => setOpen(null)} />}
      </Sheet>
    </Sheet>
  );
}

export default function StatementImportsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<FilePayload | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<StatementMapping>>({});
  const [destinationId, setDestinationId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const imports = useQuery({ queryKey: ['statement-imports', groupId], queryFn: () => api<StatementImportRow[]>(`groups/${groupId}/statement-imports`) });
  const dests = useQuery({ queryKey: ['destinations', groupId], queryFn: () => api<PaymentDestinationRow[]>(`groups/${groupId}/payment-destinations`) });
  const runPreview = useAction((v: { f: FilePayload; m?: Partial<StatementMapping> }) => api<StatementPreview>(`groups/${groupId}/statement-imports/preview`, { body: { ...v.f, mapping: v.m } }), { onSuccess: (p) => { setPreview(p); setMapping(p.mapping); } });
  const doImport = useAction(() => api<{ id: string; lineCount: number }>(`groups/${groupId}/statement-imports`, { body: { ...file!, mapping, destinationId: destinationId || undefined } }), { success: (r) => `Imported ${r.lineCount} lines for review`, invalidate: [['statement-imports', groupId]], onSuccess: (r) => { setFile(null); setPreview(null); setOpenId(r.id); } });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    const payload = await readStatement(f);
    setFile(payload);
    setPreview(null);
    runPreview.mutate({ f: payload });
  };
  const remap = (key: keyof StatementMapping, header: string) => {
    const m = { ...mapping, [key]: header || undefined };
    setMapping(m);
    if (file) runPreview.mutate({ f: file, m });
  };
  return (
    <>
      <PageHeader
        title="Statement import"
        description="Upload a statement you downloaded from M-Pesa, the Paybill/Till portal or your bank. ChamaHub matches lines to members but never assigns an unclear line by itself, and never logs into your accounts."
        actions={can(Permission.RECONCILIATION_MANAGE) && <><input ref={input} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /><Button onClick={() => input.current?.click()}>Upload statement</Button></>}
      />
      {file && (
        <Panel title={`Preview · ${file.fileName}`} className="mb-5" actions={<Button variant="ghost" size="sm" onClick={() => { setFile(null); setPreview(null); }}>Cancel</Button>}>
          {!preview ? <p className="text-sm text-muted">Reading the file…</p> : (
            <div className="space-y-4">
              <p className="text-sm">{preview.rowCount} rows · {Object.entries(preview.counts).map(([k, v]) => `${k === 'ERROR' ? 'Unreadable' : k === 'SKIPPED' ? 'Skipped' : STATEMENT_MATCH_LABELS[k as keyof typeof STATEMENT_MATCH_LABELS]}: ${v}`).join(' · ')}</p>
              {preview.problems.map((p) => <p key={p} className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{p}</p>)}
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {STATEMENT_FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} htmlFor={`map-${f.key}`}>
                    <Select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(e) => remap(f.key, e.target.value)}><option value="">Not used</option>{preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}</Select>
                  </Field>
                ))}
              </div>
              <DataTable<StatementPreview['sample'][number]>
                data={preview.sample}
                empty="No rows"
                columns={[
                  { accessorKey: 'rowNo', header: 'Row' },
                  { id: 'when', header: 'When', cell: ({ row }) => (row.original.ok ? dateTime(row.original.transactionAt!) : <span className={row.original.skipped ? 'text-muted' : 'text-danger'}>{row.original.error}</span>) },
                  { id: 'amt', header: 'Amount', cell: ({ row }) => (row.original.ok ? kes(row.original.amountCents!) : ''), meta: { align: 'right' } },
                  { id: 'ref', header: 'Code', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? ''}</span> },
                  { id: 'payer', header: 'Payer', cell: ({ row }) => row.original.payer ?? '' },
                  { id: 'match', header: 'Match', cell: ({ row }) => (row.original.match ? <Badge tone={TONE[row.original.match]}>{STATEMENT_MATCH_LABELS[row.original.match]}</Badge> : null) },
                ]}
              />
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Which account is this statement for?" htmlFor="st-dest"><Select id="st-dest" value={destinationId} onChange={(e) => setDestinationId(e.target.value)}><option value="">Not sure</option>{(dests.data ?? []).filter((d) => d.status !== 'REJECTED' && d.status !== 'PENDING_APPROVAL').map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</Select></Field>
                <Button onClick={() => doImport.mutate(undefined)} loading={doImport.isPending} disabled={preview.problems.length > 0}>Import for review</Button>
                <p className="text-xs text-muted">Nothing is recorded until you review the matches.</p>
              </div>
            </div>
          )}
        </Panel>
      )}
      <Panel title="Imported statements" flush>
        <DataTable<StatementImportRow>
          data={imports.data}
          loading={imports.isLoading}
          error={imports.error}
          onRowClick={(r) => setOpenId(r.id)}
          empty="No statements imported yet"
          columns={[
            { accessorKey: 'fileName', header: 'File' },
            { id: 'period', header: 'Period', cell: ({ row }) => `${date(row.original.periodFrom)} – ${date(row.original.periodTo)}` },
            { accessorKey: 'destinationName', header: 'Account', cell: ({ row }) => row.original.destinationName ?? '—' },
            { accessorKey: 'lineCount', header: 'Lines', meta: { align: 'right' } },
            { accessorKey: 'openCount', header: 'To review', meta: { align: 'right' } },
            { accessorKey: 'uploadedByName', header: 'Uploaded by' },
            { accessorKey: 'createdAt', header: 'Uploaded', cell: ({ row }) => dateTime(row.original.createdAt) },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
          ]}
        />
      </Panel>
      <ImportDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
