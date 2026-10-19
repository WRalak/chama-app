import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { LABELS, LoanSummary, MemberRow, Paginated, parseKes, PaymentItem, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Empty, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes, newKey } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { colors, space } from '@/theme';

/** The officer essentials on a phone. Full administration lives in the web dashboard. */
export default function Manage() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const perms = group.data?.myMembership.permissions ?? [];
  const can = (p: Permission) => perms.includes(p);
  const [tab, setTab] = useState<'verify' | 'loans' | 'record'>('verify');
  const inv = [['manage', groupId], ['dashboard'], ['groups']];
  const pending = useQuery({ queryKey: ['manage', groupId, 'payments'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 50 } }), enabled: can(Permission.CONTRIBUTIONS_VERIFY) });
  const loans = useQuery({ queryKey: ['manage', groupId, 'loans'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.LOANS_APPROVE) });
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }), enabled: can(Permission.CONTRIBUTIONS_RECORD) });
  const verify = useAct(({ id, decision }: { id: string; decision: 'CONFIRM' | 'FAIL' }) => api(`groups/${groupId}/payments/${id}/verify`, { body: { decision } }), { invalidate: inv });
  const decide = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/loans/${id}/decision`, { body: { decision } }), { invalidate: inv });

  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'MPESA'>('CASH');
  const [reference, setReference] = useState('');
  const [key, setKey] = useState(newKey);
  let cents: number | null = null;
  try {
    cents = amount ? parseKes(amount) : null;
  } catch {
    cents = null;
  }
  const record = useAct(() => api(`groups/${groupId}/payments`, { body: { memberId, amountCents: cents, method, reference: reference || undefined, paidAt: todayInNairobi(), purpose: 'CONTRIBUTION', idempotencyKey: key } }), {
    invalidate: inv,
    successMessage: 'Recorded as pending. Another officer must verify it.',
    onSuccess: () => { setAmount(''); setReference(''); setKey(newKey()); },
  });

  const tabs = [
    ...(can(Permission.CONTRIBUTIONS_VERIFY) ? [{ value: 'verify' as const, label: `Verify (${pending.data?.total ?? 0})` }] : []),
    ...(can(Permission.LOANS_APPROVE) ? [{ value: 'loans' as const, label: `Loans (${loans.data?.length ?? 0})` }] : []),
    ...(can(Permission.CONTRIBUTIONS_RECORD) ? [{ value: 'record' as const, label: 'Record cash' }] : []),
  ];
  const confirm = (p: PaymentItem) =>
    Alert.alert('Confirm payment?', `${kes(p.amountCents)} from ${p.memberName}${p.reference ? `, ref ${p.reference}` : ''}.\n\nOnly confirm once you have checked the money is in the group account or cash box.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Not received', style: 'destructive', onPress: () => verify.mutate({ id: p.id, decision: 'FAIL' }) },
      { text: 'Confirm', onPress: () => verify.mutate({ id: p.id, decision: 'CONFIRM' }) },
    ]);

  return (
    <Screen refreshing={pending.isRefetching} onRefresh={() => { pending.refetch(); loans.refetch(); }}>
      <Stack.Screen options={{ title: 'Officer tools' }} />
      {!group.data ? <Loading /> : tabs.length === 0 ? <Empty title="No officer actions for your role" /> : (
        <>
          <Chips value={tabs.some((t) => t.value === tab) ? tab : tabs[0].value} onChange={setTab} options={tabs} />
          {tab === 'verify' && (
            <Section title="Payments awaiting verification">
              {!pending.data ? <Loading /> : pending.data.items.length === 0 ? <Empty title="All caught up" icon="checkmark-done-outline" /> : pending.data.items.map((p, i) => (
                <Row key={p.id} title={`${p.memberName} · ${kes(p.amountCents)}`} subtitle={`${date(p.paidAt)} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''} · by ${p.recordedByName ?? 'M-Pesa'}`} onPress={() => confirm(p)} last={i === pending.data!.items.length - 1} />
              ))}
            </Section>
          )}
          {tab === 'loans' && (
            <Section title="Loan applications">
              {!loans.data ? <Loading /> : loans.data.length === 0 ? <Empty title="No applications waiting" /> : loans.data.map((l, i) => (
                <View key={l.id} style={{ padding: space.lg, borderBottomWidth: i === loans.data!.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <T variant="label">{`${l.memberName} · ${kes(l.principalCents)}`}</T>
                  <T variant="small">{`${l.purpose} · ${l.installments} installments · interest ${kes(l.interestCents)} · ${l.approvalsReceived}/${l.approvalsRequired} approvals`}</T>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Approve" onPress={() => decide.mutate({ id: l.id, decision: 'APPROVE' })} style={{ flex: 1 }} loading={decide.isPending} />
                    <Button title="Reject" variant="secondary" onPress={() => decide.mutate({ id: l.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
          {tab === 'record' && (
            <>
              <Notice tone="neutral">Records a contribution as pending. A second officer must verify it before it counts.</Notice>
              <T variant="label" style={{ marginBottom: 6 }}>Member</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
                {members.data?.map((m) => (
                  <Pressable key={m.membershipId} onPress={() => setMemberId(m.membershipId)} accessibilityRole="button" accessibilityState={{ selected: memberId === m.membershipId }} style={{ paddingHorizontal: space.md, minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: memberId === m.membershipId ? colors.forest : colors.border, backgroundColor: memberId === m.membershipId ? colors.forestTint : colors.white }}>
                    <T variant="label">{m.fullName}</T>
                  </Pressable>
                ))}
              </View>
              <Field label="Amount" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === null ? 'Enter a valid amount' : undefined} />
              <Chips value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'MPESA', label: 'M-Pesa' }]} />
              {method === 'MPESA' && <Field label="M-Pesa code" autoCapitalize="characters" value={reference} onChangeText={setReference} />}
              <Button title="Record payment" onPress={() => record.mutate(undefined)} loading={record.isPending} disabled={!memberId || !cents || cents <= 0 || (method === 'MPESA' && !reference)} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
