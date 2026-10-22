import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { DESTINATION_LABELS, IntegrationStatus, ObligationItem, parseKes, PaymentItem, todayInNairobi } from '@chamahub/shared';
import { EvidencePicker } from '@/components/evidence';
import { Button, Chips, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { uploadEvidence, useDestinations } from '@/lib/collections';
import type { PickedFile } from '@/lib/files';
import { useAuth } from '@/lib/auth';
import { kes, date, newKey } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { space } from '@/theme';

export default function Pay() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user } = useAuth();
  const group = useGroup(groupId);
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api<IntegrationStatus>('integrations/status', { auth: false }), staleTime: 5 * 60_000 });
  const obligations = useQuery({ queryKey: ['my-obligations', groupId], queryFn: () => api<ObligationItem[]>('me/obligations', { query: { groupId, from: '2000-01-01' } }) });
  const open = useMemo(() => (obligations.data ?? []).filter((o) => o.outstandingCents > 0), [obligations.data]);
  const [targetId, setTargetId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState(user?.phone.replace('+254', '0') ?? '');
  const [key] = useState(newKey);
  let cents: number | null = null;
  try {
    cents = amount ? parseKes(amount) : null;
  } catch {
    cents = null;
  }
  const stk = useAct(() => api<{ message: string }>(`groups/${groupId}/payments/mpesa/stk`, { body: { amountCents: cents, phone, purpose: 'CONTRIBUTION', targetId, idempotencyKey: key } }), { invalidate: [['my-payments', groupId], ['dashboard']], onSuccess: (r) => { router.back(); setTimeout(() => alert(r.message), 50); } });
  const [reference, setReference] = useState('');
  const destinations = useDestinations(groupId);
  const live = (destinations.data ?? []).filter((d) => d.validNow && d.type !== 'CASH');
  const [destinationId, setDestinationId] = useState<string | undefined>();
  const chosen = destinationId ?? (live.length === 1 ? live[0].id : undefined);
  const [receipt, setReceipt] = useState<PickedFile | null>(null);
  const report = useAct(
    async () => {
      const d = live.find((x) => x.id === chosen);
      const method = d && ['BANK_ACCOUNT', 'BANK_TRANSFER'].includes(d.type) ? 'BANK_TRANSFER' : 'MPESA';
      const p = await api<PaymentItem>(`groups/${groupId}/payments`, { body: { memberId: group.data!.myMembership.membershipId, amountCents: cents, method, reference, paidAt: todayInNairobi(), purpose: 'CONTRIBUTION', targetId, destinationId: chosen, idempotencyKey: key } });
      // The report is saved first; a failed upload can be retried from the payment's page.
      if (receipt) await uploadEvidence(groupId, p.id, receipt).catch(() => undefined);
      return p;
    },
    { invalidate: [['my-payments', groupId], ['my-obligations', groupId], ['dashboard']], successMessage: 'Reported. It shows as pending until an officer or the group’s statement confirms it.', onSuccess: (p) => router.replace(`/(app)/group/${groupId}/payments/${p.id}`) },
  );
  const settings = group.data?.settings;
  const mpesa = status.data?.mpesa.configured;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Make a contribution' }} />
      {!status.data || !obligations.data ? <Loading /> : (
        <>
          <Section title="What are you paying for?">
            {open.length === 0 && <Row title="Nothing outstanding" subtitle="You can still pay ahead; it is added to your savings." last />}
            {open.slice(0, 6).map((o, i, arr) => (
              <Row key={o.id} title={o.periodLabel} subtitle={`${o.scheduleName} · due ${date(o.dueDate)}`} right={kes(o.outstandingCents)} rightSub={targetId === o.id ? 'Selected' : undefined} onPress={() => { setTargetId(o.id); setAmount(String(o.outstandingCents / 100)); }} last={i === arr.length - 1} accessibilityLabel={`Pay ${o.periodLabel}, ${kes(o.outstandingCents)}`} />
            ))}
          </Section>
          <Field label="Amount (KES)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} prefix="KES" error={amount && cents === null ? 'Enter a valid amount' : undefined} />
          {mpesa ? (
            <>
              <Field label="M-Pesa phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="You will get a prompt on this phone to enter your M-Pesa PIN." />
              <Button title={cents ? `Pay ${kes(cents)} with M-Pesa` : 'Pay with M-Pesa'} onPress={() => stk.mutate(undefined)} loading={stk.isPending} disabled={!cents || cents <= 0 || cents % 100 !== 0} />
              <T variant="small" style={{ marginTop: space.sm }}>The payment shows as pending until Safaricom confirms it.</T>
            </>
          ) : (
            <>
              {live.length > 0 ? (
                <Section title="Pay to" action={<Button title="Details" variant="ghost" onPress={() => router.push(`/(app)/group/${groupId}/how-to-pay`)} />}>
                  {live.map((d, i) => <Row key={d.id} title={d.displayName} subtitle={[DESTINATION_LABELS.type[d.type], d.accountNumber, d.accountReference && `account ${d.accountReference}`].filter(Boolean).join(' · ')} onPress={() => router.push(`/(app)/group/${groupId}/how-to-pay`)} last={i === live.length - 1} />)}
                </Section>
              ) : <Notice tone="blue" icon="information-circle-outline">
                {settings?.paybillNumber
                  ? `Pay via M-Pesa Paybill ${settings.paybillNumber}, account ${settings.accountReferencePrefix ?? ''}${user?.phone.slice(-9) ?? ''}. Your treasurer will match and confirm it.`
                  : 'In-app M-Pesa payments are not enabled for this group yet. Pay your treasurer by M-Pesa or cash and they will record it. It will appear here as pending until verified.'}
              </Notice>}
              <Section title="Already paid? Report it">
                <View style={{ padding: space.lg }}>
                  {live.length > 1 && (
                    <>
                      <T variant="small" style={{ marginBottom: space.xs }}>Where did you send it?</T>
                      <Chips value={chosen ?? ''} onChange={(v) => setDestinationId(v)} options={live.map((d) => ({ value: d.id, label: d.displayName }))} />
                    </>
                  )}
                  <Field label="M-Pesa or bank transaction code" autoCapitalize="characters" value={reference} onChangeText={(t) => setReference(t.toUpperCase())} placeholder="e.g. QBC12XYZ9" />
                  <EvidencePicker value={receipt} onChange={setReceipt} />
                  <Button title={cents ? `Report ${kes(cents)} payment` : 'Report payment'} onPress={() => report.mutate(undefined)} loading={report.isPending} disabled={!cents || cents <= 0 || reference.length < 6 || (live.length > 1 && !chosen)} />
                  <T variant="small" style={{ marginTop: space.sm }}>The treasurer checks the code against the group account before it counts.</T>
                </View>
              </Section>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
