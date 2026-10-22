import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { BILLING_STATUS_LABELS, FEATURE_LABELS, formatMoney, SUBSCRIPTION_STATUS_LABELS, type BillingInterval, type BillingPaymentRow, type CheckoutResult, type PlanOffer, type SubscriptionSummary } from '@chamahub/shared';
import { Badge, Button, Chips, ErrorView, Field, KV, Loading, Notice, Progress, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { askToConfirm } from '@/lib/confirm';
import { date, newKey } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

const SOURCE: Record<SubscriptionSummary['access']['source'], string> = { PAID: 'Paid', TRIAL: 'Free trial', PROMOTION: 'Promotional access', GRACE: 'Renewal overdue', FREE: 'Free plan' };
const PAY_TONE: Record<BillingPaymentRow['status'], 'green' | 'amber' | 'red' | 'neutral'> = { PENDING: 'amber', SUCCEEDED: 'green', FAILED: 'red', CANCELLED: 'neutral', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'amber', DISPUTED: 'red' };
const m = (minor: number, currency: string) => formatMoney(minor, currency);

/**
 * The group's ChamaHub plan: what it includes and, for the chairperson and treasurer, paying,
 * changing and cancelling it. This is ChamaHub's fee, never the group's own money.
 */
export default function Billing() {
  const { groupId } = useGroupAccess();
  const { user } = useAuth();
  const summary = useQuery({ queryKey: ['billing', groupId], queryFn: () => api<SubscriptionSummary>(`groups/${groupId}/billing`) });
  const plans = useQuery({ queryKey: ['billing-plans', groupId], queryFn: () => api<PlanOffer[]>(`groups/${groupId}/billing/plans`) });
  const [interval, setInterval] = useState<BillingInterval>('MONTH');
  const [buying, setBuying] = useState<PlanOffer | null>(null);
  const [provider, setProvider] = useState('');
  const [phone, setPhone] = useState(user?.phone.replace('+254', '0') ?? '');
  const [key, setKey] = useState(newKey);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const inv = [['billing', groupId], ['group', groupId]];
  const payment = useQuery({ queryKey: ['billing-payment', result?.payment.id], queryFn: () => api<BillingPaymentRow>(`groups/${groupId}/billing/payments/${result!.payment.id}`), enabled: !!result, refetchInterval: (q) => (!q.state.data || q.state.data.status === 'PENDING' ? 4000 : false) });
  const checkout = useAct(() => api<CheckoutResult>(`groups/${groupId}/billing/checkout`, { body: { planCode: buying!.code, interval, provider, phone: provider === 'MPESA_DARAJA' ? phone : undefined, idempotencyKey: key } }), { invalidate: inv, onSuccess: (r) => { setResult(r); if (r.action.type === 'REDIRECT' && r.action.url) void Linking.openURL(r.action.url); } });
  const simulate = useAct((outcome: 'SUCCEEDED' | 'FAILED') => api(`groups/${groupId}/billing/payments/${result!.payment.id}/simulate`, { body: { outcome } }), { invalidate: [...inv, ['billing-payment', result?.payment.id]] });
  const cancel = useAct(() => api<{ accessUntil: string | null }>(`groups/${groupId}/billing/cancel`, { body: {} }), { invalidate: inv, successMessage: 'Cancelled. Your records stay available.' });
  const resume = useAct(() => api(`groups/${groupId}/billing/resume`, { method: 'POST' }), { invalidate: inv, successMessage: 'Your plan will renew as before.' });
  const downgrade = useAct((p: PlanOffer) => api(`groups/${groupId}/billing/change-plan`, { body: { planCode: p.code, interval } }), { invalidate: inv, successMessage: 'Change scheduled for the end of the period.' });

  const s = summary.data;
  if (summary.error) return <Screen><ErrorView error={summary.error} onRetry={summary.refetch} /></Screen>;
  if (!s || !plans.data) return <Screen><Loading /></Screen>;
  const sub = s.subscription;
  const paidTier = sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') ? (plans.data.find((p) => p.code === sub.planCode)?.tier ?? 0) : 0;
  const used = s.usage.members + s.usage.pendingInvitations;
  const p = payment.data ?? result?.payment;
  const reset = () => { setBuying(null); setResult(null); setKey(newKey()); };

  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => { summary.refetch(); plans.refetch(); }}>
      <Stack.Screen options={{ title: 'Plan & billing' }} />
      <Notice tone="neutral" icon="information-circle-outline">This is what the group pays ChamaHub. It is separate from contributions, loans and payouts. Every record stays available on every plan.</Notice>
      <Section title="Current plan">
        <View style={{ padding: space.lg, gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T variant="title">{s.access.planName}</T>
            <Badge label={SOURCE[s.access.source]} tone={s.access.source === 'GRACE' ? 'amber' : s.access.source === 'FREE' ? 'neutral' : 'green'} />
          </View>
          {s.access.until && <T variant="small">{s.access.source === 'GRACE' ? `Renew by ${date(s.access.until)} to keep paid features` : `Until ${date(s.access.until)}`}</T>}
          {sub && <T variant="small">{SUBSCRIPTION_STATUS_LABELS[sub.status]}{sub.amountMinor !== null && sub.currency ? ` · ${m(sub.amountMinor, sub.currency)} ${sub.interval === 'YEAR' ? 'a year' : 'a month'}` : ''}</T>}
          <Progress percent={Math.min(100, Math.round((used / s.access.maxMembers) * 100))} label={`${used} of ${s.access.maxMembers} members`} tone={used / s.access.maxMembers >= 0.9 ? 'amber' : 'green'} />
          <T variant="small">{s.access.features.length ? `Includes: ${s.access.features.map((f) => FEATURE_LABELS[f]).join(', ')}` : 'Core features: contributions, payments, statements, rotations, meetings.'}</T>
        </View>
      </Section>
      {sub?.cancelAtPeriodEnd && <Notice tone="amber" icon="time-outline">{`Cancelled. Paid features continue until ${date(sub.currentPeriodEnd)}; then the group moves to Free.`}</Notice>}
      {sub?.scheduledPlanCode && <Notice tone="blue" icon="swap-horizontal-outline">{`Changing to ${sub.scheduledPlanCode} on ${date(sub.currentPeriodEnd)}.`}</Notice>}

      {!s.canManage ? (
        <Notice tone="neutral">Only your chairperson or treasurer can change the plan.</Notice>
      ) : buying ? (
        <Section title={`${buying.name} · ${interval === 'YEAR' ? 'annual' : 'monthly'}`}>
          <View style={{ padding: space.lg }}>
            {!result ? (
              <>
                <KV label="Price" value={m(buying.prices.find((x) => x.interval === interval)!.amountMinor, buying.prices.find((x) => x.interval === interval)!.currency)} />
                <KV label="Renewal" value="You renew yourself; no automatic charge" last />
                <T variant="label" style={{ marginTop: space.md, marginBottom: 6 }}>Pay with</T>
                <Chips value={provider} onChange={setProvider} options={s.providers.map((x) => ({ value: x.code, label: `${x.name}${x.livemode ? '' : ' (test)'}` }))} />
                {provider === 'MPESA_DARAJA' && <Field label="M-Pesa phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="You will get a prompt on this phone. Enter your PIN only there; ChamaHub never asks for it." />}
                <Button title="Continue to pay" onPress={() => checkout.mutate(undefined)} loading={checkout.isPending} disabled={!provider} />
                <Button title="Back" variant="ghost" onPress={reset} style={{ marginTop: space.sm }} />
              </>
            ) : (
              <>
                <KV label="Reference" value={result.payment.reference} />
                {result.payment.creditMinor > 0 && <KV label="Credit for unused time" value={`−${m(result.payment.creditMinor, result.payment.currency)}`} />}
                <KV label="To pay" value={m(result.payment.amountMinor, result.payment.currency)} />
                <KV label="Status" value={<Badge label={BILLING_STATUS_LABELS[p!.status]} tone={PAY_TONE[p!.status]} />} last />
                {p!.status === 'PENDING' && <Notice tone="blue" icon="phone-portrait-outline">{result.action.message}</Notice>}
                {result.action.instructions?.map((i) => <T key={i} variant="small">{`• ${i}`}</T>)}
                {result.action.type === 'SANDBOX' && p!.status === 'PENDING' && (
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Simulate payment" onPress={() => simulate.mutate('SUCCEEDED')} style={{ flex: 1 }} />
                    <Button title="Simulate failure" variant="secondary" onPress={() => simulate.mutate('FAILED')} style={{ flex: 1 }} />
                  </View>
                )}
                {p!.status === 'SUCCEEDED' && <Notice tone="green" icon="checkmark-circle-outline">{`Payment confirmed. ${buying.name} is active. Receipt ${p!.receiptNumber}.`}</Notice>}
                {(p!.status === 'FAILED' || p!.status === 'CANCELLED') && <Notice tone="red" icon="close-circle-outline">{`The payment did not go through${p!.failureReason ? `: ${p!.failureReason}` : ''}. Nothing was charged.`}</Notice>}
                <Button title={p!.status === 'PENDING' ? 'Close — we keep checking' : 'Done'} variant="ghost" onPress={() => { reset(); summary.refetch(); }} style={{ marginTop: space.sm }} />
              </>
            )}
          </View>
        </Section>
      ) : (
        <>
          <Chips value={interval} onChange={setInterval} options={[{ value: 'MONTH', label: 'Monthly' }, { value: 'YEAR', label: 'Annual' }]} />
          <Section title="Plans">
            {plans.data.map((pl, i) => {
              const price = pl.prices.find((x) => x.interval === interval);
              const current = pl.code === s.access.planCode && (s.access.source === 'PAID' || s.access.source === 'GRACE' || s.access.source === 'FREE');
              const action = pl.tier === 0 || !price || !s.providers.length ? null : pl.tier > paidTier ? (paidTier ? 'Upgrade' : 'Choose') : pl.tier === paidTier ? 'Renew' : 'Switch at period end';
              return (
                <Row
                  key={pl.code}
                  title={`${pl.name}${current ? ' (current)' : ''}`}
                  subtitle={`Up to ${pl.maxMembers} members${pl.features.length ? ` · ${pl.features.map((f) => FEATURE_LABELS[f]).join(', ')}` : ''}`}
                  right={pl.tier === 0 ? 'Free' : price ? m(price.amountMinor, price.currency) : '—'}
                  rightSub={action && !current ? action : undefined}
                  onPress={action && !current ? () => (action === 'Switch at period end' ? askToConfirm(`Switch to ${pl.name}?`, `${pl.name} starts on ${date(sub?.currentPeriodEnd)}. Until then you keep ${sub?.planName}.`, 'Schedule', () => downgrade.mutate(pl)) : (setBuying(pl), setProvider(s.providers[0]?.code ?? ''))) : undefined}
                  last={i === plans.data!.length - 1}
                />
              );
            })}
          </Section>
          {!s.providers.length && <Notice tone="neutral">Online payment is not available for this group&apos;s country yet.</Notice>}
          {sub?.status === 'ACTIVE' && (sub.cancelAtPeriodEnd || sub.scheduledPlanCode) ? (
            <Button title="Keep my current plan" variant="secondary" onPress={() => resume.mutate(undefined)} loading={resume.isPending} />
          ) : sub && ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status) ? (
            <Button title="Cancel plan" variant="ghost" onPress={() => askToConfirm('Cancel your plan?', sub.status === 'ACTIVE' ? `Paid features continue until ${date(sub.currentPeriodEnd)}; then the group moves to Free. Nothing is deleted.` : 'The group moves to Free now. Nothing is deleted.', 'Cancel plan', () => cancel.mutate(undefined))} />
          ) : null}
          <Section title="Payment history" style={{ marginTop: space.lg }}>
            {s.payments.length === 0 ? <Row title="No payments yet" last /> : s.payments.slice(0, 20).map((x, i, arr) => (
              <Row key={x.id} title={`${x.planName} · ${m(x.amountMinor, x.currency)}`} subtitle={`${date(x.paidAt ?? x.createdAt)} · ${x.reference}${x.receiptNumber ? ` · receipt ${x.receiptNumber}` : ''}${x.livemode ? '' : ' · test'}`} rightSub={<Badge label={BILLING_STATUS_LABELS[x.status]} tone={PAY_TONE[x.status]} />} last={i === arr.length - 1} />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
