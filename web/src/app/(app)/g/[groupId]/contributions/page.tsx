'use client';

import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ContributionLedgerRow, FREQUENCIES, LABELS, Paginated, PaymentItem, Permission, ScheduleRow, todayInNairobi, TRANSACTION_STATUSES } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { MemberSelect } from '@/components/domain/member-select';
import { PaymentDrawer } from '@/components/domain/payment-drawer';
import { RecordPaymentDialog } from '@/components/domain/record-payment';
import { api, fileUrl } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, kes } from '@/lib/utils';

function LedgerTab() {
  const groupId = useGroupId();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ from: '', to: '', memberId: '', status: '' });
  const query = { page, pageSize: 50, from: filters.from || undefined, to: filters.to || undefined, memberId: filters.memberId || undefined, status: filters.status || undefined };
  const ledger = useQuery({ queryKey: ['ledger', groupId, query], queryFn: () => api<Paginated<ContributionLedgerRow>>(`groups/${groupId}/contributions/ledger`, { query }), placeholderData: (p) => p });
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const columns: ColumnDef<ContributionLedgerRow, unknown>[] = [
    { accessorKey: 'dueDate', header: 'Date', cell: ({ row }) => date(row.original.dueDate), enableSorting: false },
    { accessorKey: 'memberName', header: 'Member', enableSorting: false },
    { accessorKey: 'period', header: 'Period', enableSorting: false },
    { accessorKey: 'expectedCents', header: 'Expected', cell: ({ row }) => kes(row.original.expectedCents), meta: { align: 'right' }, enableSorting: false },
    { accessorKey: 'receivedCents', header: 'Received', cell: ({ row }) => kes(row.original.receivedCents), meta: { align: 'right' }, enableSorting: false },
    { accessorKey: 'outstandingCents', header: 'Outstanding', cell: ({ row }) => <span className={row.original.outstandingCents ? 'text-danger' : ''}>{kes(row.original.outstandingCents)}</span>, meta: { align: 'right' }, enableSorting: false },
    { id: 'method', header: 'Method', cell: ({ row }) => [...new Set(row.original.payments.map((p) => LABELS.paymentMethod[p.method]))].join(', ') || '—', enableSorting: false },
    { id: 'ref', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.payments.map((p) => p.reference).filter(Boolean).join(', ') || '—'}</span>, enableSorting: false },
    { accessorKey: 'status', header: 'Verification', cell: ({ row }) => (row.original.pendingCents ? <span className="flex items-center gap-1"><StatusBadge status={row.original.status} /><StatusBadge status="PENDING" /></span> : <StatusBadge status={row.original.status} />), enableSorting: false },
    { id: 'by', header: 'Recorded by', cell: ({ row }) => [...new Set(row.original.payments.map((p) => p.recordedByName).filter(Boolean))].join(', ') || '—', enableSorting: false },
  ];
  return (
    <Panel flush>
      <Toolbar>
        <Field label="From" htmlFor="f-from"><Input id="f-from" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="To" htmlFor="f-to"><Input id="f-to" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} /></Field>
        <Field label="Member" htmlFor="f-member" className="w-52"><MemberSelect id="f-member" value={filters.memberId} onChange={(v) => set('memberId', v)} placeholder="All members" /></Field>
        <Field label="Status" htmlFor="f-status">
          <Select id="f-status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All</option>
            <option value="OUTSTANDING">Outstanding</option>
            <option value="OVERDUE">Overdue</option>
            <option value="PARTIAL">Partial</option>
            <option value="PAID">Paid</option>
            <option value="WAIVED">Waived</option>
          </Select>
        </Field>
        <div className="flex-1" />
        <Button variant="secondary" asChild>
          <a href={fileUrl(`groups/${groupId}/contributions/ledger.csv`, { ...query, page: undefined, pageSize: undefined })}>Export CSV</a>
        </Button>
      </Toolbar>
      <DataTable columns={columns} data={ledger.data?.items} loading={ledger.isLoading} error={ledger.error} onRetry={ledger.refetch} server={ledger.data ? { page, pageSize: 50, total: ledger.data.total, onPageChange: setPage } : undefined} empty="No contributions in this range" />
    </Panel>
  );
}

