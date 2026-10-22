'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { addMonths, GroupStatement, Permission, todayInNairobi } from '@chamahub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PageHeader, Panel, Toolbar } from '@/components/ui/layout-parts';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { MemberSelect } from '@/components/domain/member-select';
import { api, fileUrl } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCan, useGroupId } from '@/lib/session';
import { cn, date, kes } from '@/lib/utils';

const REPORTS: { id: string; label: string; description: string }[] = [
  { id: 'group-statement', label: 'Group statement', description: 'Opening balance, inflows, outflows, closing balance' },
  { id: 'cashbook', label: 'Cashbook', description: 'Every cash movement with running balance' },
  { id: 'contributions', label: 'Contributions report', description: 'Expected vs received per member and period' },
  { id: 'loan-portfolio', label: 'Loan portfolio', description: 'All loans, balances and arrears' },
  { id: 'repayments', label: 'Repayment report', description: 'Repayments split into principal and interest' },
  { id: 'expenses', label: 'Expenses report', description: 'Expenses and their approval status' },
  { id: 'fines', label: 'Fines report', description: 'Fines issued, paid and waived' },
  { id: 'member-statement', label: 'Member statement', description: 'All transactions for one member' },
  { id: 'payouts', label: 'Payout report', description: 'Rotation payouts by round' },
  { id: 'distributions', label: 'Distribution report', description: 'Distribution allocations and payments' },
  { id: 'income-expenditure', label: 'Income and expenditure', description: 'Monthly income vs expenditure' },
  { id: 'audit', label: 'Audit report', description: 'Every recorded action in the period' },
];

interface Report { title: string; headers: string[]; rows: (string | number | null)[][]; from: string; to: string }

function StatementView({ s }: { s: GroupStatement }) {
  const rows: [string, number, boolean?][] = [
    ['Opening cash balance', s.openingBalanceCents, true],
    ['Contributions received', s.contributionsCents],
    ['Loan repayments (principal)', s.loanRepaymentsCents],
    ['Interest received', s.interestReceivedCents],
    ['Fines received', s.finesReceivedCents],
    ['Other income / opening balances', s.otherIncomeCents],
    ['Expenses', -s.expensesCents],
    ['Loans disbursed', -s.loansDisbursedCents],
    ['Rotation payouts', -s.payoutsCents],
    ['Distributions', -s.distributionsCents],
    ['Closing cash balance', s.closingBalanceCents, true],
  ];
  return (
    <table className="w-full max-w-xl text-sm">
      <tbody>
        {rows.map(([k, v, b]) => (
          <tr key={k} className={cn('border-b border-line', b && 'font-semibold')}><td className="py-1.5">{k}</td><td className="text-right tabular-nums">{v < 0 ? `(${kes(-v)})` : kes(v)}</td></tr>
        ))}
        <tr><td className="py-1.5 text-muted">Loans outstanding (receivable, not cash)</td><td className="text-right tabular-nums text-muted">{kes(s.loansOutstandingCents)}</td></tr>
      </tbody>
    </table>
  );
}

export default function ReportsPage() {
  const groupId = useGroupId();
  const can = useCan();
  const t = todayInNairobi();
  const [report, setReport] = useState('group-statement');
  const [range, setRange] = useState({ from: addMonths(t, -12), to: t });
  const [memberId, setMemberId] = useState('');
  const needsMember = report === 'member-statement';
  const query = { ...range, memberId: memberId || undefined };
  const data = useQuery({ queryKey: ['report', groupId, report, query], queryFn: () => api<Report>(`groups/${groupId}/reports/${report}`, { query }), enabled: !needsMember || !!memberId });
  const statement = useQuery({ queryKey: ['statement-live', groupId, range], queryFn: () => api<GroupStatement>(`groups/${groupId}/statements/live`, { query: range }), enabled: report === 'group-statement' });
  const published = useQuery({ queryKey: ['statements', groupId], queryFn: () => api<{ id: string; from: string; to: string; publishedAt: string; closingBalanceCents: number }[]>(`groups/${groupId}/statements`) });
  const publish = useAction(() => api(`groups/${groupId}/statements/publish`, { body: range }), { success: 'Statement published to all members', invalidate: [['statements', groupId]] });
  const current = REPORTS.find((r) => r.id === report)!;

  return (
    <>
      <PageHeader title="Financial Reports" description="All figures come from the group’s ledger. Only confirmed transactions are included." />
      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-0.5" aria-label="Reports">
          {REPORTS.map((r) => (
            <button key={r.id} onClick={() => setReport(r.id)} className={cn('block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white', report === r.id && 'bg-white font-medium text-berry shadow-sm')}>
              {r.label}
            </button>
          ))}
        </nav>
        <div className="space-y-5">
          <Panel flush title={current.label} actions={<span className="text-xs text-muted">{current.description}</span>}>
            <Toolbar>
              <Field label="From" htmlFor="r-f"><Input id="r-f" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
              <Field label="To" htmlFor="r-t"><Input id="r-t" type="date" value={range.to} max={t} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
              {needsMember && <Field label="Member" htmlFor="r-m" className="w-56"><MemberSelect id="r-m" value={memberId} onChange={setMemberId} /></Field>}
              <div className="flex-1" />
              <Button variant="secondary" asChild><a href={fileUrl(`groups/${groupId}/reports/${report}`, { ...query, format: 'csv' })}>Download CSV</a></Button>
              {report === 'group-statement' && <Button variant="secondary" asChild><a href={fileUrl(`groups/${groupId}/statements/live.pdf`, range)}>Download PDF</a></Button>}
              {report === 'group-statement' && can(Permission.STATEMENTS_PUBLISH) && <Button onClick={() => publish.mutate(undefined)} loading={publish.isPending} disabled={range.to > t}>Publish to members</Button>}
            </Toolbar>
            <div className="p-4">
              {report === 'group-statement' && statement.data && <div className="mb-6"><StatementView s={statement.data} /></div>}
              {needsMember && !memberId ? <p className="py-6 text-center text-sm text-muted">Select a member.</p> : data.error ? <ErrorState error={data.error} onRetry={data.refetch} /> : !data.data ? <LoadingRows /> : report !== 'group-statement' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-line text-left text-xs text-muted">{data.data.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                    <tbody>{data.data.rows.slice(0, 500).map((r, i) => <tr key={i} className="border-b border-line">{r.map((c, j) => <td key={j} className={cn('whitespace-nowrap px-2 py-1.5', typeof c === 'string' && /^-?\d+\.\d{2}$/.test(c) && 'text-right tabular-nums')}>{c ?? ''}</td>)}</tr>)}</tbody>
                  </table>
                  {data.data.rows.length === 0 && <p className="py-6 text-center text-sm text-muted">No records in this period.</p>}
                  {data.data.rows.length > 500 && <p className="py-2 text-xs text-muted">Showing the first 500 rows. Download the CSV for everything.</p>}
                </div>
              )}
            </div>
          </Panel>
          {report === 'group-statement' && (
            <Panel title="Published statements" flush>
              {published.data?.length ? (
                <ul className="divide-y divide-line text-sm">
                  {published.data.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-4 py-2">
                      <span>{date(p.from)} – {date(p.to)} <span className="text-muted">· published {date(p.publishedAt)}</span></span>
                      <span className="flex items-center gap-3"><span className="tabular-nums">{kes(p.closingBalanceCents)}</span><a className="text-berry hover:underline" href={fileUrl(`groups/${groupId}/statements/${p.id}/pdf`)}>PDF</a></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-4 py-6 text-center text-sm text-muted">No statements published yet. Members only see published statements.</p>}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
