'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BILLING_STATUS_LABELS, type BillingPaymentRow, type BillingPaymentStatus, FEATURE_LABELS, PlatformPermission, SUBSCRIPTION_STATUS_LABELS, type SubscriptionSummary } from '@chamahub/shared';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { KeyValues, PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { usePlatformCan } from '@/lib/platform-session';
import { date, dateTime, money } from '@/lib/utils';

const PAY_TONE: Record<BillingPaymentStatus, Tone> = { PENDING: 'amber', SUCCEEDED: 'green', FAILED: 'red', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'amber', DISPUTED: 'red' };

interface Detail extends SubscriptionSummary {
  group: { type: string; status: string; createdAt: string; timezone: string; locale: string };
  events: { id: string; type: string; fromPlan: string | null; toPlan: string | null; fromStatus: string | null; toStatus: string | null; reason: string | null; actor: string; createdAt: string }[];
  cases: { id: string; subject: string; status: string; priority: string; createdAt: string }[];
}

/** One group's billing: plan, payments, promotions and history. Never the group's finances. */
export default function PlatformGroupBillingPage() {
  const { id } = useParams<{ id: string }>();
  const can = usePlatformCan();
  const q = useQuery({ queryKey: ['platform-billing-group', id], queryFn: () => api<Detail>(`platform/billing/groups/${id}`) });
  const [granting, setGranting] = useState(false);
  const [form, setForm] = useState({ planCode: 'PREMIUM', days: 30, reason: '' });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [caseOpen, setCaseOpen] = useState(false);
  const [caseForm, setCaseForm] = useState({ subject: '', details: '' });
  const inv = [['platform-billing-group', id]];
  const grant = useAction(() => api(`platform/billing/groups/${id}/promotions`, { body: { planCode: form.planCode, endsAt: new Date(Date.now() + form.days * 86_400_000).toISOString(), reason: form.reason } }), { success: 'Promotional access granted', invalidate: inv, onSuccess: () => setGranting(false) });
  const revoke = useAction(() => api(`platform/billing/groups/${id}/promotions/${revoking}/revoke`, { body: { reason: revokeReason } }), { success: 'Promotional access revoked', invalidate: inv, onSuccess: () => { setRevoking(null); setRevokeReason(''); } });
  const openCase = useAction(() => api('platform/billing/cases', { body: { groupId: id, subject: caseForm.subject, details: caseForm.details } }), { success: 'Case opened', invalidate: inv, onSuccess: () => setCaseOpen(false) });
  const d = q.data;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!d) return <LoadingRows rows={6} />;
  const s = d.subscription;
  return (
    <>
      <PageHeader title={d.groupName} description={`${d.countryCode} · ${d.currency} · ${d.usage.members} members · created ${date(d.group.createdAt)}. Billing only: the group's books need the chairperson's support approval.`} actions={<Button variant="secondary" onClick={() => setCaseOpen(true)}>Open billing case</Button>} />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Access now" actions={<Badge tone="blue">{d.access.source.toLowerCase()}</Badge>}>
          <KeyValues items={[
            ['Plan', d.access.planName],
            ['Until', d.access.until ? date(d.access.until) : '—'],
            ['Members', `${d.usage.members} (+${d.usage.pendingInvitations} invited) of ${d.access.maxMembers}`],
            ['Features', d.access.features.map((f) => FEATURE_LABELS[f]).join(', ') || 'Core only'],
          ]} />
        </Panel>
        <Panel title="Subscription">
          {s ? (
            <KeyValues items={[
              ['Plan', `${s.planName}${s.interval ? ` · ${s.interval === 'YEAR' ? 'annual' : 'monthly'}` : ''}`],
              ['Status', SUBSCRIPTION_STATUS_LABELS[s.status]],
              ['Price', s.amountMinor !== null && s.currency ? money(s.amountMinor, s.currency) : '—'],
              ['Period', s.currentPeriodStart ? `${date(s.currentPeriodStart)} – ${date(s.currentPeriodEnd)}` : s.trialEndsAt ? `Trial until ${date(s.trialEndsAt)}` : '—'],
              ['Grace until', s.graceEndsAt ? date(s.graceEndsAt) : '—'],
              ['Scheduled', s.cancelAtPeriodEnd ? 'Cancels at period end' : s.scheduledPlanCode ? `Changes to ${s.scheduledPlanCode}` : '—'],
            ]} />
          ) : <p className="text-sm text-muted">No subscription: the group is on Free.</p>}
        </Panel>
      </div>

      <Panel className="mt-4" title="Promotional access" actions={can(PlatformPermission.PLATFORM_MANAGE_BILLING) ? <Button size="sm" onClick={() => setGranting(true)}>Grant…</Button> : null} flush>
        {d.promotions.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">None</p> : (
          <ul className="divide-y divide-line text-sm">
            {d.promotions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>{p.planName} · {date(p.startsAt)} – {date(p.endsAt)}<span className="block text-xs text-muted">{p.reason}{p.revokedAt ? ` · revoked ${date(p.revokedAt)}` : ''}</span></span>
                {!p.revokedAt && new Date(p.endsAt) > new Date() && can(PlatformPermission.PLATFORM_MANAGE_BILLING) && <Button size="sm" variant="ghost" onClick={() => setRevoking(p.id)}>Revoke…</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-4" title="Payments" flush>
        <DataTable<BillingPaymentRow>
          data={d.payments}
          empty="No payments"
          columns={[
            { id: 'when', header: 'Date', cell: ({ row }) => dateTime(row.original.paidAt ?? row.original.createdAt) },
            { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span> },
            { id: 'plan', header: 'Plan', cell: ({ row }) => `${row.original.planName} · ${row.original.purpose.toLowerCase()}` },
            { accessorKey: 'provider', header: 'Provider', cell: ({ row }) => `${row.original.provider}${row.original.livemode ? '' : ' (test)'}` },
            { accessorKey: 'amountMinor', header: 'Amount', meta: { align: 'right' }, cell: ({ row }) => money(row.original.amountMinor, row.original.currency) },
            { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge tone={PAY_TONE[row.original.status]}>{BILLING_STATUS_LABELS[row.original.status]}</Badge> },
          ]}
        />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Panel title="Subscription history" flush>
          <ol className="divide-y divide-line text-sm">
            {d.events.map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <span className="font-medium text-plum">{e.type.replace(/_/g, ' ')}</span>
                <span className="text-muted">{e.fromPlan || e.toPlan ? ` · ${e.fromPlan ?? '—'} → ${e.toPlan ?? '—'}` : ''}{e.toStatus ? ` · ${e.toStatus.toLowerCase()}` : ''}</span>
                <span className="block text-xs text-muted">{dateTime(e.createdAt)} · {e.actor}{e.reason ? ` · ${e.reason}` : ''}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Billing cases" flush>
          {d.cases.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">None</p> : <ul className="divide-y divide-line text-sm">{d.cases.map((c) => <li key={c.id} className="px-4 py-2.5">{c.subject}<span className="block text-xs text-muted">{c.status.toLowerCase()} · {c.priority.toLowerCase()} · {dateTime(c.createdAt)}</span></li>)}</ul>}
        </Panel>
      </div>

      <Dialog open={granting} onOpenChange={setGranting}>
        <DialogContent title="Grant promotional access" description="Free access to a paid plan for a limited time. The reason is recorded and visible in the group's history.">
          <div className="space-y-3">
            <Field label="Plan" htmlFor="pg-plan"><Select id="pg-plan" value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}><option value="STARTER">Starter</option><option value="STANDARD">Standard</option><option value="PREMIUM">Premium</option></Select></Field>
            <Field label="Days" htmlFor="pg-days" hint="At most 366"><Input id="pg-days" type="number" min={1} max={366} value={form.days} onChange={(e) => setForm({ ...form, days: Math.max(1, Math.min(366, Number(e.target.value) || 1)) })} /></Field>
            <Field label="Reason" htmlFor="pg-reason"><Textarea id="pg-reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Pilot partner, compensation for outage of 3 Oct" /></Field>
            <Button onClick={() => grant.mutate(undefined)} loading={grant.isPending} disabled={form.reason.trim().length < 5}>Grant until {date(new Date(Date.now() + form.days * 86_400_000).toISOString())}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent title="Revoke promotional access" description="The group returns to its subscription or Free immediately.">
          <Field label="Reason" htmlFor="pr-reason"><Textarea id="pr-reason" rows={2} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} /></Field>
          <Button className="mt-3" variant="danger" onClick={() => revoke.mutate(undefined)} loading={revoke.isPending} disabled={revokeReason.trim().length < 5}>Revoke</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={caseOpen} onOpenChange={setCaseOpen}>
        <DialogContent title="Open a billing case">
          <div className="space-y-3">
            <Field label="Subject" htmlFor="bc-s"><Input id="bc-s" value={caseForm.subject} onChange={(e) => setCaseForm({ ...caseForm, subject: e.target.value })} /></Field>
            <Field label="Details" htmlFor="bc-d"><Textarea id="bc-d" rows={3} value={caseForm.details} onChange={(e) => setCaseForm({ ...caseForm, details: e.target.value })} /></Field>
            <Button onClick={() => openCase.mutate(undefined)} loading={openCase.isPending} disabled={caseForm.subject.trim().length < 3 || caseForm.details.trim().length < 5}>Open case</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
