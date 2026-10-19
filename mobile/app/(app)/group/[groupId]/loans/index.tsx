import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { LABELS, LoanSummary } from '@chamahub/shared';
import { Button, Empty, ErrorView, Loading, Notice, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useGroup } from '@/lib/queries';
import { space } from '@/theme';

export default function Loans() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const loans = useQuery({ queryKey: ['loans', groupId, 'mine'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { memberId: group.data?.myMembership.membershipId } }), enabled: !!group.data });
  const mine = (loans.data ?? []).filter((l) => l.membershipId === group.data?.myMembership.membershipId);
  const policy = group.data?.loanPolicy;
  return (
    <Screen refreshing={loans.isRefetching} onRefresh={loans.refetch}>
      <Stack.Screen options={{ title: 'Loans' }} />
      {policy && (
        <Notice tone="neutral" icon="calculator-outline">{`${LABELS.interestMethod[policy.interestMethod]} at ${(policy.rateBps / 100).toFixed(2)}%${policy.interestMethod === 'ONE_OFF' ? '' : ' per period'}, up to ${policy.maxInstallments} ${LABELS.frequency[policy.repaymentFrequency].toLowerCase()} installments. Loans need ${policy.requiredApprovals} officer approval${policy.requiredApprovals > 1 ? 's' : ''}.`}</Notice>
      )}
      {policy?.enabled ? <Button title="Calculate or apply for a loan" icon="add-circle-outline" onPress={() => router.push(`/(app)/group/${groupId}/loans/apply`)} style={{ marginBottom: space.xl }} /> : group.data && <Notice tone="amber">This group does not offer loans.</Notice>}
      {loans.error ? <ErrorView error={loans.error} onRetry={loans.refetch} /> : !loans.data ? <Loading /> : (
        <Section title="My loans">
          {mine.length === 0 ? <Empty title="No loans yet" icon="cash-outline" /> : mine.map((l, i) => (
            <Row
              key={l.id}
              title={`${kes(l.principalCents)} · ${l.purpose}`}
              subtitle={l.status === 'DISBURSED' ? (l.nextInstallment ? `Next ${kes(l.nextInstallment.amountCents)} on ${date(l.nextInstallment.dueDate)}` : 'Fully scheduled') : l.status === 'PENDING_APPROVAL' ? `${l.approvalsReceived}/${l.approvalsRequired} approvals` : `Applied ${date(l.appliedAt)}`}
              right={l.status === 'DISBURSED' ? kes(l.outstandingCents) : undefined}
              rightSub={<StatusBadge status={l.overdueCents ? 'OVERDUE' : l.status} />}
              onPress={() => router.push(`/(app)/group/${groupId}/loans/${l.id}`)}
              last={i === mine.length - 1}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
