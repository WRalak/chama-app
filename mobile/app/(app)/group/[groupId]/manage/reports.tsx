import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { addMonths, GroupStatement, Permission, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, ErrorView, KV, Loading, NoAccess, Notice, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { downloadCsv, downloadPdf } from '@/lib/download';
import { date, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

type Period = 'month' | 'quarter' | 'year';

const EXPORTS: { name: string; title: string; perm?: Permission }[] = [
  { name: 'contributions', title: 'Contributions' },
  { name: 'cashbook', title: 'Cash book' },
  { name: 'payouts', title: 'Payout schedule & history' },
  { name: 'loan-portfolio', title: 'Loan portfolio' },
  { name: 'repayments', title: 'Loan repayments' },
  { name: 'expenses', title: 'Expenses' },
  { name: 'fines', title: 'Fines' },
  { name: 'income-expenditure', title: 'Income & expenditure' },
  { name: 'audit', title: 'Audit report', perm: Permission.AUDIT_VIEW },
];

/** Live statements from the ledger, publishing, PDF and CSV exports — all shareable from the phone. */
export default function Reports() {
  const { groupId, group, can } = useGroupAccess();
  const P = Permission;
  const t = todayInNairobi();
  const [period, setPeriod] = useState<Period>('month');
  const from = period === 'month' ? `${t.slice(0, 7)}-01` : period === 'quarter' ? addMonths(`${t.slice(0, 7)}-01`, -2) : `${t.slice(0, 4)}-01-01`;
  const live = useQuery({ queryKey: ['statement-live', groupId, from, t], queryFn: () => api<GroupStatement>(`groups/${groupId}/statements/live`, { query: { from, to: t } }), enabled: can(P.REPORTS_VIEW) });
  const publish = useAct(() => api(`groups/${groupId}/statements/publish`, { body: { from, to: t } }), { invalidate: [['statements', groupId]], successMessage: 'Published. Members can now see this statement.' });
  if (group.data && !can(P.REPORTS_VIEW) && !can(P.STATEMENTS_VIEW)) return <Screen><Stack.Screen options={{ title: 'Reports' }} /><NoAccess what="reports" /></Screen>;
  const s = live.data;
  const inflow = s ? s.contributionsCents + s.loanRepaymentsCents + s.interestReceivedCents + s.finesReceivedCents + s.otherIncomeCents : 0;
  const outflow = s ? s.expensesCents + s.loansDisbursedCents + s.payoutsCents + s.distributionsCents : 0;
  const balanced = s ? s.openingBalanceCents + inflow - outflow === s.closingBalanceCents : true;
  const suffix = `${from}-to-${t}`;
  return (
    <Screen refreshing={live.isRefetching} onRefresh={live.refetch}>
      <Stack.Screen options={{ title: 'Reports & statements' }} />
      <Section>
        <Row icon="document-text-outline" title="Published statements" subtitle="What members see" onPress={() => router.push(`/(app)/group/${groupId}/statements` as never)} last />
      </Section>
      {can(P.REPORTS_VIEW) && (
        <>
          <Chips value={period} onChange={setPeriod} options={[{ value: 'month', label: 'This month' }, { value: 'quarter', label: 'Last 3 months' }, { value: 'year', label: 'This year' }]} />
          {live.error ? <ErrorView error={live.error} onRetry={live.refetch} /> : !s ? <Loading /> : (
            <>
              <Section title={`Statement · ${date(from)} – ${date(t)}`}>
                <KV label="Opening balance" value={kes(s.openingBalanceCents)} />
                <KV label="Contributions" value={kes(s.contributionsCents)} />
                <KV label="Loan repayments" value={kes(s.loanRepaymentsCents)} />
                <KV label="Interest and fines" value={kes(s.interestReceivedCents + s.finesReceivedCents)} />
                <KV label="Other income" value={kes(s.otherIncomeCents)} />
                <KV label="Payouts" value={`−${kes(s.payoutsCents)}`} />
                <KV label="Loans disbursed" value={`−${kes(s.loansDisbursedCents)}`} />
                <KV label="Expenses" value={`−${kes(s.expensesCents)}`} />
                <KV label="Distributions" value={`−${kes(s.distributionsCents)}`} />
                <KV label="Closing balance" value={kes(s.closingBalanceCents)} />
                <KV label="Loans outstanding" value={kes(s.loansOutstandingCents)} last />
              </Section>
              {!balanced && <Notice tone="red" icon="alert-circle-outline">Opening plus movements does not equal closing. Do not publish; raise it with the treasurer and auditor.</Notice>}
              <Button title="Download PDF" icon="download-outline" variant="secondary" onPress={() => downloadPdf(`groups/${groupId}/statements/live.pdf?from=${from}&to=${t}`, `statement-${suffix}.pdf`)} style={{ marginBottom: space.sm }} />
              {can(P.STATEMENTS_PUBLISH) && <Button title="Publish to members" icon="megaphone-outline" onPress={() => askToConfirm('Publish this statement?', 'All members will be able to see it. Published statements cannot be edited.', 'Publish', () => publish.mutate(undefined))} disabled={!balanced} loading={publish.isPending} style={{ marginBottom: space.xl }} />}
            </>
          )}
          <Section title="Exports (CSV)">
            {EXPORTS.filter((e) => !e.perm || can(e.perm)).map((e, i, arr) => (
              <Row key={e.name} icon="share-outline" title={e.title} subtitle={`${date(from)} – ${date(t)}`} onPress={() => downloadCsv(`groups/${groupId}/reports/${e.name}?format=csv&from=${from}&to=${t}`, `${e.name}-${suffix}.csv`)} last={i === arr.length - 1} />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
