'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { DESTINATION_LABELS, EVIDENCE_MIME_TYPES, LABELS, todayInNairobi, type IntegrationStatus, type ObligationItem, type Paginated, type PaymentDestinationRow, type PaymentItem } from '@chamahub/shared';
import { PaymentDrawer } from '@/components/domain/payment-drawer';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { MoneyCard, PageHeader, Panel } from '@/components/ui/layout-parts';
import { MoneyInput } from '@/components/ui/money-input';
import { api } from '@/lib/api';
import { readEvidence } from '@/lib/files';
import { useAction } from '@/lib/hooks';
import { useGroup, useGroupId, useMe } from '@/lib/session';
import { date, kes, newIdempotencyKey } from '@/lib/utils';

const PURPOSE: Record<string, string> = { CONTRIBUTION: 'Contribution', LOAN_REPAYMENT: 'Loan repayment', FINE: 'Fine' };

/** The signed-in member's own contributions and payments in this Chama. */
export default function MyContributionsPage() {
  const groupId = useGroupId();
  const group = useGroup();
  const myId = group.data?.myMembership.membershipId;
  const obligations = useQuery({ queryKey: ['my-obligations', groupId], queryFn: () => api<ObligationItem[]>('me/obligations', { query: { groupId, from: '2000-01-01' } }) });
  const payments = useQuery({ queryKey: ['my-payments', groupId], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { pageSize: 100, memberId: myId } }), enabled: !!myId });
  const mine = useMemo(() => (payments.data?.items ?? []).filter((p) => p.membershipId === myId), [payments.data, myId]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PaymentItem | null>(null);
  const o = obligations.data ?? [];
  const t = todayInNairobi();
  const outstanding = o.reduce((s, x) => s + (x.dueDate <= t ? x.outstandingCents : 0), 0);
  const pending = mine.filter((p) => p.status === 'PENDING');
  const confirmed = mine.filter((p) => p.status === 'CONFIRMED' && p.purpose === 'CONTRIBUTION').reduce((s, p) => s + p.amountCents, 0);

  const obligationCols: ColumnDef<ObligationItem, unknown>[] = [
    { header: 'Period', accessorKey: 'periodLabel', cell: ({ row }) => <span className="font-medium">{row.original.periodLabel}<span className="block text-xs text-muted">{row.original.scheduleName}</span></span> },
    { header: 'Due', accessorKey: 'dueDate', cell: ({ row }) => date(row.original.dueDate) },
    { header: 'Amount', accessorKey: 'amountCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.amountCents) },
    { header: 'Paid', accessorKey: 'paidCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.paidCents) },
    { header: 'Awaiting verification', accessorKey: 'pendingCents', meta: { align: 'right' }, cell: ({ row }) => (row.original.pendingCents ? <span className="text-pending-ink">{kes(row.original.pendingCents)}</span> : '—') },
    { header: 'Owed', accessorKey: 'outstandingCents', meta: { align: 'right' }, cell: ({ row }) => <strong>{kes(row.original.outstandingCents)}</strong> },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];
  const paymentCols: ColumnDef<PaymentItem, unknown>[] = [
    { header: 'Date', accessorKey: 'paidAt', cell: ({ row }) => date(row.original.paidAt) },
    { header: 'For', accessorKey: 'purpose', cell: ({ row }) => PURPOSE[row.original.purpose] ?? row.original.purpose },
    { header: 'Method', accessorKey: 'method', cell: ({ row }) => LABELS.paymentMethod[row.original.method] },
    { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span> },
    { header: 'Amount', accessorKey: 'amountCents', meta: { align: 'right' }, cell: ({ row }) => kes(row.original.amountCents) },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="My contributions"
        description={group.data ? `What you owe and have paid in ${group.data.name}. Only confirmed payments count as paid.` : undefined}
        actions={<Button onClick={() => setOpen(true)}>Pay or report a payment</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <MoneyCard label="Owed now" amount={kes(outstanding)} status={outstanding > 0 ? <Badge tone="amber">Due</Badge> : <Badge tone="green">Up to date</Badge>} hint="Due today or earlier, after confirmed payments" />
        <MoneyCard label="Awaiting verification" amount={kes(pending.reduce((s, p) => s + p.amountCents, 0))} status={pending.length ? <Badge tone="amber">{`${pending.length} payment${pending.length === 1 ? '' : 's'}`}</Badge> : undefined} hint="Reported, not yet confirmed. Not counted as paid." />
        <MoneyCard label="Contributions confirmed" amount={kes(confirmed)} status={<Badge tone="green">Confirmed</Badge>} hint="Payments shown below" />
      </div>
      <div className="space-y-4">
        <Panel title="Contribution periods" flush>
          <DataTable columns={obligationCols} data={o.slice().sort((a, b) => b.dueDate.localeCompare(a.dueDate))} loading={obligations.isLoading} error={obligations.error} onRetry={obligations.refetch} empty="No contribution periods yet" />
        </Panel>
        <Panel title="My payments" flush>
          <DataTable columns={paymentCols} data={mine} loading={payments.isLoading || !myId} error={payments.error} onRetry={payments.refetch} onRowClick={setSelected} empty="No payments yet" emptyDescription="Payments you make or report appear here." />
        </Panel>
      </div>
      <PayDialog open={open} onOpenChange={setOpen} obligations={o} onReported={(p) => { setOpen(false); setSelected(p); }} />
      <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function PayDialog({ open, onOpenChange, obligations, onReported }: { open: boolean; onOpenChange: (o: boolean) => void; obligations: ObligationItem[]; onReported: (p: PaymentItem) => void }) {
  const groupId = useGroupId();
  const group = useGroup();
  const { data: me } = useMe();
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api<IntegrationStatus>('integrations/status'), staleTime: 5 * 60_000 });
  const destinations = useQuery({ queryKey: ['destinations', groupId], queryFn: () => api<PaymentDestinationRow[]>(`groups/${groupId}/payment-destinations`) });
  const live = (destinations.data ?? []).filter((d) => d.validNow && d.type !== 'CASH');
  const openItems = obligations.filter((o) => o.outstandingCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const [targetId, setTargetId] = useState('');
  const [cents, setCents] = useState<number | undefined>();
  const [reference, setReference] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [phone, setPhone] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const fileInput = useRef<HTMLInputElement>(null);
  const chosen = destinationId || (live.length === 1 ? live[0].id : '');
  const reset = () => { setTargetId(''); setCents(undefined); setReference(''); setFile(null); setKey(newIdempotencyKey()); };
  const inv = [['my-payments', groupId], ['my-obligations', groupId], ['me', 'dashboard']];

  const stk = useAction(() => api<{ message: string }>(`groups/${groupId}/payments/mpesa/stk`, { body: { amountCents: cents, phone: phone || me?.phone, purpose: 'CONTRIBUTION', targetId: targetId || undefined, idempotencyKey: key } }), { success: (r) => r.message, invalidate: inv, onSuccess: () => { reset(); onOpenChange(false); } });
  const report = useAction(
    async () => {
      const d = live.find((x) => x.id === chosen);
      const method = d && ['BANK_ACCOUNT', 'BANK_TRANSFER'].includes(d.type) ? 'BANK_TRANSFER' : 'MPESA';
      const evidence = file ? await readEvidence(file) : null; // checked before anything is saved
      const p = await api<PaymentItem>(`groups/${groupId}/payments`, { body: { memberId: group.data!.myMembership.membershipId, amountCents: cents, method, reference, paidAt: todayInNairobi(), purpose: 'CONTRIBUTION', targetId: targetId || undefined, destinationId: chosen || undefined, idempotencyKey: key } });
      // The report is saved first; a failed upload can be retried from the payment.
      if (evidence) await api(`groups/${groupId}/payments/${p.id}/evidence`, { body: evidence }).catch(() => undefined);
      return p;
    },
    { success: 'Reported. It shows as awaiting verification until an officer or the group’s statement confirms it.', invalidate: inv, onSuccess: (p) => { reset(); onReported(p); } },
  );
  const settings = group.data?.settings;
  const mpesa = status.data?.mpesa.configured;
  const okAmount = !!cents && cents > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Pay or report a payment" description="Choose what you are paying for. Nothing counts as paid until the money is confirmed.">
        <div className="space-y-4">
          <Field label="What are you paying for?" htmlFor="pay-target">
            <Select id="pay-target" value={targetId} onChange={(e) => { setTargetId(e.target.value); const o = openItems.find((x) => x.id === e.target.value); if (o) setCents(o.outstandingCents); }}>
              <option value="">Oldest amount owed first{openItems.length ? '' : ' (nothing owed; pays ahead)'}</option>
              {openItems.map((o) => <option key={o.id} value={o.id}>{`${o.periodLabel} · due ${date(o.dueDate)} · ${kes(o.outstandingCents)}`}</option>)}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="pay-amount"><MoneyInput id="pay-amount" value={cents} onChange={setCents} /></Field>

          {mpesa && (
            <div className="space-y-2 rounded-md border border-line p-3">
              <p className="text-sm font-medium text-plum">Pay now with M-Pesa</p>
              <Field label="M-Pesa phone number" htmlFor="pay-phone" hint="You get a prompt on this phone to enter your M-Pesa PIN. ChamaHub never sees your PIN.">
                <Input id="pay-phone" inputMode="tel" placeholder={me?.phone.replace('+254', '0')} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Button onClick={() => stk.mutate(undefined)} loading={stk.isPending} disabled={!okAmount || cents! % 100 !== 0}>{okAmount ? `Send prompt for ${kes(cents!)}` : 'Send M-Pesa prompt'}</Button>
            </div>
          )}

          <div className="space-y-3 rounded-md border border-line p-3">
            <p className="text-sm font-medium text-plum">Already paid? Report it</p>
            {live.length > 0 ? (
              <Field label="Where did you send it?" htmlFor="pay-dest">
                <Select id="pay-dest" value={chosen} onChange={(e) => setDestinationId(e.target.value)}>
                  {live.length > 1 && <option value="">Choose…</option>}
                  {live.map((d) => <option key={d.id} value={d.id}>{[d.displayName, DESTINATION_LABELS.type[d.type], d.accountNumber, d.accountReference && `acc ${d.accountReference}`].filter(Boolean).join(' · ')}</option>)}
                </Select>
              </Field>
            ) : (
              <p className="rounded-md bg-canvas px-3 py-2 text-sm text-plum">
                {settings?.paybillNumber ? `Pay via M-Pesa Paybill ${settings.paybillNumber}, account ${settings.accountReferencePrefix ?? ''}${me?.phone.slice(-9) ?? ''}. Your treasurer will match and confirm it.` : 'Pay your treasurer by M-Pesa or cash and they will record it, or report your M-Pesa code here.'}
              </p>
            )}
            <Link href={`/g/${groupId}/payment-destinations`} className="inline-block text-xs text-berry hover:underline">See how to pay this Chama</Link>
            <Field label="M-Pesa or bank transaction code" htmlFor="pay-ref">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase().trim())} placeholder="e.g. QBC12XYZ9" className="font-mono" />
            </Field>
            <div>
              <input ref={fileInput} type="file" accept={EVIDENCE_MIME_TYPES.join(',')} className="sr-only" aria-label="Choose a receipt or screenshot" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button type="button" size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>{file ? `Receipt: ${file.name}` : 'Attach a receipt or screenshot (optional)'}</Button>
            </div>
            <Button onClick={() => report.mutate(undefined)} loading={report.isPending} disabled={!okAmount || reference.length < 6 || (live.length > 1 && !chosen) || !group.data}>
              {okAmount ? `Report ${kes(cents!)} payment` : 'Report payment'}
            </Button>
            <p className="text-xs text-muted">The treasurer checks the code against the group account before it counts. Never share your M-Pesa PIN or bank password with anyone.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