function PaymentsTab() {
  const groupId = useGroupId();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('tab') === 'payments' ? 'PENDING' : '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PaymentItem | null>(null);
  const query = { status: status || undefined, q: q || undefined, page, pageSize: 50 };
  const payments = useQuery({ queryKey: ['payments', groupId, query], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query }), placeholderData: (p) => p });
  return (
    <Panel flush>
      <Toolbar>
        <Input className="max-w-xs" placeholder="Search reference or member" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search payments" />
        <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          {TRANSACTION_STATUSES.filter((s) => s !== 'SCHEDULED').map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </Select>
      </Toolbar>
      <DataTable<PaymentItem>
        data={payments.data?.items}
        loading={payments.isLoading}
        error={payments.error}
        onRowClick={setSelected}
        server={payments.data ? { page, pageSize: 50, total: payments.data.total, onPageChange: setPage } : undefined}
        empty={status === 'PENDING' ? 'Nothing waiting for verification' : 'No payments'}
        columns={[
          { accessorKey: 'paidAt', header: 'Date', cell: ({ row }) => date(row.original.paidAt), enableSorting: false },
          { accessorKey: 'memberName', header: 'Member', enableSorting: false },
          { accessorKey: 'purpose', header: 'Purpose', cell: ({ row }) => row.original.purpose.replace('_', ' ').toLowerCase(), enableSorting: false },
          { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' }, enableSorting: false },
          { accessorKey: 'method', header: 'Method', cell: ({ row }) => LABELS.paymentMethod[row.original.method], enableSorting: false },
          { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span>, enableSorting: false },
          { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, enableSorting: false },
          { accessorKey: 'recordedByName', header: 'Recorded by', cell: ({ row }) => row.original.recordedByName ?? '—', enableSorting: false },
        ]}
      />
      <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
    </Panel>
  );
}

function SchedulesTab() {
  const groupId = useGroupId();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', amountCents: undefined as number | undefined, frequency: 'MONTHLY', startDate: todayInNairobi(), endDate: '' });
  const schedules = useQuery({ queryKey: ['schedules', groupId], queryFn: () => api<ScheduleRow[]>(`groups/${groupId}/schedules`) });
  const create = useAction(() => api(`groups/${groupId}/schedules`, { body: { ...form, endDate: form.endDate || undefined } }), { success: 'Schedule created. Obligations were generated for active members.', invalidate: [['schedules', groupId], ['ledger', groupId]], onSuccess: () => setOpen(false) });
  const deactivate = useAction((id: string) => api(`groups/${groupId}/schedules/${id}/deactivate`, { method: 'POST' }), { success: 'Schedule ended', invalidate: [['schedules', groupId]] });
  const valid = form.name.length >= 2 && !!form.amountCents && form.amountCents > 0 && Number.isInteger(form.amountCents);
  return (
    <Panel flush title="Contribution schedules" actions={can(Permission.SCHEDULES_MANAGE) && <Button size="sm" onClick={() => setOpen(true)}>New schedule</Button>}>
      <DataTable<ScheduleRow>
        data={schedules.data}
        loading={schedules.isLoading}
        error={schedules.error}
        empty="No contribution schedules yet"
        emptyDescription="Create one to start tracking what each member owes."
        columns={[
          { accessorKey: 'name', header: 'Name' },
          { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' } },
          { accessorKey: 'frequency', header: 'Frequency', cell: ({ row }) => LABELS.frequency[row.original.frequency] },
          { accessorKey: 'startDate', header: 'Starts', cell: ({ row }) => date(row.original.startDate) },
          { accessorKey: 'endDate', header: 'Ends', cell: ({ row }) => date(row.original.endDate) },
          { accessorKey: 'memberCount', header: 'Members', meta: { align: 'right' } },
          { accessorKey: 'active', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.active ? 'ACTIVE' : 'CANCELLED'} /> },
          { id: 'a', header: '', cell: ({ row }) => (row.original.active && can(Permission.SCHEDULES_MANAGE) ? <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(row.original.id)}>End</Button> : null) },
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New contribution schedule" description="Obligations are created for each active member from the start date (never before they joined).">
          <div className="space-y-3">
            <Field label="Name" htmlFor="s-name"><Input id="s-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Monthly shares" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount per member" htmlFor="s-amt"><MoneyInput id="s-amt" value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} /></Field>
              <Field label="Frequency" htmlFor="s-freq">
                <Select id="s-freq" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{LABELS.frequency[f]}</option>)}
                </Select>
              </Field>
              <Field label="First due date" htmlFor="s-start"><Input id="s-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="End date (optional)" htmlFor="s-end"><Input id="s-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={!valid}>Create schedule</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function ContributionsInner() {
  const can = useCan();
  const params = useSearchParams();
  const [record, setRecord] = useState(false);
  return (
    <>
      <PageHeader title="Contributions" description="Every expected contribution, what was received, and how it was verified." actions={can(Permission.CONTRIBUTIONS_RECORD) && <Button onClick={() => setRecord(true)}>Record payment</Button>} />
      <Tabs defaultValue={params.get('tab') ?? 'ledger'}>
        <TabsList tabs={[{ value: 'ledger', label: 'Contributions ledger' }, { value: 'payments', label: 'Payments & verification' }, { value: 'schedules', label: 'Schedules' }]} />
        <TabsContent value="ledger"><LedgerTab /></TabsContent>
        <TabsContent value="payments"><PaymentsTab /></TabsContent>
        <TabsContent value="schedules"><SchedulesTab /></TabsContent>
      </Tabs>
      <RecordPaymentDialog open={record} onOpenChange={setRecord} />
    </>
  );
}

export default function ContributionsPage() {
  return (
    <Suspense>
      <ContributionsInner />
    </Suspense>
  );
}
