import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { addMonths, LABELS, PaymentItem, PersonalStatement, todayInNairobi } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Loading, MoneyCard, Notice, Row, Screen, Section, T, TransactionRow } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { downloadPdf } from '@/lib/download';
import { date, kes } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import { space } from '@/theme';

const PERIODS = { '3m': 3, '6m': 6, '12m': 12, ytd: 0 } as const;
const PURPOSE: Record<string, string> = { CONTRIBUTION: 'Contribution', LOAN_REPAYMENT: 'Loan repayment', FINE: 'Fine', OTHER: 'Other' };

/** Everything about the member's own money across their Chamas: payments, loans and the statement. */
export default function Finances() {
  const t = todayInNairobi();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('12m');
  const from = period === 'ytd' ? `${t.slice(0, 4)}-01-01` : addMonths(t, -PERIODS[period]);
  const s = useQuery({ queryKey: ['statement', from, t], queryFn: () => api<PersonalStatement>('me/statement', { query: { from, to: t } }) });
  const payments = useQuery({ queryKey: ['my-payments-all'], queryFn: () => api<PaymentItem[]>('me/payments', { query: { limit: 30 } }) });
  const dash = useDashboard();
  const [busy, setBusy] = useState(false);
  const pending = (payments.data ?? []).filter((p) => p.status === 'PENDING');
  const loans = (dash.data?.groups ?? []).filter((g) => g.loanBalanceCents > 0);
  const tot = s.data?.totals;

  async function exportPdf() {
    setBusy(true);
    await downloadPdf(`me/statement/pdf${qs({ from, to: t })}`, `chamahub-statement-${from}-${t}.pdf`);
    setBusy(false);
  }

  return (
    <Screen refreshing={s.isRefetching || payments.isRefetching} onRefresh={() => { s.refetch(); payments.refetch(); dash.refetch(); }}>
      <Chips value={period} onChange={setPeriod} options={[{ value: '3m', label: '3 months' }, { value: '6m', label: '6 months' }, { value: '12m', label: '12 months' }, { value: 'ytd', label: 'This year' }]} />
      {s.error ? <ErrorView error={s.error} onRetry={s.refetch} /> : !s.data || !tot ? <Loading label="Loading your statement…" /> : (
        <>
          <T variant="small" style={{ marginBottom: space.md }}>{`${date(from)} – ${date(t)} · all your Chamas · confirmed records only`}</T>
          <MoneyCard label="Contributions confirmed" icon="checkmark-circle-outline" amount={kes(tot.contributionsCents)} status={{ text: 'Confirmed', tone: 'green' }} sub={tot.outstandingContributionsCents ? `${kes(tot.outstandingContributionsCents)} still owed` : 'Nothing owed for this period'} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}><MoneyCard label="Payouts received" amount={kes(tot.payoutsReceivedCents, true)} /></View>
            <View style={{ flex: 1 }}><MoneyCard label="Loans received" amount={kes(tot.loansReceivedCents, true)} sub="Borrowed, not income" /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.lg }}>
            <View style={{ flex: 1 }}><MoneyCard label="Loan repayments" amount={kes(tot.loanRepaymentsCents + tot.interestPaidCents, true)} sub={`incl. ${kes(tot.interestPaidCents, true)} interest`} /></View>
            <View style={{ flex: 1 }}><MoneyCard label="Distributions" amount={kes(tot.distributionsReceivedCents, true)} /></View>
          </View>
          <Button title="Download statement (PDF)" icon="download-outline" onPress={exportPdf} loading={busy} style={{ marginBottom: space.xl }} />
        </>
      )}

      <Section title="Awaiting verification">
        {payments.error ? <ErrorView error={payments.error} onRetry={payments.refetch} /> : !payments.data ? <Loading /> : pending.length === 0 ? <Empty title="No reported payments waiting" body="Payments you report appear here until they are confirmed." icon="checkmark-done-outline" /> : pending.map((p, i) => (
          <TransactionRow key={p.id} title={`${PURPOSE[p.purpose] ?? p.purpose} · ${p.groupName}`} subtitle={`${date(p.paidAt)}${p.reference ? ` · ${p.reference}` : ''}`} amount={kes(p.amountCents)} status="PENDING" onPress={() => router.push(`/(app)/group/${p.groupId}/payments/${p.id}`)} last={i === pending.length - 1} />
        ))}
      </Section>

      <Section title="Recent payments" action={<Button title="All" variant="ghost" onPress={() => router.push('/(app)/payments')} />}>
        {!payments.data ? <Loading /> : payments.data.length === 0 ? <Empty title="No payments yet" icon="wallet-outline" /> : payments.data.slice(0, 8).map((p, i, arr) => (
          <TransactionRow key={p.id} title={`${PURPOSE[p.purpose] ?? p.purpose} · ${p.groupName}`} subtitle={`${date(p.paidAt)} · ${LABELS.paymentMethod[p.method]}${p.reference ? ` · ${p.reference}` : ''}`} amount={kes(p.amountCents)} status={p.status} onPress={() => router.push(`/(app)/group/${p.groupId}/payments/${p.id}`)} last={i === arr.length - 1} />
        ))}
      </Section>

      <Section title="Loans">
        {!dash.data ? <Loading /> : loans.length === 0 ? <Empty title="No outstanding loans" icon="cash-outline" /> : loans.map((g, i) => (
          <Row key={g.groupId} icon="cash-outline" title={g.name} subtitle="Outstanding balance — tap for the repayment schedule" right={kes(g.loanBalanceCents)} onPress={() => router.push(`/(app)/group/${g.groupId}/loans`)} last={i === loans.length - 1} />
        ))}
      </Section>

      {s.data?.groups.map((g) => (
        <Section key={g.groupId} title={g.groupName}>
          <Row title="Your role" right={LABELS.groupRole[g.role]} />
          <Row title="Contributions confirmed" right={kes(g.contributionsCents)} />
          <Row title="Still owed" right={kes(g.outstandingContributionsCents)} />
          {g.loanBalanceCents > 0 && <Row title="Loan balance" right={kes(g.loanBalanceCents)} />}
          {g.payoutsReceivedCents > 0 && <Row title="Payouts received" right={kes(g.payoutsReceivedCents)} />}
          <Row title="Shares held" right={String(g.shares)} last />
        </Section>
      ))}
      {s.data?.notes.map((n) => <Notice key={n} tone="neutral">{n}</Notice>)}
    </Screen>
  );
}
