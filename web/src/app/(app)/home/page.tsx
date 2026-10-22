'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { LABELS, SPECIAL_ROLE_INFO, type PersonalDashboard } from '@chamahub/shared';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { MoneyCard, PageHeader, Panel } from '@/components/ui/layout-parts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { date, kes } from '@/lib/utils';

/** A member's own money across all their Chamas. Every figure comes from the API (confirmed ledger records). */
export default function MyHomePage() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['me', 'dashboard'], queryFn: () => api<PersonalDashboard>('me/dashboard') });
  const d = q.data;
  return (
    <>
      <PageHeader title={me ? `Hello, ${me.fullName.split(' ')[0]}` : 'My home'} description="Your contributions, payouts and loans across every Chama you belong to." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !d ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            <MoneyCard label="Total contributed" amount={kes(d.totalContributedCents)} status={<Badge tone="green">Confirmed</Badge>} hint={`${kes(d.contributedThisMonthCents)} this month`} />
            <MoneyCard
              label="Due now"
              amount={kes(d.dueNowCents)}
              status={d.overdueCents > 0 ? <Badge tone="red">Overdue</Badge> : d.dueNowCents > 0 ? <Badge tone="amber">Due</Badge> : <Badge tone="green">Up to date</Badge>}
              hint={d.nextDeadline ? `Next: ${kes(d.nextDeadline.amountCents)} to ${d.nextDeadline.groupName} by ${date(d.nextDeadline.dueDate)}` : 'Nothing scheduled'}
            />
            <MoneyCard
              label="Awaiting verification"
              amount={kes(d.pendingVerification.cents)}
              status={d.pendingVerification.count > 0 ? <Badge tone="amber">{`${d.pendingVerification.count} payment${d.pendingVerification.count === 1 ? '' : 's'}`}</Badge> : undefined}
              hint="Reported by you, not yet confirmed. Not counted as paid."
            />
            <MoneyCard label="Loan balance" amount={kes(d.outstandingLoanCents)} hint={`Payouts received: ${kes(d.payoutsReceivedCents)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="Overdue" flush>
              {d.overdue.length === 0 ? (
                <EmptyState title="Nothing overdue" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.overdue.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-plum">{o.groupName} · {o.periodLabel}</p>
                        <p className="text-xs text-muted">Was due {date(o.dueDate)}</p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-danger-ink">{kes(o.outstandingCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Coming up" flush>
              {d.upcoming.length === 0 && d.upcomingPayouts.length === 0 ? (
                <EmptyState title="Nothing coming up" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.upcomingPayouts.map((p) => (
                    <li key={`${p.groupId}-${p.round}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-plum">Your payout · {p.groupName}</p>
                        <p className="text-xs text-muted">{p.cycleName}, round {p.round} of {p.totalRounds} · {date(p.payoutDate)}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-2"><span className="whitespace-nowrap tabular-nums">{kes(p.expectedCents)}</span><StatusBadge status={p.status} /></span>
                    </li>
                  ))}
                  {d.upcoming.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-plum">{o.groupName} · {o.periodLabel}</p>
                        <p className="text-xs text-muted">Due {date(o.dueDate)}</p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{kes(o.outstandingCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="My Chamas" flush>
              {d.groups.length === 0 ? (
                <EmptyState title="You are not in any Chama yet" description="Accept an invitation, or create a Chama from Groups." />
              ) : (
                <ul className="divide-y divide-line">
                  {d.groups.map((g) => (
                    <li key={g.groupId}>
                      <Link href={`/g/${g.groupId}/overview`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-canvas">
                        <span className="truncate font-medium text-plum">{g.name}</span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          <Badge tone={g.role === 'MEMBER' ? 'neutral' : 'green'} icon={false}>{LABELS.groupRole[g.role]}</Badge>
                          {g.specialRoles.map((r) => (
                            <Badge key={r} tone="blue" icon={false}>{SPECIAL_ROLE_INFO[r].label}</Badge>
                          ))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Recent activity" flush>
              {d.recentActivity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentActivity.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate text-plum">{a.title}</p>
                        <p className="text-xs text-muted">{a.groupName} · {date(a.at)}</p>
                      </div>
                      {a.amountCents !== null && <span className="shrink-0 whitespace-nowrap tabular-nums">{kes(a.amountCents)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
