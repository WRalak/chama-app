import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';
import { LABELS, MemberRow, Paginated, PaymentItem } from '@chamahub/shared';
import { Button, Chips, Field, Loading, Notice, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

/**
 * Members report a problem with one of their payments (or anything else);
 * officers escalate a discrepancy on any payment. Either way a dispute is
 * opened, a pending payment is frozen, and officers are notified.
 */
export default function Dispute() {
  const params = useLocalSearchParams<{ paymentId?: string; label?: string }>();
  const { groupId, group, myMembershipId } = useGroupAccess();
  const [paymentId, setPaymentId] = useState(params.paymentId ?? '');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const mine = useQuery({ queryKey: ['payments', groupId, 'mine'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { memberId: myMembershipId, pageSize: 10 } }), enabled: !params.paymentId && !!myMembershipId });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }) });
  const officers = (members.data ?? []).filter((m) => m.role !== 'MEMBER');
  const open = useAct(() => api(`groups/${groupId}/disputes`, { body: { paymentId: paymentId || undefined, subject: subject.trim(), details: details.trim() } }), { invalidate: [['disputes', groupId], ['payments', groupId], ['group-dashboard', groupId]], successMessage: 'Sent. Officers have been notified and will respond here.', onSuccess: () => router.back() });
  const myPayments = (mine.data?.items ?? []).filter((p) => p.membershipId === myMembershipId);
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: params.paymentId ? 'Escalate a discrepancy' : 'Report a problem' }} />
      {!group.data ? <Loading /> : (
        <>
          <Notice tone="neutral">{params.paymentId ? 'The payment is flagged and, if not yet verified, frozen until an officer other than you resolves it. Your note is kept in the audit trail.' : 'Officers will see this and reply. If it is about a payment, choose it so they can check it.'}</Notice>
          {params.label ? <Notice tone="blue" icon="receipt-outline">{params.label}</Notice> : myPayments.length > 0 && (
            <>
              <Chips value={paymentId} onChange={setPaymentId} options={[{ value: '', label: 'Not about a payment' }, ...myPayments.map((p) => ({ value: p.id, label: `${kes(p.amountCents, true)} · ${p.reference ?? LABELS.paymentMethod[p.method]}` }))]} />
            </>
          )}
          <Field label="Subject" value={subject} onChangeText={setSubject} placeholder={params.paymentId ? 'e.g. Amount does not match receipt' : 'e.g. My October payment is missing'} />
          <Field label="Details" value={details} onChangeText={setDetails} multiline placeholder="What happened, amounts, dates, transaction codes" />
          <Button title="Send" onPress={() => open.mutate(undefined)} disabled={subject.trim().length < 3 || details.trim().length < 5} loading={open.isPending} />
          {officers.length > 0 && (
            <Section title="Group officers" style={{ marginTop: space.xl }}>
              {officers.map((o, i) => (
                <Row key={o.membershipId} icon="call-outline" title={o.fullName} subtitle={`${LABELS.groupRole[o.role]}${o.phone.includes('*') ? '' : ` · ${o.phone}`}`} onPress={o.phone.includes('*') ? undefined : () => Linking.openURL(`tel:${o.phone}`)} last={i === officers.length - 1} />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
