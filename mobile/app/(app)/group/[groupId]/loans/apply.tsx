import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { LoanQuote, parseKes } from '@chamahub/shared';
import { Button, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { space } from '@/theme';

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function ApplyLoan() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const [amount, setAmount] = useState('5000');
  const [installments, setInstallments] = useState('3');
  const [purpose, setPurpose] = useState('');
  let cents: number | null = null;
  try {
    cents = parseKes(amount);
  } catch {
    cents = null;
  }
  const n = Number(installments);
  const dc = useDebounced(cents);
  const dn = useDebounced(n);
  const quote = useQuery({ queryKey: ['quote', groupId, dc, dn], queryFn: () => api<LoanQuote>(`groups/${groupId}/loans/quote`, { query: { principalCents: dc, installments: dn } }), enabled: !!dc && dc > 0 && Number.isInteger(dn) && dn >= 1 });
  const apply = useAct(() => api<{ id: string }>(`groups/${groupId}/loans`, { body: { principalCents: cents, installments: n, purpose, guarantorMemberIds: [] } }), {
    invalidate: [['loans', groupId, 'mine'], ['dashboard']],
    onSuccess: (l) => router.replace(`/(app)/group/${groupId}/loans/${l.id}`),
  });
  const q = quote.data;
  const elig = q?.eligibility;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Loan calculator' }} />
      <Field label="Amount to borrow" prefix="KES" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} error={amount && cents === null ? 'Enter a valid amount' : undefined} />
      <Field label="Number of installments" keyboardType="number-pad" value={installments} onChangeText={(t) => setInstallments(t.replace(/\D/g, ''))} hint={group.data ? `Up to ${group.data.loanPolicy.maxInstallments}` : undefined} />
      {quote.isFetching && !q ? <Loading /> : quote.error ? <Notice tone="red">{(quote.error as Error).message}</Notice> : q && (
        <>
          {elig && !elig.eligible && <Notice tone="red" icon="alert-circle-outline">{elig.reasons.join(' ')}</Notice>}
          {elig?.limitCents !== null && elig?.limitCents !== undefined && <T variant="small" style={{ marginBottom: space.sm }}>{`Your current limit: ${kes(elig.limitCents)}`}</T>}
          <Section title="Repayment">
            <Row title="Interest" right={kes(q.totalInterestCents)} />
            <Row title="Total to repay" right={kes(q.totalRepayableCents)} last />
          </Section>
          <Section title="Schedule (estimated)">
            {q.installments.map((i, idx) => (
              <Row key={i.number} title={`Installment ${i.number}`} subtitle={`${date(i.dueDate)} · principal ${kes(i.principalCents, true)} + interest ${kes(i.interestCents, true)}`} right={kes(i.totalCents)} last={idx === q.installments.length - 1} />
            ))}
          </Section>
          <T variant="small" style={{ marginBottom: space.lg }}>Final dates are set when the treasurer disburses the loan.</T>
        </>
      )}
      <Field label="What is the loan for?" value={purpose} onChangeText={setPurpose} placeholder="e.g. School fees" />
      <Button title="Submit application" onPress={() => apply.mutate(undefined)} loading={apply.isPending} disabled={!elig?.eligible || purpose.trim().length < 3 || !cents} />
      <T variant="small" style={{ marginTop: space.sm }}>Officers review and approve applications. You cannot approve your own loan.</T>
    </Screen>
  );
}
