'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BILLING_STATUS_LABELS, type BillingReceipt } from '@chamahub/shared';
import { BrandMark } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useGroupId } from '@/lib/session';
import { date, dateTime, money } from '@/lib/utils';

/** A printable receipt for a ChamaHub subscription payment. */
export default function ReceiptPage() {
  const groupId = useGroupId();
  const { paymentId } = useParams<{ paymentId: string }>();
  const q = useQuery({ queryKey: ['receipt', paymentId], queryFn: () => api<BillingReceipt>(`groups/${groupId}/billing/payments/${paymentId}/receipt`) });
  const r = q.data;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!r) return <LoadingRows />;
  return (
    <article className="mx-auto max-w-xl rounded-xl border border-line bg-white p-6 shadow-card print:border-0 print:shadow-none">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2"><BrandMark className="h-8 w-8" /><div><p className="font-bold text-plum">{r.seller.name}</p>{r.seller.address && <p className="text-xs text-muted">{r.seller.address}</p>}{r.seller.email && <p className="text-xs text-muted">{r.seller.email}</p>}{r.seller.taxId && <p className="text-xs text-muted">Tax ID {r.seller.taxId}</p>}</div></div>
        <div className="text-right"><p className="text-xs uppercase tracking-wider text-muted">Receipt</p><p className="font-mono font-semibold text-plum">{r.receiptNumber}</p></div>
      </div>
      {!r.livemode && <p className="mt-4 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Test payment — no money was taken.</p>}
      <dl className="mt-6 grid grid-cols-[1fr_auto] gap-y-2 text-sm">
        <dt className="text-muted">Issued</dt><dd>{dateTime(r.issuedAt)}</dd>
        <dt className="text-muted">Customer</dt><dd>{r.groupName}</dd>
        <dt className="text-muted">Description</dt><dd className="text-right">{r.description}</dd>
        {r.periodStart && <><dt className="text-muted">Period</dt><dd>{date(r.periodStart)} – {date(r.periodEnd)}</dd></>}
        <dt className="text-muted">Price</dt><dd className="tabular-nums">{money(r.priceMinor, r.currency)}</dd>
        {r.creditMinor > 0 && <><dt className="text-muted">Credit for unused time</dt><dd className="tabular-nums">−{money(r.creditMinor, r.currency)}</dd></>}
        <dt className="font-semibold text-plum">Paid</dt><dd className="font-semibold tabular-nums">{money(r.amountMinor, r.currency)}</dd>
        {r.refundedMinor > 0 && <><dt className="text-muted">Refunded</dt><dd className="tabular-nums">−{money(r.refundedMinor, r.currency)}</dd></>}
        <dt className="text-muted">Payment</dt><dd>{r.provider.replace('_', ' ')}{r.providerReceipt ? ` · ${r.providerReceipt}` : ''}</dd>
        <dt className="text-muted">Reference</dt><dd className="font-mono">{r.reference}</dd>
        <dt className="text-muted">Status</dt><dd>{BILLING_STATUS_LABELS[r.status]}</dd>
      </dl>
      <p className="mt-6 text-xs text-muted">This receipt is for ChamaHub software subscription fees. It is not a record of the group&apos;s own money.</p>
      <Button variant="secondary" className="mt-4 print:hidden" onClick={() => window.print()}>Print or save as PDF</Button>
    </article>
  );
}
