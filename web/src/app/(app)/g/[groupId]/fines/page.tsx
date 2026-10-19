'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FineRow, Permission, todayInNairobi } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel, StatStrip, Toolbar } from '@/components/ui/layout-parts';
import { MemberSelect } from '@/components/domain/member-select';
import { RecordPaymentDialog } from '@/components/domain/record-payment';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, kes } from '@/lib/utils';

export default function FinesPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [status, setStatus] = useState('');
  const [issue, setIssue] = useState(false);
  const [pay, setPay] = useState<FineRow | null>(null);
  const [waive, setWaive] = useState<FineRow | null>(null);
  const [form, setForm] = useState({ memberId: '', amountCents: undefined as number | undefined, reason: '', issuedOn: todayInNairobi() });
  const [waiveReason, setWaiveReason] = useState('');
  const fines = useQuery({ queryKey: ['fines', groupId], queryFn: () => api<FineRow[]>(`groups/${groupId}/fines`) });
  const create = useAction(() => api(`groups/${groupId}/fines`, { body: form }), { success: 'Fine issued and the member notified', invalidate: [['fines', groupId]], onSuccess: () => setIssue(false) });
  const doWaive = useAction(() => api(`groups/${groupId}/fines/${waive!.id}/waive`, { body: { reason: waiveReason } }), { success: 'Fine waived', invalidate: [['fines', groupId]], onSuccess: () => setWaive(null) });
  const rows = (fines.data ?? []).filter((f) => !status || f.status === status);
  const outstanding = (fines.data ?? []).filter((f) => ['OUTSTANDING', 'PARTIAL'].includes(f.status));
  return (
    <>
      <PageHeader title="Fines" description="Penalties issued under the group constitution. Waivers need a recorded reason." actions={can(Permission.FINES_MANAGE) && <Button onClick={() => setIssue(true)}>Issue fine</Button>} />
      <StatStrip stats={[{ label: 'Outstanding fines', value: outstanding.length }, { label: 'Amount due', value: kes(outstanding.reduce((a, f) => a + f.amountCents - f.paidCents, 0)), tone: outstanding.length ? 'warning' : 'default' }, { label: 'Collected', value: kes((fines.data ?? []).reduce((a, f) => a + f.paidCents, 0)) }]} />
      <Panel flush>
        <Toolbar>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All fines</option>
            <option value="OUTSTANDING">Outstanding</option>
            <option value="PARTIAL">Partly paid</option>
            <option value="PAID">Paid</option>
            <option value="WAIVED">Waived</option>
          </Select>
        </Toolbar>
        <DataTable<FineRow>
          data={rows}
          loading={fines.isLoading}
          error={fines.error}
          empty="No fines"
          columns={[
            { accessorKey: 'issuedOn', header: 'Date', cell: ({ row }) => date(row.original.issuedOn) },
            { accessorKey: 'memberName', header: 'Member' },
            { accessorKey: 'reason', header: 'Reason', cell: ({ row }) => <div>{row.original.reason}{row.original.waivedReason && <p className="text-xs text-muted">Waived: {row.original.waivedReason}</p>}</div> },
            { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' } },
            { accessorKey: 'paidCents', header: 'Paid', cell: ({ row }) => kes(row.original.paidCents), meta: { align: 'right' } },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            { accessorKey: 'issuedByName', header: 'Issued by' },
            { id: 'a', header: '', cell: ({ row }) => (can(Permission.FINES_MANAGE) && ['OUTSTANDING', 'PARTIAL'].includes(row.original.status) ? <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setPay(row.original)}>Record payment</Button>{row.original.status === 'OUTSTANDING' && <Button size="sm" variant="ghost" onClick={() => { setWaive(row.original); setWaiveReason(''); }}>Waive</Button>}</div> : null) },
          ]}
        />
      </Panel>
      <Dialog open={issue} onOpenChange={setIssue}>
        <DialogContent title="Issue a fine">
          <div className="space-y-3">
            <Field label="Member" htmlFor="fi-m"><MemberSelect id="fi-m" value={form.memberId} onChange={(v) => setForm({ ...form, memberId: v })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" htmlFor="fi-a"><MoneyInput id="fi-a" value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} /></Field>
              <Field label="Date" htmlFor="fi-d"><Input id="fi-d" type="date" max={todayInNairobi()} value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></Field>
            </div>
            <Field label="Reason" htmlFor="fi-r"><Input id="fi-r" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Late for meeting" /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setIssue(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={!form.memberId || !form.amountCents || form.reason.length < 3}>Issue fine</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!waive} onOpenChange={(o) => !o && setWaive(null)}>
        <DialogContent title="Waive fine" description={waive ? `${waive.memberName} · ${kes(waive.amountCents)} · ${waive.reason}` : undefined}>
          <div className="space-y-3">
            <Field label="Reason for waiver" htmlFor="w-r" hint="Recorded in the audit log."><Textarea id="w-r" rows={2} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setWaive(null)}>Cancel</Button><Button onClick={() => doWaive.mutate(undefined)} loading={doWaive.isPending} disabled={waiveReason.trim().length < 5}>Waive fine</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <RecordPaymentDialog open={!!pay} onOpenChange={(o) => !o && setPay(null)} purpose="FINE" memberId={pay?.membershipId} targetId={pay?.id} />
    </>
  );
}
