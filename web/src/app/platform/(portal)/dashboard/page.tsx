'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, SUPPORT_LABELS, type PlatformDashboard } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Two-series palette, validated for colour-vision deficiency; single series use the first. */
const C1 = '#C2185B';
const C2 = '#2F6F9F';
const AXIS = { fontSize: 11, fill: '#806B7B' };
const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const short = (period: string, bucket: string) => {
  const d = new Date(`${period}T00:00:00Z`);
  return bucket === 'month' ? d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export default function DashboardPage() {
  const [preset, setPreset] = useState<string>('90');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const range = useMemo(() => {
    if (preset === 'custom' && custom.from && custom.to) return custom;
    const days = RANGES.find((r) => r.key === preset)?.days ?? 90;
    return { from: iso(new Date(Date.now() - days * 86_400_000)), to: iso(new Date()) };
  }, [preset, custom]);
  const q = useQuery({ queryKey: ['platform-dashboard', range], queryFn: () => api<PlatformDashboard>('platform/dashboard', { query: range }), placeholderData: (p) => p });
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live figures from ChamaHub's records. Nothing here is estimated."
        actions={
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <Button key={r.key} size="sm" variant={preset === r.key ? 'primary' : 'secondary'} onClick={() => setPreset(r.key)} aria-pressed={preset === r.key}>
                {r.label}
              </Button>
            ))}
            <Button size="sm" variant={preset === 'custom' ? 'primary' : 'secondary'} onClick={() => setPreset('custom')} aria-pressed={preset === 'custom'}>
              Custom
            </Button>
            {preset === 'custom' && (
              <>
                <Input type="date" className="h-8 w-36" aria-label="From" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <Input type="date" className="h-8 w-36" aria-label="To" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </>
            )}
          </div>
        }
      />
      {q.error ? (
        <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel>
      ) : !d ? (
        <Panel><LoadingRows rows={8} /></Panel>
      ) : (
        <div className={cn('space-y-5', q.isFetching && 'opacity-70 transition-opacity')}>
          <StatStrip
            stats={[
              { label: 'Users', value: d.totals.users.toLocaleString(), hint: `${d.totals.newUsers.toLocaleString()} new in range` },
              { label: 'Groups', value: d.totals.groups.toLocaleString(), hint: `${d.totals.newGroups.toLocaleString()} new in range` },
              { label: 'Active groups (30 days)', value: d.totals.activeGroups30d.toLocaleString(), hint: 'Recorded money in the last 30 days' },
              { label: 'Paying groups', value: d.totals.payingGroups.toLocaleString(), hint: `${d.totals.trialGroups} on trial · ${d.totals.freeGroups} free` },
            ]}
          />
          <StatStrip
            stats={[
              { label: 'Open support cases', value: d.totals.openSupportCases.toLocaleString() },
              { label: 'Critical incidents', value: d.totals.criticalIncidents.toLocaleString(), hint: 'Urgent or security cases still open', tone: d.totals.criticalIncidents ? 'danger' : 'default' },
              { label: 'Helpers working cases', value: d.totals.activeHelpers.toLocaleString() },
              { label: 'Median first response', value: d.support.medianFirstResponseHours === null ? '—' : `${d.support.medianFirstResponseHours} h`, hint: d.support.medianResolutionHours === null ? 'No resolved cases in range' : `Median resolution ${d.support.medianResolutionHours} h` },
            ]}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartPanel title="New registrations" empty={!d.registrations.some((r) => r.users || r.groups)} table={{ head: ['Period', 'Users', 'Groups'], rows: d.registrations.map((r) => [short(r.period, d.range.bucket), r.users, r.groups]) }}>
              <LineChart data={d.registrations.map((r) => ({ ...r, label: short(r.period, d.range.bucket) }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="#F0DCE6" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#F0DCE6' }} minTickGap={16} />
                <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="users" name="Users" stroke={C1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="groups" name="Groups" stroke={C2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ChartPanel>

            <ChartPanel title="Groups by plan" empty={!d.planDistribution.length} table={{ head: ['Plan', 'Groups'], rows: d.planDistribution.map((p) => [p.plan, p.groups]) }}>
              <BarChart data={d.planDistribution} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid horizontal={false} stroke="#F0DCE6" />
                <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="plan" tick={AXIS} tickLine={false} axisLine={false} width={84} />
                <Tooltip cursor={{ fill: '#FCE7F0' }} contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
                <Bar dataKey="groups" name="Groups" fill={C1} radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Active vs inactive groups (30 days)" height={120} empty={!d.groupActivity.active && !d.groupActivity.inactive} table={{ head: ['', 'Groups'], rows: [['Active', d.groupActivity.active], ['Inactive', d.groupActivity.inactive]] }}>
              <BarChart data={[{ name: 'Groups', active: d.groupActivity.active, inactive: d.groupActivity.inactive }]} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip cursor={false} contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="active" name="Active" stackId="a" fill={C1} stroke="#fff" strokeWidth={2} barSize={28} />
                <Bar dataKey="inactive" name="Inactive" stackId="a" fill={C2} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} barSize={28} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Support cases by status" empty={!d.support.byStatus.length} table={{ head: ['Status', 'Cases'], rows: d.support.byStatus.map((s) => [SUPPORT_LABELS.status[s.status], s.count]) }}>
              <BarChart data={d.support.byStatus.map((s) => ({ ...s, label: SUPPORT_LABELS.status[s.status] }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="#F0DCE6" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#F0DCE6' }} interval={0} />
                <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#FCE7F0' }} contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
                <Bar dataKey="count" name="Cases" fill={C1} radius={[4, 4, 0, 0]} barSize={22} />
              </BarChart>
            </ChartPanel>

            <ChartPanel title="Cases opened and resolved per week" empty={!d.support.weekly.some((w) => w.opened || w.resolved)} table={{ head: ['Week of', 'Opened', 'Resolved'], rows: d.support.weekly.map((w) => [short(w.period, 'week'), w.opened, w.resolved]) }}>
              <BarChart data={d.support.weekly.map((w) => ({ ...w, label: short(w.period, 'week') }))} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="#F0DCE6" />
                <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#F0DCE6' }} minTickGap={12} />
                <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: '#FCE7F0' }} contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="opened" name="Opened" fill={C1} radius={[4, 4, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill={C2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartPanel>

            {d.revenue && <Revenue revenue={d.revenue} />}
          </div>
        </div>
      )}
    </>
  );
}

/** Verified, live-mode subscription revenue only; each currency is shown on its own and never added to another. */
function Revenue({ revenue }: { revenue: NonNullable<PlatformDashboard['revenue']> }) {
  const currencies = [...new Set([...revenue.byMonth.map((r) => r.currency), ...revenue.pending.map((p) => p.currency)])];
  const [currency, setCurrency] = useState(currencies[0] ?? 'KES');
  const rows = revenue.byMonth.filter((r) => r.currency === currency);
  const pending = revenue.pending.find((p) => p.currency === currency);
  const fmt = (minor: number) => formatMoney(minor, currency);
  return (
    <ChartPanel
      title="Verified revenue"
      subtitle={pending ? `${fmt(pending.amountMinor)} pending in ${pending.count} unconfirmed checkout(s): not counted` : 'Confirmed live payments; test-mode and pending payments are excluded'}
      actions={currencies.length > 1 ? (
        <div className="flex gap-1">{currencies.map((c) => <Button key={c} size="sm" variant={c === currency ? 'primary' : 'secondary'} onClick={() => setCurrency(c)}>{c}</Button>)}</div>
      ) : undefined}
      empty={!rows.length}
      emptyText="No verified live payments in this range yet."
      table={{ head: ['Month', 'Collected', 'Refunded', 'Net'], rows: rows.map((r) => [short(r.period, 'month'), fmt(r.collected), fmt(r.refunded), fmt(r.collected - r.refunded)]) }}
    >
      <BarChart data={rows.map((r) => ({ ...r, label: short(r.period, 'month') }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} stroke="#F0DCE6" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#F0DCE6' }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatMoney(Math.round(v), currency, { compact: true })} width={72} />
        <Tooltip cursor={{ fill: '#FCE7F0' }} formatter={(v: number) => fmt(v)} contentStyle={{ borderRadius: 8, borderColor: '#F0DCE6', fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="collected" name="Collected" fill={C1} radius={[4, 4, 0, 0]} />
        <Bar dataKey="refunded" name="Refunded" fill={C2} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartPanel>
  );
}

function ChartPanel({ title, subtitle, actions, children, table, empty, emptyText, height = 240 }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactElement; table: { head: string[]; rows: (string | number)[][] }; empty?: boolean; emptyText?: string; height?: number }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel
      title={<span>{title}{subtitle && <span className="block text-xs font-normal text-muted">{subtitle}</span>}</span>}
      actions={
        <div className="flex items-center gap-2">
          {actions}
          {!empty && <Button size="sm" variant="ghost" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>{asTable ? 'Chart' : 'Table'}</Button>}
        </div>
      }
    >
      {empty ? (
        <EmptyState title={emptyText ?? 'No data in this range'} />
      ) : asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted">{table.head.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className={cn('py-1.5 pr-3 text-plum', j > 0 && 'tabular-nums')}>{typeof c === 'number' ? c.toLocaleString() : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
