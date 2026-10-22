'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { addDays, todayInNairobi, type RevenueReport } from '@chamahub/shared';
import { Consolidated, MoneyList } from '@/components/platform/money-list';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { PageHeader, Panel } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { cn, date } from '@/lib/utils';

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <span className="text-plum">{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** Owner revenue: every figure from database records, by currency; consolidated only with recorded rates. */
export default function RevenuePage() {
  const today = todayInNairobi();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<'live' | 'test'>('live');
  const q = useQuery({ queryKey: ['revenue', from, to, mode], queryFn: () => api<RevenueReport>('platform/revenue', { query: { from, to, livemode: mode } }) });
  const r = q.data;
  const presets: [string, string, string][] = [
    ['This month', `${today.slice(0, 7)}-01`, today],
    ['Last 30 days', addDays(today, -29), today],
    ['Last 90 days', addDays(today, -89), today],
    ['This year', `${today.slice(0, 4)}-01-01`, today],
  ];
  return (
    <>
      <PageHeader title="Revenue" description="Subscription revenue from verified payments, recurring revenue from paid plans, and recorded costs. Group money is never included." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([label, f, t]) => (
            <button key={label} onClick={() => { setFrom(f); setTo(t); }} className={cn('rounded-full border px-3 py-1 text-sm', from === f && to === t ? 'border-rose bg-blush font-medium text-berry' : 'border-line bg-white text-muted hover:text-plum')}>{label}</button>
          ))}
        </div>
        <Field label="From" htmlFor="rv-from"><Input id="rv-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="rv-to"><Input id="rv-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <div role="radiogroup" aria-label="Mode" className="flex rounded-full border border-line p-0.5 text-sm">
          {(['live', 'test'] as const).map((m) => <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('rounded-full px-3 py-1', mode === m ? 'bg-berry text-white' : 'text-muted')}>{m === 'live' ? 'Live' : 'Test payments'}</button>)}
        </div>
      </div>
      {q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !r ? <LoadingRows rows={8} /> : (
        <div className="space-y-4">
          {!r.livemode && <p className="rounded-md bg-pending-50 px-3 py-2 text-sm text-pending-ink">Test mode: sandbox and provider test payments only. None of this is revenue.</p>}
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title={<span>Cash collected <Badge tone="green" icon={false}>verified</Badge></span>}>
              <p className="mb-2 text-xs text-muted">{date(r.period.from)} – {date(r.period.to)} · {r.cash.paymentsCount} payment{r.cash.paymentsCount === 1 ? '' : 's'} confirmed by the provider or finance staff</p>
              <Row label="Received"><MoneyList items={r.cash.gross} /></Row>
              <Row label="Refunds"><MoneyList items={r.cash.refunds} /></Row>
              <Row label="Provider fees" hint="Where the provider reports them"><MoneyList items={r.cash.fees} /></Row>
              <Row label="Net cash"><strong><MoneyList items={r.cash.net} /></strong></Row>
            </Panel>
            <Panel title={<span>Recurring revenue <Badge tone="blue" icon={false}>contracted, not cash</Badge></span>}>
              <Row label="MRR" hint="Monthly price of paid plans now (annual ÷ 12)"><MoneyList items={r.recurring.mrr} /></Row>
              <Row label="ARR" hint="MRR × 12"><MoneyList items={r.recurring.arr} /></Row>
              <Row label="Average per paying group"><MoneyList items={r.recurring.arppg} /></Row>
              <Row label="Renewals due in 30 days">{r.renewals.dueNext30Days}</Row>
              <Row label="Renewals paid / failed in period">{r.renewals.succeededInPeriod} / {r.renewals.failedInPeriod}</Row>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Panel title="Groups now">
              <Row label="Paying">{r.groups.paying}</Row>
              <Row label="In grace (renewal overdue)">{r.groups.inGrace}</Row>
              <Row label="Trials">{r.groups.trialing}</Row>
              <Row label="Promotional access">{r.groups.promotional}</Row>
              <Row label="Free">{r.groups.free}</Row>
              <Row label="New paying in period">{r.groups.newPaying}</Row>
            </Panel>
            <Panel title="Churn & retention" >
              <Row label="Paying at period start">{r.churn.payingAtStart}</Row>
              <Row label="Lost in period" hint="Expired, cancelled or refunded, not re-subscribed">{r.churn.churned}</Row>
              <Row label="Churn">{pct(r.churn.churnRate)}</Row>
              <Row label="Retention">{pct(r.churn.retentionRate)}</Row>
            </Panel>
            <Panel title={<span>Not yet money <Badge tone="amber" icon={false}>pending / problems</Badge></span>}>
              <Row label="Waiting for confirmation" hint={`${r.pending.count} payment${r.pending.count === 1 ? '' : 's'}`}><MoneyList items={r.pending.amount} /></Row>
              <Row label="Failed or cancelled in period">{r.failed.count}</Row>
              <Row label="Disputed (chargebacks)" hint={`${r.disputed.count} open`}><MoneyList items={r.disputed.amount} /></Row>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="Recurring revenue by plan" flush>
              <table className="w-full text-sm"><thead><tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Plan</th><th className="px-4 py-2 font-medium">Groups</th><th className="px-4 py-2 text-right font-medium">MRR</th></tr></thead>
                <tbody>{r.recurring.byPlan.length ? r.recurring.byPlan.map((p) => <tr key={p.planCode} className="border-b border-line last:border-0"><td className="px-4 py-2">{p.planName}</td><td className="px-4 py-2">{p.groups}</td><td className="px-4 py-2 text-right"><MoneyList items={p.mrr} /></td></tr>) : <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">No paying groups</td></tr>}</tbody></table>
            </Panel>
            <Panel title="Recurring revenue by country" flush>
              <table className="w-full text-sm"><thead><tr className="border-b border-line bg-canvas/60 text-left text-xs text-muted"><th className="px-4 py-2 font-medium">Country</th><th className="px-4 py-2 font-medium">Groups</th><th className="px-4 py-2 text-right font-medium">MRR</th></tr></thead>
                <tbody>{r.recurring.byCountry.length ? r.recurring.byCountry.map((c) => <tr key={c.countryCode} className="border-b border-line last:border-0"><td className="px-4 py-2">{c.countryCode}</td><td className="px-4 py-2">{c.groups}</td><td className="px-4 py-2 text-right"><MoneyList items={c.mrr} /></td></tr>) : <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">No paying groups</td></tr>}</tbody></table>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title={<span>Costs <Badge tone="neutral" icon={false}>recorded</Badge></span>}>
              {r.costs.byCategory.length === 0 ? <p className="text-sm text-muted">No costs recorded for this period. Add them under Costs & exchange rates.</p> : r.costs.byCategory.map((c) => (
                <Row key={c.category} label={c.category.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase())} hint={c.measured ? 'Measured from AI usage records' : undefined}><MoneyList items={c.amount} /></Row>
              ))}
              <Row label="Acquisition cost per new paying group"><MoneyList items={r.costs.cacPerNewPayingGroup} empty="Not available" /></Row>
            </Panel>
            <Panel title={<span>Consolidated in {r.reportingCurrency} <Badge tone="amber" icon={false}>estimate</Badge></span>}>
              <Row label="Net cash"><Consolidated value={r.consolidated.cashNet} currency={r.reportingCurrency} /></Row>
              <Row label="MRR"><Consolidated value={r.consolidated.mrr} currency={r.reportingCurrency} /></Row>
              <Row label="ARR"><Consolidated value={r.consolidated.arr} currency={r.reportingCurrency} /></Row>
              <Row label="Recorded costs"><Consolidated value={r.consolidated.costs} currency={r.reportingCurrency} /></Row>
              <Row label="Estimated operating profit" hint="Net cash − recorded costs. Only as complete as the costs recorded."><strong><Consolidated value={r.consolidated.estimatedOperatingProfit} currency={r.reportingCurrency} /></strong></Row>
              {r.consolidated.conversions.length > 0 && (
                <div className="mt-3 text-xs text-muted">
                  <p className="font-medium text-plum">Exchange rates used</p>
                  {r.consolidated.conversions.map((c) => <p key={c.from}>1 {c.from} = {c.rate.startsWith('1/') ? `1 ÷ ${c.rate.slice(2)}` : c.rate} {c.to} · {date(c.asOf)} · {c.source}</p>)}
                </div>
              )}
              {r.consolidated.missingRates.length > 0 && <p className="mt-2 rounded-md bg-pending-50 px-3 py-2 text-xs text-pending-ink">No rate recorded for {r.consolidated.missingRates.join(', ')}: those amounts are excluded from the consolidated totals.</p>}
            </Panel>
          </div>
          <Panel title="How these figures are calculated">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{r.notes.map((n) => <li key={n}>{n}</li>)}<li>Generated {new Date(r.generatedAt).toLocaleString('en-KE')}.</li></ul>
          </Panel>
        </div>
      )}
    </>
  );
}
