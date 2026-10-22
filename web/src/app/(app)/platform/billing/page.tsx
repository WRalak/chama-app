'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { BILLING_STATUS_LABELS, type BillingPaymentRow, type BillingPaymentStatus, type Paginated, PlatformPermission, SUBSCRIPTION_STATUS_LABELS, type SubscriptionStatusCode } from '@chamahub/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/session';
import { date, dateTime, money } from '@/lib/utils';

const PAY_TONE: Record<BillingPaymentStatus, Tone> = { PENDING: 'amber', SUCCEEDED: 'green', FAILED: 'red', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'amber', DISPUTED: 'red' };
const SUB_TONE: Record<SubscriptionStatusCode, Tone> = { TRIALING: 'blue', ACTIVE: 'green', PAST_DUE: 'amber', EXPIRED: 'neutral', CANCELLED: 'neutral' };

interface GroupRow { id: string; name: string; countryCode: string; currency: string; members: number; createdAt: string; subscription: { planName: string; status: SubscriptionStatusCode; currentPeriodEnd: string | null; trialEndsAt: string | null } | null; access: { planName: string; source: string; until: string | null } }
type PaymentRow = BillingPaymentRow & { group: { id: string; name: string; countryCode: string } };
interface CaseRow { id: string; groupId: string | null; groupName: string | null; paymentId: string | null; subject: string; details: string; status: 'OPEN' | 'WAITING' | 'RESOLVED'; priority: 'LOW' | 'NORMAL' | 'HIGH'; createdBy: string; assignedTo: string | null; resolution: string | null; createdAt: string }
interface EventRow { id: string; provider: string; providerEventId: string; type: string; reference: string | null; livemode: boolean; signatureValid: boolean; result: string | null; receivedAt: string }

/** Subscriptions and billing payments across all groups. No group finances are shown here. */
export default function PlatformBillingPage() {
  return (
    <>
      <PageHeader title="Billing & subscriptions" description="Plans, subscription status and ChamaHub fee payments. Group contributions, loans and ledgers are never shown here." />
      <Tabs defaultValue="groups">
        <TabsList tabs={[{ value: 'groups', label: 'Groups' }, { value: 'payments', label: 'Payments' }, { value: 'cases', label: 'Billing cases' }, { value: 'events', label: 'Provider events' }]} />
        <TabsContent value="groups"><Groups /></TabsContent>
        <TabsContent value="payments"><Payments /></TabsContent>
        <TabsContent value="cases"><Cases /></TabsContent>
        <TabsContent value="events"><Events /></TabsContent>
      </Tabs>
    </>
  );
}

function Groups() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const groups = useQuery({ queryKey: ['billing-groups', q, page], queryFn: () => api<Paginated<GroupRow>>('platform/billing/groups', { query: { q: q || undefined, page, pageSize: 25 } }), placeholderData: (p) => p });
  return (
    <Panel flush>
      <Toolbar><Input className="max-w-xs" placeholder="Search by name or id" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search groups" /></Toolbar>
      <DataTable<GroupRow>
        data={groups.data?.items}
        loading={groups.isLoading}
        error={groups.error}
        server={groups.data ? { page, pageSize: 25, total: groups.data.total, onPageChange: setPage } : undefined}
        columns={[
          { accessorKey: 'name', header: 'Group', enableSorting: false, cell: ({ row }) => <Link href={`/platform/billing/${row.original.id}`} className="font-medium text-berry hover:underline">{row.original.name}</Link> },
          { accessorKey: 'countryCode', header: 'Country', enableSorting: false, cell: ({ row }) => `${row.original.countryCode} · ${row.original.currency}` },
          { accessorKey: 'members', header: 'Members', enableSorting: false },
          { id: 'access', header: 'Access now', cell: ({ row }) => <span>{row.original.access.planName}<span className="block text-xs text-muted">{row.original.access.source.toLowerCase()}{row.original.access.until ? ` until ${date(row.original.access.until)}` : ''}</span></span> },
          { id: 'sub', header: 'Subscription', cell: ({ row }) => (row.original.subscription ? <Badge tone={SUB_TONE[row.original.subscription.status]}>{`${row.original.subscription.planName} · ${SUBSCRIPTION_STATUS_LABELS[row.original.subscription.status]}`}</Badge> : <span className="text-muted">None</span>) },
        ]}
      />
    </Panel>
  );
}

