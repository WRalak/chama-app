import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { FineRow, LoanSummary, MemberRow, parseKes, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Field, KV, Loading, NoAccess, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { kes, newKey } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

type Purpose = 'CONTRIBUTION' | 'LOAN_REPAYMENT' | 'FINE';
type Method = 'CASH' | 'MPESA' | 'BANK_TRANSFER';

/**
 * Manual entry of money received. It is saved as PENDING and counts only when
 * a second officer verifies it; it is labelled as manual, never as
 * provider-confirmed. Evidence and the recorder are kept with the entry.
 */
export default function RecordPayment() {
  const params = useLocalSearchParams<{ memberId?: string; targetId?: string; amount?: string; label?: string }>();
  const { groupId, group, can } = useGroupAccess();
  const P = Permission;
  const purposes = [
    ...(can(P.CONTRIBUTIONS_RECORD) ? [{ value: 'CONTRIBUTION' as const, label: 'Contribution' }] : []),
    ...(can(P.REPAYMENTS_RECORD) && group.data?.loanPolicy.enabled ? [{ value: 'LOAN_REPAYMENT' as const, label: 'Loan repayment' }] : []),
    ...(can(P.FINES_MANAGE) ? [{ value: 'FINE' as const, label: 'Fine' }] : []),
  ];
  const [purpose, setPurpose] = useState<Purpose>('CONTRIBUTION');
  const [memberId, setMemberId] = useState(params.memberId ?? '');
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState(params.amount ? String(Number(params.amount) / 100) : '');
  const [method, setMethod] = useState<Method>('CASH');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(todayInNairobi());
  const [evidence, setEvidence] = useState('');
  const [targetId, setTargetId] = useState(params.targetId ?? '');
  const [review, setReview] = useState(false);
  const [key] = useState(newKey);
  const members = useQuery({ queryKey: ['members', groupId, 'ACTIVE'], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status: 'ACTIVE' } }) });
  const loans = useQuery({ queryKey: ['loans', groupId, 'member', memberId], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { memberId, status: 'DISBURSED' } }), enabled: purpose === 'LOAN_REPAYMENT' && !!memberId });
  const fines = useQuery({ queryKey: ['fines', groupId], queryFn: () => api<FineRow[]>(`groups/${groupId}/fines`), enabled: purpose === 'FINE' });
  const member = members.data?.find((m) => m.membershipId === memberId);
  const shown = useMemo(() => (members.data ?? []).filter((m) => !search || m.fullName.toLowerCase().includes(search.toLowerCase())).slice(0, 12), [members.data, search]);
  let cents: number | null = null;
  try {
    cents = amount ? parseKes(amount) : null;
  } catch {
    cents = null;
  }
  const needsRef = method !== 'CASH';
  const memberFines = (fines.data ?? []).filter((f) => f.membershipId === memberId && ['OUTSTANDING', 'PARTIAL'].includes(f.status));
  const valid = !!memberId && !!cents && cents > 0 && (!needsRef || reference.trim().length >= 4) && evidence.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(paidAt) && paidAt <= todayInNairobi() && (purpose === 'CONTRIBUTION' || !!targetId);
  const record = useAct(
    () => api(`groups/${groupId}/payments`, { body: { memberId, amountCents: cents, method, reference: reference.trim() || undefined, paidAt, purpose, targetId: targetId || undefined, notes: evidence.trim(), idempotencyKey: key } }),
    { invalidate: [['payments', groupId], ['ledger', groupId], ['group-dashboard', groupId], ['reconciliation', groupId]], successMessage: 'Recorded as pending. It counts once another officer verifies it.', onSuccess: () => router.back() },
  );

  if (group.data && purposes.length === 0) return <Screen><Stack.Screen options={{ title: 'Record payment' }} /><NoAccess what="recording payments" /></Screen>;
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: review ? 'Check and confirm' : 'Record payment' }} />
      {!group.data || !members.data ? <Loading /> : review ? (
        <>
          <Notice tone="amber" icon="hourglass-outline">This is saved as a manual entry awaiting verification. It does not count as received until another officer confirms the money is in the group's account or cash box.</Notice>
          <Section title="You are recording">
            <KV label="Member" value={member?.fullName ?? ''} />
            <KV label="Amount" value={kes(cents)} />
            <KV label="For" value={purposes.find((p) => p.value === purpose)?.label ?? ''} />
            {params.label && purpose === 'CONTRIBUTION' && targetId === params.targetId && <KV label="Applied to" value={params.label} />}
            <KV label="Method" value={method === 'MPESA' ? 'M-Pesa (manual entry)' : method === 'BANK_TRANSFER' ? 'Bank transfer' : 'Cash'} />
            {reference ? <KV label="Reference" value={reference.toUpperCase()} /> : null}
            <KV label="Date received" value={paidAt} />
            <KV label="Evidence" value={evidence} last />
          </Section>
          <Button title="Record as pending" onPress={() => record.mutate(undefined)} loading={record.isPending} />
          <Button title="Go back and edit" variant="ghost" onPress={() => setReview(false)} style={{ marginTop: space.sm }} />
        </>
      ) : (
        <>
          {purposes.length > 1 && <Chips value={purpose} onChange={(v) => { setPurpose(v); setTargetId(''); }} options={purposes} />}
          <Section title="Member">
            <View style={{ padding: space.md }}>
              {member ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <T variant="label">{member.fullName}</T>
                  {!params.memberId && <Button title="Change" variant="ghost" onPress={() => setMemberId('')} />}
                </View>
              ) : (
                <>
                  <Field label="Search members" value={search} onChangeText={setSearch} placeholder="Type a name" />
                  <Chips value={memberId} onChange={setMemberId} options={shown.map((m) => ({ value: m.membershipId, label: m.fullName }))} />
                </>
              )}
            </View>
          </Section>
          {purpose === 'LOAN_REPAYMENT' && memberId && (
            <>
              <T variant="label" style={{ marginBottom: 6 }}>Loan being repaid</T>
              {loans.data?.length ? <Chips value={targetId} onChange={setTargetId} options={loans.data.map((l) => ({ value: l.id, label: `${kes(l.principalCents, true)} · owes ${kes(l.outstandingCents, true)}` }))} /> : <Notice tone="neutral">This member has no disbursed loan.</Notice>}
            </>
          )}
          {purpose === 'FINE' && memberId && (
            <>
              <T variant="label" style={{ marginBottom: 6 }}>Fine being paid</T>
              {memberFines.length ? <Chips value={targetId} onChange={setTargetId} options={memberFines.map((f) => ({ value: f.id, label: `${f.reason} · ${kes(f.amountCents - f.paidCents, true)}` }))} /> : <Notice tone="neutral">This member has no outstanding fine.</Notice>}
            </>
          )}
          {params.label && purpose === 'CONTRIBUTION' && <Notice tone="neutral">{`Applied to ${params.label}`}</Notice>}
          <Field label="Amount received" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === null ? 'Enter a valid amount' : undefined} />
          <T variant="label" style={{ marginBottom: 6 }}>How was it paid?</T>
          <Chips value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK_TRANSFER', label: 'Bank' }]} />
          {needsRef && <Field label={method === 'MPESA' ? 'M-Pesa transaction code' : 'Bank reference'} autoCapitalize="characters" value={reference} onChangeText={setReference} hint="Required, so the payment can be checked against the statement." />}
          <Field label="Date received" value={paidAt} onChangeText={setPaidAt} placeholder="YYYY-MM-DD" error={paidAt > todayInNairobi() ? 'Cannot be in the future' : undefined} />
          <Field label="Evidence" value={evidence} onChangeText={setEvidence} multiline placeholder={method === 'CASH' ? 'Receipt book no. 214; handed over at the meeting' : 'e.g. Seen on the group M-Pesa statement'} hint="Who handed it over, receipt number, or where you checked it." />
          <Button title="Review" onPress={() => setReview(true)} disabled={!valid} />
        </>
      )}
    </Screen>
  );
}
