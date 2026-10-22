import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { LABELS, ObligationItem, Paginated, PaymentItem } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Loading, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { space } from '@/theme';

export default function Contributions() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const [filter, setFilter] = useState<'outstanding' | 'all' | 'payments'>('outstanding');
  const obligations = useQuery({ queryKey: ['my-obligations', groupId], queryFn: () => api<ObligationItem[]>('me/obligations', { query: { groupId, from: '2000-01-01' } }) });
  const payments = useQuery({ queryKey: ['my-payments', groupId], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { pageSize: 100 } }) });
  const list = (obligations.data ?? []).filter((o) => (filter === 'outstanding' ? o.outstandingCents > 0 : true)).reverse();
  const outstanding = (obligations.data ?? []).reduce((a, o) => a + (o.dueDate <= new Date().toISOString().slice(0, 10) ? o.outstandingCents : 0), 0);

  return (
    <Screen refreshing={obligations.isRefetching} onRefresh={() => { obligations.refetch(); payments.refetch(); }}>
      <Stack.Screen options={{ title: 'My contributions' }} />
      <T variant="small">Outstanding now</T>
      <T variant="amount" style={{ color: outstanding ? '#DC2626' : '#15803D', marginBottom: space.md }}>{kes(outstanding)}</T>
      <Button title="Make a contribution" onPress={() => router.push(`/(app)/group/${groupId}/pay`)} style={{ marginBottom: space.lg }} />
      <Chips value={filter} onChange={setFilter} options={[{ value: 'outstanding', label: 'Outstanding' }, { value: 'all', label: 'All periods' }, { value: 'payments', label: 'My payments' }]} />
      {filter !== 'payments' ? (
        obligations.error ? <ErrorView error={obligations.error} onRetry={obligations.refetch} /> : !obligations.data ? <Loading /> : (
          <Section>
            {list.length === 0 ? <Empty title={filter === 'outstanding' ? 'You are fully paid up' : 'No contributions yet'} icon="checkmark-done-outline" /> : list.map((o, i) => (
              <Row key={o.id} title={o.periodLabel} subtitle={`${o.scheduleName} · due ${date(o.dueDate)}${o.pendingCents ? ` · ${kes(o.pendingCents)} awaiting verification` : ''}`} right={`${kes(o.paidCents, true)} / ${kes(o.amountCents, true)}`} rightSub={<StatusBadge status={o.status} />} last={i === list.length - 1} />
            ))}
          </Section>
        )
      ) : payments.error ? <ErrorView error={payments.error} onRetry={payments.refetch} /> : !payments.data ? <Loading /> : (
        <Section>
          {payments.data.items.length === 0 ? <Empty title="No payments recorded yet" /> : payments.data.items.map((p, i) => (
            <Row
              key={p.id}
              title={`${kes(p.amountCents)} · ${p.purpose === 'CONTRIBUTION' ? 'Contribution' : p.purpose === 'LOAN_REPAYMENT' ? 'Loan repayment' : 'Fine'}`}
              subtitle={`${date(p.paidAt)} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''}`}
              rightSub={<StatusBadge status={p.status} />}
              onPress={() => router.push(`/(app)/group/${groupId}/payments/${p.id}`)}
              last={i === payments.data!.items.length - 1}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
