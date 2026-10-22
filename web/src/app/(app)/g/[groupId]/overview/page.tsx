'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GroupOverview, LABELS, LoanSummary, MONTHS, Paginated, PaymentItem, Permission } from '@chamahub/shared';
import { StatusBadge } from '@/components/ui/badge';
import { PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useCan, useGroup, useGroupId } from '@/lib/session';
import { date, kes } from '@/lib/utils';

const shortKes = (cents: number) => {
  const v = cents / 100;
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
};

export default function OverviewPage() {
  const groupId = useGroupId();
  const can = useCan();
  const group = useGroup();
  const officer = can(Permission.REPORTS_VIEW);
  const overview = useQuery({ queryKey: ['overview', groupId], queryFn: () => api<GroupOverview>(`groups/${groupId}/overview`), enabled: officer });
  const pending = useQuery({ queryKey: ['payments', groupId, 'PENDING'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 5 } }), enabled: can(Permission.CONTRIBUTIONS_VIEW_ALL) });
  const loans = useQuery({ queryKey: ['loans', groupId, 'pending'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.LOANS_VIEW_ALL) });

  if (group.data && !officer) {
    return (
      <>
        <PageHeader title={group.data.name} description={`${LABELS.groupType[group.data.type]} · You are a ${LABELS.groupRole[group.data.myMembership.role].toLowerCase()}`} />
        <Panel>
          {group.data.myMembership.role === 'MEMBER' ? (
            <EmptyState title="Members use the ChamaHub mobile app" description="Your contributions, loans, payouts, votes and statements are in the app." />
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-plum">Your tools in this group:</p>
              <ul className="flex flex-wrap gap-2">
                {[['meetings', 'Meetings', Permission.MEETINGS_MANAGE], ['members', 'Members', Permission.MEMBERS_VIEW], ['decisions', 'Decisions & Votes', Permission.GROUP_VIEW], ['notifications', 'Announcements', Permission.ANNOUNCEMENTS_SEND], ['audit', 'Audit records', Permission.AUDIT_VIEW_AREA]]
                  .filter(([, , p]) => can(p as Permission))
                  .map(([href, label]) => <li key={href}><Link className="rounded-md border border-line px-3 py-1.5 text-berry hover:bg-canvas" href={`/g/${groupId}/${href}`}>{label}</Link></li>)}
              </ul>
            </div>
          )}
        </Panel>
      </>
    );
  }

  const o = overview.data;
  const chart = o?.monthly.map((m) => ({ month: `${MONTHS[Number(m.month.slice(5)) - 1]}`, Contributions: m.contributionsCents, Repayments: m.repaymentsCents, Expenses: m.expensesCents }));

  return (
    <>
      <PageHeader title={group.data?.name ?? 'Overview'} description={group.data ? `${LABELS.groupType[group.data.type]} · ${group.data.memberCount} active members · You are ${LABELS.groupRole[group.data.myMembership.role].toLowerCase()}` : undefined} />
      {overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.refetch} />
      ) : !o ? (
        <LoadingRows rows={3} />
      ) : (
        <StatStrip
          stats={[
            { label: 'Cash balance (ledger)', value: kes(o.cashBalanceCents), hint: 'Confirmed money only' },
            { label: 'Total contributions', value: kes(o.totalContributionsCents) },
            { label: 'Arrears', value: kes(o.outstandingContributionsCents), tone: o.outstandingContributionsCents > 0 ? 'warning' : 'default' },
            { label: 'Loans outstanding', value: kes(o.loansOutstandingCents), hint: 'Principal, not cash' },
            { label: 'Awaiting action', value: `${o.pendingVerification + o.pendingApprovals}`, hint: `${o.pendingVerification} to verify · ${o.pendingApprovals} approvals`, tone: o.pendingVerification + o.pendingApprovals > 0 ? 'warning' : 'default' },
          ]}
        />
      )}
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Panel title="Last 6 months">
          {chart ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} stroke="#F0DCE6" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#806B7B' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={shortKes} tick={{ fontSize: 12, fill: '#806B7B' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v: number) => kes(v)} cursor={{ fill: '#FCE7F0' }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(value: string) => <span style={{ color: "#42213D" }}>{value}</span>} />
                  <Bar dataKey="Contributions" fill="#B83270" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Repayments" fill="#E84D8A" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#806B7B" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <LoadingRows rows={4} />
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Payments to verify" actions={<Link href={`/g/${groupId}/contributions?tab=payments`} className="text-xs text-berry hover:underline">View all</Link>} flush>
            {pending.data?.items.length ? (
              <ul className="divide-y divide-line text-sm">
                {pending.data.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-plum">{p.memberName}</p>
                      <p className="text-xs text-muted">
                        {date(p.paidAt)} · {LABELS.paymentMethod[p.method]} {p.reference ?? ''}
                      </p>
                    </div>
                    <span className="tabular-nums">{kes(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing waiting for verification.</p>
            )}
          </Panel>
          <Panel title="Loan applications" actions={<Link href={`/g/${groupId}/loans`} className="text-xs text-berry hover:underline">Open loans</Link>} flush>
            {loans.data?.length ? (
              <ul className="divide-y divide-line text-sm">
                {loans.data.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-plum">{l.memberName}</p>
                      <p className="text-xs text-muted">
                        {l.approvalsReceived}/{l.approvalsRequired} approvals
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums">{kes(l.principalCents)}</p>
                      <StatusBadge status={l.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted">No applications awaiting approval.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
