import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { LABELS, PaymentItem } from '@chamahub/shared';
import { Empty, ErrorView, Loading, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';

export default function Payments() {
  const list = useQuery({ queryKey: ['my-payments-all'], queryFn: () => api<PaymentItem[]>('me/payments', { query: { limit: 200 } }) });
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Payment history' }} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section>
          {list.data.length === 0 ? <Empty title="No payments yet" /> : list.data.map((p, i) => (
            <Row key={p.id} title={`${kes(p.amountCents)} · ${p.groupName}`} subtitle={`${date(p.paidAt)} · ${p.purpose.replace('_', ' ').toLowerCase()} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''}`} rightSub={<StatusBadge status={p.status} />} last={i === list.data!.length - 1} />
          ))}
        </Section>
      )}
    </Screen>
  );
}
