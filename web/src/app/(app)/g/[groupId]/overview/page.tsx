'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GroupDashboard, GroupOverview, LABELS, LoanSummary, MONTHS, ObligationItem, Paginated, PaymentItem, Permission, todayInNairobi } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { MoneyCard, PageHeader, Panel, StatStrip } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useCan, useGroup, useGroupId } from '@/lib/session';
import { date, kes } from '@/lib/utils';

const withArticle = (role: string) => `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`;

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

  if (group.data && !officer) return <MemberOverview />;

  const o = overview.data;
  const chart = o?.monthly.map((m) => ({ month: `${MONTHS[Number(m.month.slice(5)) - 1]}`, Contributions: m.contributionsCents, Repayments: m.repaymentsCents, Expenses: m.expensesCents }));

  return (
    <>
      <PageHeader title={group.data?.name ?? 'Overview'} description={group.data ? `${LABELS.groupType[group.data.type]} · ${group.data.memberCount} active members · You are ${withArticle(LABELS.groupRole[group.data.myMembership.role].toLowerCase())}` : undefined} />
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

/** Web paths for the dashboard's task sections. */
const TASK_PATH: Record<string, string> = { contributions: 'collections', loans: 'loans', expenses: 'expenses', payouts: 'rotations', meetings: 'meetings', audit: 'findings', members: 'members', reports: 'reports', destinations: 'payment-destinations', statements: 'statement-imports' };

/**
 * A member's (or non-financial officer's) view of one Chama: what they owe, the next payout,
 * what is coming up and their tools. Figures come from the API; nothing is calculated here
 * beyond adding up the member's own obligations.
 */
function MemberOverview() {
  const groupId = useGroupId();
  const group = useGroup();
  const can = useCan();
  const dash = useQuery({ queryKey: ['group-dashboard', groupId], queryFn: () => api<GroupDashboard>(`groups/${groupId}/dashboard`) });
  const obligations = useQuery({ queryKey: ['my-obligations', groupId], queryFn: () => api<ObligationItem[]>('me/obligations', { query: { groupId, from: '2000-01-01' } }) });
  const g = group.data!;
  const t = todayInNairobi();
  const owed = (obligations.data ?? []).reduce((s, o) => s + (o.dueDate <= t ? o.outstandingCents : 0), 0);
  const pending = (obligations.data ?? []).reduce((s, o) => s + o.pendingCents, 0);
  const d = dash.data;
  const links: [string, string, boolean][] = [
    ['my', 'Pay or report a payment', true],
    ['my-loans', 'My loans', true],
    ['statements', 'Group statements', can(Permission.STATEMENTS_VIEW)],
    ['rotations', 'Payout rotation', can(Permission.ROTATIONS_VIEW)],
    ['payment-destinations', 'How to pay', true],
    ['meetings', 'Meetings & minutes', can(Permission.MEETINGS_VIEW)],
    ['decisions', 'Decisions & votes', true],
    ['notifications', 'Announcements', true],
    ['assistant', 'AI assistant', true],
  ];
  return (
    <>
      <PageHeader title={g.name} description={`${LABELS.groupType[g.type]} · ${g.memberCount} active members · You are ${withArticle(LABELS.groupRole[g.myMembership.role].toLowerCase())}`} />
      {dash.error ? <ErrorState error={dash.error} onRetry={dash.refetch} /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <MoneyCard label="You owe now" amount={obligations.data ? kes(owed) : '…'} status={owed > 0 ? <Badge tone="amber">Due</Badge> : obligations.data ? <Badge tone="green">Up to date</Badge> : undefined} hint={<Link href={`/g/${groupId}/my`} className="text-berry hover:underline">See my contributions</Link>} />
            <MoneyCard label="Awaiting verification" amount={obligations.data ? kes(pending) : '…'} hint="Reported, not yet confirmed. Not counted as paid." />
            <MoneyCard
              label="Next payout"
              amount={d?.nextPayout ? kes(d.nextPayout.expectedCents) : '—'}
              status={d?.nextPayout ? <StatusBadge status={d.nextPayout.status} /> : undefined}
              hint={d?.nextPayout ? `Round ${d.nextPayout.round} to ${d.nextPayout.recipientName} on ${date(d.nextPayout.payoutDate)}. Paid from what is actually collected.` : 'No payout scheduled'}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="Coming up" flush>
              {!d ? <LoadingRows rows={3} /> : d.upcoming.length === 0 ? <EmptyState title="Nothing coming up" /> : (
                <ul className="divide-y divide-line">
                  {d.upcoming.map((u, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="min-w-0"><span className="block truncate text-plum">{u.label}</span><span className="text-xs text-muted">{date(u.date)}</span></span>
                      {u.amountCents !== null && <span className="shrink-0 whitespace-nowrap tabular-nums">{kes(u.amountCents)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <div className="space-y-4">
              {d && d.tasks.length > 0 && (
                <Panel title="Waiting for you" flush>
                  <ul className="divide-y divide-line">
                    {d.tasks.map((task) => (
                      <li key={task.key}>
                        <Link href={`/g/${groupId}/${TASK_PATH[task.section] ?? 'overview'}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-canvas">
                          <span className="text-plum">{task.label}</span>
                          <Badge tone="amber" icon={false}>{String(task.count)}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Panel title="In this Chama">
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {links.filter(([, , ok]) => ok).map(([href, label]) => (
                    <li key={href}><Link href={`/g/${groupId}/${href}`} className="block rounded-md border border-line px-3 py-2 text-sm text-berry hover:bg-canvas">{label}</Link></li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
