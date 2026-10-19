import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { LABELS, LoanDetail } from '@chamahub/shared';
import { Button, ErrorView, Loading, Notice, Row, Screen, Section, Stat, StatGrid, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { date, dateTime, kes } from '@/lib/format';
import { useAct } from '@/lib/queries';

export default function LoanScreen() {
  const { groupId, loanId } = useLocalSearchParams<{ groupId: string; loanId: string }>();
  const loan = useQuery({ queryKey: ['loan', groupId, loanId], queryFn: () => api<LoanDetail>(`groups/${groupId}/loans/${loanId}`) });
  const cancel = useAct(() => api(`groups/${groupId}/loans/${loanId}/cancel`, { method: 'POST' }), { invalidate: [['loan', groupId, loanId], ['loans', groupId, 'mine']] });
  const l = loan.data;
  return (
    <Screen refreshing={loan.isRefetching} onRefresh={loan.refetch}>
      <Stack.Screen options={{ title: 'Loan' }} />
      {loan.error ? <ErrorView error={loan.error} onRetry={loan.refetch} /> : !l ? <Loading /> : (
        <>
          <StatGrid>
            <Stat label="Principal" value={kes(l.principalCents, true)} />
            <Stat label="Interest" value={kes(l.interestCents, true)} />
            <Stat label="Paid" value={kes(l.paidCents, true)} tone="success" />
            <Stat label="Outstanding" value={kes(l.outstandingCents, true)} tone={l.overdueCents ? 'danger' : undefined} sub={l.overdueCents ? `${kes(l.overdueCents, true)} overdue` : undefined} />
          </StatGrid>
          {l.status === 'PENDING_APPROVAL' && <Notice tone="amber" icon="time-outline">{`Waiting for approval: ${l.approvalsReceived} of ${l.approvalsRequired}.`}</Notice>}
          {l.status === 'APPROVED' && <Notice tone="green" icon="checkmark-circle-outline">Approved. The treasurer will disburse it and set your repayment dates.</Notice>}
          <Section title="Details">
            <Row title="Status" rightSub={<StatusBadge status={l.status} />} />
            <Row title="Purpose" right={l.purpose} />
            <Row title="Interest method" right={LABELS.interestMethod[l.interestMethod]} />
            <Row title="Rate" right={`${(l.rateBps / 100).toFixed(2)}%`} />
            <Row title="Disbursed" right={l.disbursedAt ? date(l.disbursedAt) : '—'} rightSub={l.disbursementReference ?? undefined} last />
          </Section>
          {l.schedule.length > 0 && (
            <Section title="Repayment schedule">
              {l.schedule.map((i, idx) => <Row key={i.id} title={`Installment ${i.number} · ${date(i.dueDate)}`} subtitle={`Paid ${kes(i.paidCents)}`} right={kes(i.totalCents)} rightSub={<StatusBadge status={i.status} />} last={idx === l.schedule.length - 1} />)}
            </Section>
          )}
          {l.repayments.length > 0 && (
            <Section title="Repayment history">
              {l.repayments.map((p, idx) => <Row key={p.id} title={kes(p.amountCents)} subtitle={`${date(p.paidAt)}${p.reference ? ` · ${p.reference}` : ''}`} rightSub={<StatusBadge status={p.status} />} last={idx === l.repayments.length - 1} />)}
            </Section>
          )}
          {l.approvals.length > 0 && (
            <Section title="Approvals">
              {l.approvals.map((a, idx) => <Row key={a.id} title={a.approverName} subtitle={`${LABELS.groupRole[a.approverRole]} · ${dateTime(a.createdAt)}${a.comment ? ` · ${a.comment}` : ''}`} rightSub={<StatusBadge status={a.decision} />} last={idx === l.approvals.length - 1} />)}
            </Section>
          )}
          {['PENDING_APPROVAL', 'APPROVED'].includes(l.status) && <Button title="Cancel application" variant="secondary" onPress={() => cancel.mutate(undefined)} loading={cancel.isPending} />}
        </>
      )}
    </Screen>
  );
}
