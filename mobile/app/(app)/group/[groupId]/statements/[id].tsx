import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { GroupStatement } from '@chamahub/shared';
import { Button, ErrorView, Loading, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { downloadPdf } from '@/lib/download';
import { date, kes } from '@/lib/format';
import { space } from '@/theme';

export default function StatementDetail() {
  const { groupId, id } = useLocalSearchParams<{ groupId: string; id: string }>();
  const s = useQuery({ queryKey: ['statement', groupId, id], queryFn: () => api<GroupStatement>(`groups/${groupId}/statements/${id}`) });
  const [busy, setBusy] = useState(false);
  const d = s.data;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Statement' }} />
      {s.error ? <ErrorView error={s.error} onRetry={s.refetch} /> : !d ? <Loading /> : (
        <>
          <T variant="heading">{d.groupName}</T>
          <T variant="small" style={{ marginBottom: space.lg }}>{`${date(d.from)} – ${date(d.to)}`}</T>
          <Section title="Summary">
            <Row title="Opening balance" right={kes(d.openingBalanceCents)} />
            <Row title="Contributions received" right={kes(d.contributionsCents)} />
            <Row title="Loan repayments" right={kes(d.loanRepaymentsCents)} />
            <Row title="Interest received" right={kes(d.interestReceivedCents)} />
            <Row title="Fines received" right={kes(d.finesReceivedCents)} />
            <Row title="Other income" right={kes(d.otherIncomeCents)} />
            <Row title="Expenses" right={`(${kes(d.expensesCents)})`} />
            <Row title="Loans disbursed" right={`(${kes(d.loansDisbursedCents)})`} />
            <Row title="Rotation payouts" right={`(${kes(d.payoutsCents)})`} />
            <Row title="Distributions" right={`(${kes(d.distributionsCents)})`} />
            <Row title="Closing balance" right={kes(d.closingBalanceCents)} />
            <Row title="Loans outstanding" subtitle="Owed to the group — not cash" right={kes(d.loansOutstandingCents)} last />
          </Section>
          <Section title={`Transactions (${d.transactions.length})`}>
            {d.transactions.slice(-60).reverse().map((t, i, arr) => (
              <Row key={t.id} title={t.type} subtitle={`${date(t.date)}${t.memberName ? ` · ${t.memberName}` : ''}${t.reference ? ` · ${t.reference}` : ''}`} right={t.inflowCents ? `+${kes(t.inflowCents)}` : `-${kes(t.outflowCents)}`} rightSub={`Bal ${kes(t.balanceCents, true)}`} last={i === arr.length - 1} />
            ))}
          </Section>
          <Button title="Download PDF" icon="download-outline" loading={busy} onPress={async () => { setBusy(true); await downloadPdf(`groups/${groupId}/statements/${id}/pdf`, `statement-${d.from}-${d.to}.pdf`); setBusy(false); }} />
        </>
      )}
    </Screen>
  );
}
