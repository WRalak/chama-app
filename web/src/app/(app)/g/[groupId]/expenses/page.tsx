'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ExpenseRow, LABELS, PAYMENT_METHODS, Permission, todayInNairobi } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { KeyValues, PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { date, dateTime, kes, newIdempotencyKey } from '@/lib/utils';

const CATEGORIES = ['Bank charges', 'Meeting costs', 'Stationery', 'Transport', 'Welfare support', 'Professional fees', 'Investment costs', 'Other'];

export default function ExpensesPage() {
  const groupId = useGroupId();
  const can = useCan();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState({ category: CATEGORIES[0], description: '', amountCents: undefined as number | undefined, incurredOn: todayInNairobi(), payee: '' });
  const [comment, setComment] = useState('');
  const [payForm, setPayForm] = useState({ method: 'MPESA', reference: '', paidAt: todayInNairobi(), key: newIdempotencyKey() });
  const expenses = useQuery({ queryKey: ['expenses', groupId], queryFn: () => api<ExpenseRow[]>(`groups/${groupId}/expenses`) });
  const inv = [['expenses', groupId], ['overview', groupId]];
  const create = useAction(() => api(`groups/${groupId}/expenses`, { body: { ...form, payee: form.payee || undefined } }), { success: 'Expense recorded and sent for approval', invalidate: inv, onSuccess: () => setOpen(false) });
  const decide = useAction((decision: 'APPROVE' | 'REJECT') => api(`groups/${groupId}/expenses/${sel!.id}/decision`, { body: { decision, comment: comment || undefined } }), { success: 'Decision recorded', invalidate: inv, onSuccess: () => setSel(null) });
  const pay = useAction(() => api(`groups/${groupId}/expenses/${sel!.id}/pay`, { body: { method: payForm.method, reference: payForm.reference || undefined, paidAt: payForm.paidAt, idempotencyKey: payForm.key } }), { success: 'Expense paid and posted to the cashbook', invalidate: inv, onSuccess: () => setSel(null) });
  const reverse = useAction(() => api(`groups/${groupId}/expenses/${sel!.id}/reverse`, { body: { reason: comment } }), { success: 'Expense reversed', invalidate: inv, onSuccess: () => setSel(null) });
  const rows = (expenses.data ?? []).filter((e) => !status || e.status === status);

  return (
    <>
      <PageHeader title="Expenses" description="Expenses need approval by an officer other than the one who recorded them before they are paid." actions={can(Permission.EXPENSES_RECORD) && <Button onClick={() => setOpen(true)}>Record expense</Button>} />
      <Panel flush>
        <Toolbar>
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All expenses</option>
            <option value="PENDING_APPROVAL">Awaiting approval</option>
            <option value="APPROVED">Approved, unpaid</option>
            <option value="PAID">Paid</option>
            <option value="REJECTED">Rejected</option>
            <option value="REVERSED">Reversed</option>
          </Select>
        </Toolbar>
        <DataTable<ExpenseRow>
          data={rows}
          loading={expenses.isLoading}
          error={expenses.error}
          onRowClick={(e) => { setSel(e); setComment(''); setPayForm({ method: 'MPESA', reference: '', paidAt: todayInNairobi(), key: newIdempotencyKey() }); }}
          empty="No expenses"
          columns={[
            { accessorKey: 'incurredOn', header: 'Date', cell: ({ row }) => date(row.original.incurredOn) },
            { accessorKey: 'category', header: 'Category' },
            { accessorKey: 'description', header: 'Description' },
            { accessorKey: 'payee', header: 'Payee', cell: ({ row }) => row.original.payee ?? '—' },
            { accessorKey: 'amountCents', header: 'Amount', cell: ({ row }) => kes(row.original.amountCents), meta: { align: 'right' } },
            { id: 'ap', header: 'Approvals', cell: ({ row }) => `${row.original.approvals.filter((a) => a.decision === 'APPROVED').length}/${row.original.approvalsRequired}` },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
          ]}
        />
      </Panel>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Record expense">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" htmlFor="e-c"><Select id="e-c" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Amount" htmlFor="e-a"><MoneyInput id="e-a" value={form.amountCents} onChange={(v) => setForm({ ...form, amountCents: v })} /></Field>
              <Field label="Date incurred" htmlFor="e-d"><Input id="e-d" type="date" max={todayInNairobi()} value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} /></Field>
              <Field label="Payee" htmlFor="e-p"><Input id="e-p" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></Field>
            </div>
            <Field label="Description" htmlFor="e-desc"><Textarea id="e-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate(undefined)} loading={create.isPending} disabled={!form.amountCents || form.description.length < 3}>Submit for approval</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={sel ? `${kes(sel.amountCents)} · ${sel.category}` : ''} subtitle={sel && <StatusBadge status={sel.status} />}>
        {sel && (
          <div className="space-y-5">
            <KeyValues items={[['Description', sel.description], ['Payee', sel.payee ?? '—'], ['Incurred', date(sel.incurredOn)], ['Recorded by', sel.recordedByName], ['Paid', sel.paidAt ? `${date(sel.paidAt)} · ${sel.paymentReference ?? ''}` : '—']]} />
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Approvals ({sel.approvals.filter((a) => a.decision === 'APPROVED').length}/{sel.approvalsRequired})</h3>
              {sel.approvals.length === 0 ? <p className="text-sm text-muted">No decisions yet.</p> : (
                <ul className="space-y-1 text-sm">{sel.approvals.map((a) => <li key={a.id}><StatusBadge status={a.decision} /> {a.approverName} ({LABELS.groupRole[a.approverRole]}) · {dateTime(a.createdAt)}{a.comment && <span className="text-muted"> — {a.comment}</span>}</li>)}</ul>
              )}
            </div>
            {sel.canApprove && (
              <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
                <Field label="Comment (optional)" htmlFor="e-com"><Textarea id="e-com" rows={2} className="min-h-0 bg-white" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <div className="flex gap-2"><Button onClick={() => decide.mutate('APPROVE')} loading={decide.isPending}>Approve</Button><Button variant="danger" onClick={() => decide.mutate('REJECT')} loading={decide.isPending}>Reject</Button></div>
              </div>
            )}
            {sel.status === 'APPROVED' && can(Permission.EXPENSES_RECORD) && (
              <div className="space-y-3 rounded-md border border-line p-3">
                <h3 className="text-sm font-semibold">Record payment of this expense</h3>
                <div className="grid grid-cols-3 gap-2">
                  <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} aria-label="Method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{LABELS.paymentMethod[m]}</option>)}</Select>
                  <Input placeholder="Reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} aria-label="Reference" />
                  <Input type="date" max={todayInNairobi()} value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} aria-label="Paid on" />
                </div>
                <Button onClick={() => pay.mutate(undefined)} loading={pay.isPending}>Mark as paid</Button>
              </div>
            )}
            {sel.status === 'PAID' && can(Permission.LEDGER_ADJUST) && (
              <div className="space-y-2 rounded-md border border-line p-3">
                <Field label="Reverse with reason" htmlFor="e-rev"><Textarea id="e-rev" rows={2} className="min-h-0" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <Button variant="danger" onClick={() => reverse.mutate(undefined)} loading={reverse.isPending} disabled={comment.trim().length < 5}>Reverse expense</Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
