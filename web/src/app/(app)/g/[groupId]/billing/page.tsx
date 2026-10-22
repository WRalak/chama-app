'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BILLING_STATUS_LABELS, FEATURE_LABELS, FEATURES, SUBSCRIPTION_STATUS_LABELS, type BillingInterval, type BillingPaymentRow, type CheckoutResult, type PlanOffer, type SubscriptionSummary } from '@chamahub/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useGroupId, useMe } from '@/lib/session';
import { cn, date, money, newIdempotencyKey } from '@/lib/utils';

const SOURCE: Record<SubscriptionSummary['access']['source'], { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  TRIAL: { label: 'Free trial', tone: 'blue' },
  PROMOTION: { label: 'Promotional access', tone: 'blue' },
  GRACE: { label: 'Renewal overdue', tone: 'amber' },
  FREE: { label: 'Free plan', tone: 'neutral' },
};
const PAY_TONE: Record<BillingPaymentRow['status'], Tone> = { PENDING: 'amber', SUCCEEDED: 'green', FAILED: 'red', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'amber', DISPUTED: 'red' };

/**
 * The group's ChamaHub plan. This is what the group pays ChamaHub; it never touches the group's
 * own money. Every member can see the plan; chairperson and treasurer (billing.manage) can change it.
 */
export default function BillingPage() {
  const groupId = useGroupId();
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['billing', groupId], queryFn: () => api<SubscriptionSummary>(`groups/${groupId}/billing`) });
  const plans = useQuery({ queryKey: ['billing-plans', groupId], queryFn: () => api<PlanOffer[]>(`groups/${groupId}/billing/plans`) });
  const [interval, setInterval] = useState<BillingInterval>('MONTH');
  const [buying, setBuying] = useState<PlanOffer | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'cancel' | 'resume' | 'downgrade'; plan?: PlanOffer }>(null);
  const inv = [['billing', groupId], ['group', groupId]];
  const cancel = useAction(() => api<{ accessUntil: string | null }>(`groups/${groupId}/billing/cancel`, { body: {} }), { success: (r) => (r.accessUntil ? `Cancelled. Paid features continue until ${date(r.accessUntil)}.` : 'Cancelled.'), invalidate: inv, onSuccess: () => setConfirm(null) });
  const resume = useAction(() => api(`groups/${groupId}/billing/resume`, { method: 'POST' }), { success: 'Your plan will renew as before.', invalidate: inv, onSuccess: () => setConfirm(null) });
  const downgrade = useAction((p: PlanOffer) => api<{ effectiveAt: string }>(`groups/${groupId}/billing/change-plan`, { body: { planCode: p.code, interval } }), { success: (r) => `Change scheduled for ${date(r.effectiveAt)}.`, invalidate: inv, onSuccess: () => setConfirm(null) });

  const s = summary.data;
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.refetch} />;
  if (!s || !plans.data) return <LoadingRows rows={6} />;
  const sub = s.subscription;
  const current = plans.data.find((p) => p.code === s.access.planCode);
  const paidTier = sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') ? (plans.data.find((p) => p.code === sub.planCode)?.tier ?? 0) : 0;
  const usagePct = Math.min(100, Math.round(((s.usage.members + s.usage.pendingInvitations) / s.access.maxMembers) * 100));

  const payCols: ColumnDef<BillingPaymentRow, unknown>[] = [
    { header: 'Date', accessorKey: 'createdAt', cell: ({ row }) => date(row.original.paidAt ?? row.original.createdAt) },
    { header: 'Reference', accessorKey: 'reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
    { header: 'Plan', accessorKey: 'planName', cell: ({ row }) => `${row.original.planName} · ${row.original.interval === 'YEAR' ? 'annual' : 'monthly'}${row.original.livemode ? '' : ' · test'}` },
    { header: 'Amount', accessorKey: 'amountMinor', meta: { align: 'right' }, cell: ({ row }) => money(row.original.amountMinor, row.original.currency) },
    { header: 'Status', accessorKey: 'status', cell: ({ row }) => <Badge tone={PAY_TONE[row.original.status]}>{BILLING_STATUS_LABELS[row.original.status]}</Badge> },
    { header: 'Receipt', id: 'receipt', cell: ({ row }) => (row.original.receiptNumber ? <Link href={`/g/${groupId}/billing/receipt/${row.original.id}`} className="text-berry hover:underline">{row.original.receiptNumber}</Link> : row.original.failureReason ? <span className="text-xs text-muted">{row.original.failureReason}</span> : '—') },
  ];

  return (
    <>
      <PageHeader title="Plan & billing" description={`What ${s.groupName} pays ChamaHub. This is separate from your group's own contributions, loans and payouts, and every record stays available on every plan.`} />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Panel title="Current plan" actions={<Badge tone={SOURCE[s.access.source].tone}>{SOURCE[s.access.source].label}</Badge>}>
          <p className="text-2xl font-bold text-plum">{s.access.planName}</p>
          <p className="mt-1 text-sm text-muted">
            {s.access.source === 'FREE' ? 'No paid plan. Your records, statements and reports remain available.' : null}
            {s.access.source === 'TRIAL' && `Trial ends ${date(s.access.until)}. Choose a plan to keep these features.`}
            {s.access.source === 'PROMOTION' && `Promotional access until ${date(s.access.until)}.`}
            {s.access.source === 'GRACE' && `Your renewal is overdue. Paid features continue until ${date(s.access.until)}, then the group moves to Free.`}
            {s.access.source === 'PAID' && sub && `${sub.interval === 'YEAR' ? 'Annual' : 'Monthly'} · ${sub.amountMinor !== null && sub.currency ? money(sub.amountMinor, sub.currency) : ''} · ${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${date(sub.currentPeriodEnd)}`}
          </p>
          {sub && <p className="mt-1 text-xs text-muted">Subscription status: {SUBSCRIPTION_STATUS_LABELS[sub.status]}</p>}
          {sub?.cancelAtPeriodEnd && <p className="mt-3 rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Cancelled. Paid features continue until {date(sub.currentPeriodEnd)}; then the group moves to Free. Nothing is deleted.</p>}
          {sub?.scheduledPlanCode && <p className="mt-3 rounded-md bg-blush px-3 py-2 text-sm text-plum">Changing to {plans.data.find((p) => p.code === sub.scheduledPlanCode)?.name ?? sub.scheduledPlanCode} on {date(sub.currentPeriodEnd)}.</p>}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted">
              <span>Members{s.usage.pendingInvitations ? ` (incl. ${s.usage.pendingInvitations} invited)` : ''}</span>
              <span>{s.usage.members + s.usage.pendingInvitations} of {s.access.maxMembers}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-blush" role="progressbar" aria-valuenow={usagePct} aria-valuemin={0} aria-valuemax={100} aria-label="Members used">
              <div className={cn('h-2 rounded-full', usagePct >= 90 ? 'bg-pending' : 'bg-rose')} style={{ width: `${usagePct}%` }} />
            </div>
          </div>
          {s.canManage && sub && sub.status === 'ACTIVE' && (sub.cancelAtPeriodEnd || sub.scheduledPlanCode) ? (
            <Button variant="secondary" className="mt-4" onClick={() => setConfirm({ kind: 'resume' })}>Keep my current plan</Button>
          ) : s.canManage && sub && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status) ? (
            <Button variant="ghost" className="mt-4" onClick={() => setConfirm({ kind: 'cancel' })}>Cancel plan…</Button>
          ) : null}
        </Panel>

        <Panel title="Included now">
          <ul className="space-y-1.5 text-sm">
            {FEATURES.map((f) => {
              const on = s.access.features.includes(f);
              return (
                <li key={f} className={cn('flex items-center gap-2', on ? 'text-plum' : 'text-muted')}>
                  {on ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
                  {FEATURE_LABELS[f]}
                  <span className="sr-only">{on ? '(included)' : '(not included)'}</span>
                </li>
              );
            })}
            <li className="flex items-center gap-2 text-plum"><Check className="h-4 w-4 text-success" aria-hidden />Contributions, statements, reports and history — always</li>
          </ul>
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Plans"
        actions={
          <div role="radiogroup" aria-label="Billing interval" className="flex rounded-full border border-line p-0.5 text-sm">
            {(['MONTH', 'YEAR'] as const).map((i) => (
              <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cn('rounded-full px-3 py-1', interval === i ? 'bg-berry font-medium text-white' : 'text-muted hover:text-plum')}>
                {i === 'MONTH' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        }
      >
        {!s.canManage && <p className="mb-3 text-sm text-muted">Only your chairperson or treasurer can change the plan.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          {plans.data.map((p) => {
            const price = p.prices.find((x) => x.interval === interval);
            const isCurrent = p.code === current?.code && s.access.source !== 'TRIAL' && s.access.source !== 'PROMOTION';
            const action = !s.canManage || p.tier === 0 || !price ? null : p.tier > paidTier ? 'buy' : p.tier === paidTier ? 'renew' : 'downgrade';
            return (
              <div key={p.code} className={cn('flex flex-col rounded-xl border p-4', isCurrent ? 'border-rose bg-blush/40' : 'border-line bg-white')}>
                <p className="font-semibold text-plum">{p.name}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-plum">{p.tier === 0 ? 'Free' : price ? money(price.amountMinor, price.currency) : 'Not sold here'}{price && <span className="text-xs font-normal text-muted"> / {interval === 'YEAR' ? 'year' : 'month'}</span>}</p>
                <p className="mt-1 text-xs text-muted">Up to {p.maxMembers} members</p>
                {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
                <ul className="mt-2 flex-1 space-y-0.5 text-xs text-plum">{p.features.map((f) => <li key={f}>✓ {FEATURE_LABELS[f]}</li>)}</ul>
                {isCurrent ? (
                  <Badge tone="green" className="mt-3 self-start">Current plan</Badge>
                ) : action === 'downgrade' ? (
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setConfirm({ kind: 'downgrade', plan: p })}>Switch at period end</Button>
                ) : action ? (
                  <Button size="sm" className="mt-3" onClick={() => setBuying(p)} disabled={!s.providers.length}>{action === 'renew' ? 'Renew' : paidTier > 0 ? 'Upgrade' : 'Choose'}</Button>
                ) : null}
              </div>
            );
          })}
        </div>
        {s.canManage && !s.providers.length && <p className="mt-3 text-sm text-muted">Online payment is not available for this group&apos;s country yet. Contact ChamaHub support to pay by invoice.</p>}
        <p className="mt-3 text-xs text-muted">Prices include any taxes shown at checkout. Upgrades start immediately and credit unused time; downgrades start when the current period ends; you can cancel any time and keep access until the period ends. See the <a href="/terms" target="_blank" className="text-berry hover:underline">Terms of Use</a>.</p>
      </Panel>

      {s.canManage && (
        <Panel className="mt-4" title="Payment history" flush>
          <DataTable columns={payCols} data={s.payments} empty="No payments yet" />
        </Panel>
      )}

      {buying && <CheckoutDialog plan={buying} interval={interval} summary={s} onClose={() => { setBuying(null); void qc.invalidateQueries({ queryKey: ['billing', groupId] }); void qc.invalidateQueries({ queryKey: ['group', groupId] }); }} />}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent title={confirm.kind === 'cancel' ? 'Cancel your plan?' : confirm.kind === 'resume' ? 'Keep your current plan?' : `Switch to ${confirm.plan!.name}?`}>
            <p className="text-sm text-plum">
              {confirm.kind === 'cancel' && (sub?.status === 'ACTIVE' ? `Paid features continue until ${date(sub.currentPeriodEnd)}. After that the group moves to Free. No refund is made for the remaining time, and nothing is deleted.` : 'The trial or overdue plan ends now and the group moves to Free. Nothing is deleted.')}
              {confirm.kind === 'resume' && 'The scheduled cancellation or change is removed and the plan renews as before.'}
              {confirm.kind === 'downgrade' && `${confirm.plan!.name} starts on ${date(sub?.currentPeriodEnd)}, when you renew. Until then you keep ${sub?.planName}. Features not in ${confirm.plan!.name} stop then; records stay.`}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant={confirm.kind === 'cancel' ? 'danger' : 'primary'} loading={cancel.isPending || resume.isPending || downgrade.isPending} onClick={() => (confirm.kind === 'cancel' ? cancel.mutate(undefined) : confirm.kind === 'resume' ? resume.mutate(undefined) : downgrade.mutate(confirm.plan!))}>
                {confirm.kind === 'cancel' ? 'Yes, cancel' : 'Confirm'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Go back</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function CheckoutDialog({ plan, interval, summary, onClose }: { plan: PlanOffer; interval: BillingInterval; summary: SubscriptionSummary; onClose: () => void }) {
  const groupId = useGroupId();
  const { data: me } = useMe();
  const price = plan.prices.find((p) => p.interval === interval)!;
  const [provider, setProvider] = useState(summary.providers[0]?.code ?? '');
  const [phone, setPhone] = useState(me?.phone.replace('+254', '0') ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [key] = useState(newIdempotencyKey);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const chosen = summary.providers.find((p) => p.code === provider);
  const checkout = useAction(
    () => api<CheckoutResult>(`groups/${groupId}/billing/checkout`, { body: { planCode: plan.code, interval, provider, phone: provider === 'MPESA_DARAJA' ? phone : undefined, email: provider === 'PAYSTACK' ? email : undefined, idempotencyKey: key } }),
    { onSuccess: (r) => { setResult(r); if (r.action.type === 'REDIRECT' && r.action.url) window.location.assign(r.action.url); } },
  );
  const payment = useQuery({
    queryKey: ['billing-payment', result?.payment.id],
    queryFn: () => api<BillingPaymentRow>(`groups/${groupId}/billing/payments/${result!.payment.id}`),
    enabled: !!result,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' || !q.state.data ? 4000 : false),
  });
  const simulate = useAction((outcome: 'SUCCEEDED' | 'FAILED') => api<BillingPaymentRow>(`groups/${groupId}/billing/payments/${result!.payment.id}/simulate`, { body: { outcome } }), { onSuccess: () => void payment.refetch() });
  const p = payment.data ?? result?.payment;
  useEffect(() => {
    if (p && p.status === 'SUCCEEDED') {
      const t = setTimeout(onClose, 2500);
      return () => clearTimeout(t);
    }
  }, [p, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${plan.name} · ${interval === 'YEAR' ? 'annual' : 'monthly'}`} description="You are paying ChamaHub for the group's plan. This is not a group contribution.">
        {!result ? (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); checkout.mutate(undefined); }}>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-md bg-canvas p-3 text-sm">
              <dt className="text-muted">Plan price</dt><dd className="tabular-nums">{money(price.amountMinor, price.currency)}</dd>
              <dt className="text-muted">Billing</dt><dd>{interval === 'YEAR' ? 'Every year' : 'Every month'} · renew yourself, no automatic charge</dd>
            </dl>
            <p className="text-xs text-muted">If you are upgrading, the unused part of your current plan is credited and the amount to pay is shown before you confirm on your phone or card page.</p>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-plum">Pay with</legend>
              <div className="space-y-2">
                {summary.providers.map((pr) => (
                  <label key={pr.code} className={cn('flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm', provider === pr.code ? 'border-rose bg-blush/40' : 'border-line')}>
                    <input type="radio" name="provider" value={pr.code} checked={provider === pr.code} onChange={() => setProvider(pr.code)} className="accent-[#B83270]" />
                    <span className="flex-1">{pr.name}<span className="block text-xs text-muted">{pr.methods.join(', ').replace(/_/g, ' ').toLowerCase()}</span></span>
                    {!pr.livemode && <Badge tone="amber" icon={false}>Test mode</Badge>}
                  </label>
                ))}
              </div>
            </fieldset>
            {provider === 'MPESA_DARAJA' && (
              <Field label="M-Pesa phone number" htmlFor="co-phone" hint="You will get a prompt on this phone. Enter your PIN only there; ChamaHub never asks for it.">
                <Input id="co-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            )}
            {provider === 'PAYSTACK' && (
              <Field label="E-mail for the receipt" htmlFor="co-email"><Input id="co-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            )}
            <Button type="submit" className="w-full" loading={checkout.isPending} disabled={!chosen}>Continue to pay</Button>
          </form>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-md bg-canvas p-3 text-sm">
              <dt className="text-muted">Reference</dt><dd className="font-mono">{result.payment.reference}</dd>
              {result.payment.creditMinor > 0 && <><dt className="text-muted">Credit for unused time</dt><dd className="tabular-nums">−{money(result.payment.creditMinor, result.payment.currency)}</dd></>}
              <dt className="font-medium text-plum">To pay</dt><dd className="font-semibold tabular-nums">{money(result.payment.amountMinor, result.payment.currency)}</dd>
              <dt className="text-muted">Status</dt><dd><Badge tone={PAY_TONE[p!.status]}>{BILLING_STATUS_LABELS[p!.status]}</Badge></dd>
            </dl>
            {p!.status === 'PENDING' && <p className="text-sm text-plum">{result.action.message}</p>}
            {result.action.instructions && <ul className="list-disc pl-5 text-sm text-plum">{result.action.instructions.map((i) => <li key={i}>{i}</li>)}</ul>}
            {result.action.type === 'REDIRECT' && result.action.url && p!.status === 'PENDING' && <Button asChild><a href={result.action.url}>Open the payment page</a></Button>}
            {result.action.type === 'SANDBOX' && p!.status === 'PENDING' && (
              <div className="rounded-md border border-pending/40 bg-pending-50 p-3 text-sm text-pending-ink">
                <p className="mb-2 font-medium">Test mode — no money moves.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => simulate.mutate('SUCCEEDED')} loading={simulate.isPending}>Simulate payment</Button>
                  <Button size="sm" variant="secondary" onClick={() => simulate.mutate('FAILED')}>Simulate failure</Button>
                </div>
              </div>
            )}
            {p!.status === 'SUCCEEDED' && <p className="rounded-md bg-success-50 px-3 py-2 text-sm text-success-ink">Payment confirmed. {plan.name} is active. Receipt {p!.receiptNumber}.</p>}
            {(p!.status === 'FAILED' || p!.status === 'CANCELLED') && <p className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-ink">The payment did not go through{p!.failureReason ? `: ${p!.failureReason}` : ''}. Nothing was charged.</p>}
            <Button variant="ghost" onClick={onClose}>{p!.status === 'PENDING' ? 'Close — we will keep checking' : 'Done'}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
