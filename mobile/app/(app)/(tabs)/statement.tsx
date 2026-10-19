import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { addMonths, LABELS, PersonalStatement, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, ErrorView, Loading, Notice, Row, Screen, Section, Stat, StatGrid, T } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { downloadPdf } from '@/lib/download';
import { date, kes } from '@/lib/format';
import { space } from '@/theme';

const PERIODS = { '3m': 3, '6m': 6, '12m': 12, ytd: 0 } as const;

export default function Statement() {
  const t = todayInNairobi();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('12m');
  const from = period === 'ytd' ? `${t.slice(0, 4)}-01-01` : addMonths(t, -PERIODS[period]);
  const s = useQuery({ queryKey: ['statement', from, t], queryFn: () => api<PersonalStatement>('me/statement', { query: { from, to: t } }) });
  const [busy, setBusy] = useState(false);

  async function exportPdf() {
    setBusy(true);
    await downloadPdf(`me/statement/pdf${qs({ from, to: t })}`, `chamahub-statement-${from}-${t}.pdf`);
    setBusy(false);
  }

  const tot = s.data?.totals;
  return (
    <Screen refreshing={s.isRefetching} onRefresh={s.refetch}>
      <Chips value={period} onChange={setPeriod} options={[{ value: '3m', label: '3 months' }, { value: '6m', label: '6 months' }, { value: '12m', label: '12 months' }, { value: 'ytd', label: 'This year' }]} />
      <T variant="small" style={{ marginBottom: space.md }}>{`${date(from)} – ${date(t)} · all your Chamas`}</T>
      {s.error ? <ErrorView error={s.error} onRetry={s.refetch} /> : !s.data || !tot ? <Loading /> : (
        <>
          <StatGrid>
            <Stat label="Contributions paid" value={kes(tot.contributionsCents, true)} tone="success" />
            <Stat label="Outstanding" value={kes(tot.outstandingContributionsCents, true)} tone={tot.outstandingContributionsCents ? 'danger' : undefined} />
            <Stat label="Loans received" value={kes(tot.loansReceivedCents, true)} sub="Borrowed, not income" />
            <Stat label="Loan repayments" value={kes(tot.loanRepaymentsCents + tot.interestPaidCents, true)} sub={`incl. ${kes(tot.interestPaidCents, true)} interest`} />
            <Stat label="Payouts received" value={kes(tot.payoutsReceivedCents, true)} />
            <Stat label="Distributions" value={kes(tot.distributionsReceivedCents, true)} />
          </StatGrid>
          {s.data.groups.map((g) => (
            <Section key={g.groupId} title={g.groupName}>
              <Row title="Your role" right={LABELS.groupRole[g.role]} />
              <Row title="Contributions paid" right={kes(g.contributionsCents)} />
              <Row title="Outstanding contributions" right={kes(g.outstandingContributionsCents)} />
              {(g.loansReceivedCents > 0 || g.loanBalanceCents > 0) && <Row title="Loans received" right={kes(g.loansReceivedCents)} />}
              {(g.loanRepaymentsCents > 0 || g.interestPaidCents > 0) && <Row title="Loan principal repaid" right={kes(g.loanRepaymentsCents)} rightSub={`Interest ${kes(g.interestPaidCents)}`} />}
              {g.loanBalanceCents > 0 && <Row title="Current loan balance" right={kes(g.loanBalanceCents)} />}
              {g.finesPaidCents > 0 && <Row title="Fines paid" right={kes(g.finesPaidCents)} />}
              {g.payoutsReceivedCents > 0 && <Row title="Payouts received" right={kes(g.payoutsReceivedCents)} />}
              {g.distributionsReceivedCents > 0 && <Row title="Distributions received" right={kes(g.distributionsReceivedCents)} />}
              <Row title="Shares held" right={String(g.shares)} last />
            </Section>
          ))}
          {s.data.upcoming.length > 0 && (
            <Section title="Upcoming obligations">
              {s.data.upcoming.slice(0, 10).map((u, i, arr) => <Row key={u.id} title={u.groupName} subtitle={`${u.periodLabel} · due ${date(u.dueDate)}`} right={kes(u.outstandingCents)} last={i === arr.length - 1} />)}
            </Section>
          )}
          {s.data.notes.map((n) => <Notice key={n} tone="neutral">{n}</Notice>)}
          <View style={{ height: space.sm }} />
          <Button title="Download PDF" icon="download-outline" onPress={exportPdf} loading={busy} />
        </>
      )}
    </Screen>
  );
}