function Payments() {
  const can = usePlatformCan();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [confirming, setConfirming] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const [bankRef, setBankRef] = useState('');
  const key = ['billing-payments', q, status, mode, page];
  const payments = useQuery({ queryKey: key, queryFn: () => api<Paginated<PaymentRow>>('platform/billing/payments', { query: { q: q || undefined, status: status || undefined, livemode: mode || undefined, page, pageSize: 25 } }), placeholderData: (p) => p });
  const refund = useAction(() => api(`platform/billing/payments/${refunding!.id}/refund`, { body: { amountMinor: amount, reason } }), { success: 'Refund recorded', invalidate: [['billing-payments']], onSuccess: () => { setRefunding(null); setReason(''); } });
  const reconcile = useAction((id: string) => api<BillingPaymentRow>(`platform/billing/payments/${id}/reconcile`, { method: 'POST' }), { success: (r) => `Provider says: ${BILLING_STATUS_LABELS[r.status]}`, invalidate: [['billing-payments']] });
  const confirm = useAction(() => api(`platform/billing/payments/${confirming!.id}/confirm-manual`, { body: { bankReference: bankRef } }), { success: 'Payment confirmed and plan activated', invalidate: [['billing-payments']], onSuccess: () => { setConfirming(null); setBankRef(''); } });
  return (
    <Panel flush>
      <Toolbar>
        <Input className="max-w-[14rem]" placeholder="Reference or receipt" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search payments" />
        <Select className="max-w-[12rem]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">Any status</option>{Object.entries(BILLING_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select className="max-w-[10rem]" value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }} aria-label="Mode"><option value="">Live and test</option><option value="live">Live</option><option value="test">Test</option></Select>
      </Toolbar>
      <DataTable<PaymentRow>
        data={payments.data?.items}
        loading={payments.isLoading}
        error={payments.error}
        server={payments.data ? { page, pageSize: 25, total: payments.data.total, onPageChange: setPage } : undefined}
        columns={[
          { id: 'when', header: 'Date', cell: ({ row }) => dateTime(row.original.paidAt ?? row.original.createdAt) },
          { accessorKey: 'reference', header: 'Reference', enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}{row.original.receiptNumber && <span className="block text-muted">{row.original.receiptNumber}</span>}</span> },
          { id: 'group', header: 'Group', cell: ({ row }) => <Link className="text-berry hover:underline" href={`/platform/billing/${row.original.group.id}`}>{row.original.group.name}</Link> },
          { id: 'plan', header: 'Plan', cell: ({ row }) => `${row.original.planName} · ${row.original.interval === 'YEAR' ? 'annual' : 'monthly'}` },
          { id: 'provider', header: 'Provider', cell: ({ row }) => <span>{row.original.provider}{!row.original.livemode && <Badge tone="amber" icon={false} className="ml-1">test</Badge>}</span> },
          { accessorKey: 'amountMinor', header: 'Amount', meta: { align: 'right' }, cell: ({ row }) => <span>{money(row.original.amountMinor, row.original.currency)}{row.original.refundedMinor > 0 && <span className="block text-xs text-muted">refunded {money(row.original.refundedMinor, row.original.currency)}</span>}</span> },
          { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge tone={PAY_TONE[row.original.status]}>{BILLING_STATUS_LABELS[row.original.status]}</Badge> },
          {
            id: 'actions',
            header: '',
            cell: ({ row }) => {
              const p = row.original;
              return (
                <span className="flex flex-wrap justify-end gap-1">
                  {p.status === 'PENDING' && p.provider !== 'MANUAL' && can(PlatformPermission.PLATFORM_MANAGE_BILLING) && <Button size="sm" variant="ghost" onClick={() => reconcile.mutate(p.id)}>Check status</Button>}
                  {p.status === 'PENDING' && p.provider === 'MANUAL' && can(PlatformPermission.PLATFORM_MANAGE_FINANCE) && <Button size="sm" variant="secondary" onClick={() => setConfirming(p)}>Confirm received</Button>}
                  {['SUCCEEDED', 'PARTIALLY_REFUNDED', 'DISPUTED'].includes(p.status) && p.amountMinor > 0 && can(PlatformPermission.PLATFORM_REFUND) && <Button size="sm" variant="ghost" onClick={() => { setRefunding(p); setAmount(p.amountMinor - p.refundedMinor); }}>Refund…</Button>}
                </span>
              );
            },
          },
        ]}
      />
      <Dialog open={!!refunding} onOpenChange={(o) => !o && setRefunding(null)}>
        {refunding && (
          <DialogContent title={`Refund ${refunding.reference}`} description={`Paid ${money(refunding.amountMinor, refunding.currency)}${refunding.refundedMinor ? `, already refunded ${money(refunding.refundedMinor, refunding.currency)}` : ''}. A full refund ends the period this payment bought.`}>
            <div className="space-y-3">
              <Field label={`Amount (${refunding.currency})`} htmlFor="rf-a"><MoneyInput id="rf-a" value={amount} onChange={setAmount} /></Field>
              <Field label="Reason (recorded in the audit log)" htmlFor="rf-r"><Textarea id="rf-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              {refunding.provider === 'MPESA_DARAJA' && <p className="text-xs text-pending-ink">M-Pesa refunds are not available through ChamaHub. Refund the payer from the M-Pesa portal first.</p>}
              <Button variant="danger" onClick={() => refund.mutate(undefined)} loading={refund.isPending} disabled={!amount || amount > refunding.amountMinor - refunding.refundedMinor || reason.trim().length < 5}>Refund {amount ? money(amount, refunding.currency) : ''}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        {confirming && (
          <DialogContent title={`Confirm bank payment ${confirming.reference}`} description={`Only after ${money(confirming.amountMinor, confirming.currency)} with reference ${confirming.reference} is on ChamaHub's bank statement. This activates the plan and is recorded in your name.`}>
            <div className="space-y-3">
              <Field label="Bank transaction reference" htmlFor="cm-ref"><Input id="cm-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} /></Field>
              <Button onClick={() => confirm.mutate(undefined)} loading={confirm.isPending} disabled={bankRef.trim().length < 4}>Confirm received</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}

function Cases() {
  const can = usePlatformCan();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<CaseRow | null>(null);
  const [resolution, setResolution] = useState('');
  const cases = useQuery({ queryKey: ['billing-cases', status], queryFn: () => api<CaseRow[]>('platform/billing/cases', { query: { status: status || undefined } }) });
  const update = useAction((v: { status: CaseRow['status'] }) => api(`platform/billing/cases/${editing!.id}`, { method: 'PATCH', body: { status: v.status, resolution: resolution || undefined, assignToMe: true } }), { success: 'Case updated', invalidate: [['billing-cases']], onSuccess: () => setEditing(null) });
  return (
    <Panel flush>
      <Toolbar><Select className="max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Open and waiting</option><option value="OPEN">Open</option><option value="WAITING">Waiting</option><option value="RESOLVED">Resolved</option></Select></Toolbar>
      <DataTable<CaseRow>
        data={cases.data}
        loading={cases.isLoading}
        error={cases.error}
        empty="No billing cases"
        onRowClick={can(PlatformPermission.PLATFORM_MANAGE_BILLING) ? (c) => { setEditing(c); setResolution(c.resolution ?? ''); } : undefined}
        columns={[
          { accessorKey: 'createdAt', header: 'Opened', cell: ({ row }) => dateTime(row.original.createdAt) },
          { accessorKey: 'priority', header: 'Priority', cell: ({ row }) => <Badge tone={row.original.priority === 'HIGH' ? 'red' : row.original.priority === 'NORMAL' ? 'amber' : 'neutral'}>{row.original.priority.toLowerCase()}</Badge> },
          { accessorKey: 'subject', header: 'Subject', cell: ({ row }) => <span>{row.original.subject}<span className="block text-xs text-muted">{row.original.groupName ?? ''}</span></span> },
          { accessorKey: 'status', header: 'Status', cell: ({ row }) => row.original.status.toLowerCase() },
          { accessorKey: 'assignedTo', header: 'Owner', cell: ({ row }) => row.original.assignedTo ?? '—' },
        ]}
      />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing.subject} description={editing.groupName ?? undefined}>
            <p className="whitespace-pre-wrap text-sm text-plum">{editing.details}</p>
            <Field label="Resolution / notes" htmlFor="cs-res" className="mt-3"><Textarea id="cs-res" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => update.mutate({ status: 'WAITING' })}>Waiting on customer</Button>
              <Button onClick={() => update.mutate({ status: 'RESOLVED' })} disabled={!resolution.trim()} loading={update.isPending}>Resolve</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Panel>
  );
}

function Events() {
  const events = useQuery({ queryKey: ['billing-events'], queryFn: () => api<EventRow[]>('platform/billing/events') });
  return (
    <Panel flush>
      <DataTable<EventRow>
        data={events.data}
        loading={events.isLoading}
        error={events.error}
        empty="No provider events yet"
        columns={[
          { accessorKey: 'receivedAt', header: 'Received', cell: ({ row }) => dateTime(row.original.receivedAt) },
          { accessorKey: 'provider', header: 'Provider' },
          { accessorKey: 'type', header: 'Event', cell: ({ row }) => <span className="font-mono text-xs">{row.original.type}</span> },
          { accessorKey: 'reference', header: 'Payment', cell: ({ row }) => row.original.reference ?? '—' },
          { id: 'auth', header: 'Authenticated', cell: ({ row }) => (row.original.signatureValid ? <Badge tone="green">Yes</Badge> : <Badge tone="red">Rejected</Badge>) },
          { accessorKey: 'result', header: 'Result', cell: ({ row }) => <span className="font-mono text-xs">{row.original.result ?? 'pending'}</span> },
        ]}
      />
    </Panel>
  );
}
