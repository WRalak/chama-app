import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { DashboardTask, GroupDashboard, LABELS, Permission, SPECIAL_ROLE_INFO } from '@chamahub/shared';
import { Button, ErrorView, Loading, Notice, Progress, Row, Screen, Section, Stat, StatGrid, StatusBadge, T, Tile } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useMyGroups } from '@/lib/queries';
import { SECTIONS } from '@/lib/sections';
import { colors, space } from '@/theme';

const P = Permission;
const SECTION_PATH: Record<DashboardTask['section'], string> = {
  contributions: 'manage/contributions',
  loans: 'manage/loans',
  expenses: 'manage/expenses',
  payouts: 'manage/payouts',
  meetings: 'meetings',
  audit: 'findings',
  members: 'manage/members',
  reports: 'manage',
  destinations: 'manage/destinations',
  statements: 'manage/statements',
};

export default function GroupHome() {
  const { groupId, group, can, canAny, readOnly, roleLabel } = useGroupAccess();
  const mine = useMyGroups();
  const summary = mine.data?.find((g) => g.groupId === groupId);
  const dash = useQuery({ queryKey: ['group-dashboard', groupId], queryFn: () => api<GroupDashboard>(`groups/${groupId}/dashboard`), enabled: !!group.data });
  const go = (path: string) => router.push(`/(app)/group/${groupId}/${path}` as never);
  const d = dash.data;
  const officer = !!d && (d.collections !== null || d.reconciliation !== null || d.tasks.length > 0 || canAny(P.MEETINGS_MANAGE, P.ANNOUNCEMENTS_SEND, P.MEMBERS_INVITE));
  const extra = group.data?.myMembership.specialRoles.filter((r) => r !== 'READ_ONLY').map((r) => SPECIAL_ROLE_INFO[r].label) ?? [];
  const taskCount = (keys: DashboardTask['key'][]) => d?.tasks.filter((t) => keys.includes(t.key)).reduce((a, t) => a + t.count, 0) ?? 0;

  const shortcuts = [
    { show: can(P.CONTRIBUTIONS_RECORD), icon: 'add-circle-outline' as const, label: 'Record payment', path: 'manage/record-payment' },
    { show: canAny(P.RECONCILIATION_MANAGE, P.CONTRIBUTIONS_VERIFY), icon: 'git-compare-outline' as const, label: 'Reconcile payments', path: 'manage/contributions', badge: taskCount(['VERIFY_PAYMENTS', 'UNMATCHED_PAYMENTS', 'DISPUTES']) },
    { show: can(P.RECONCILIATION_MANAGE), icon: 'document-attach-outline' as const, label: 'Import statement', path: 'manage/statements', badge: taskCount(['STATEMENT_LINES']) },
    { show: can(P.DESTINATIONS_MANAGE), icon: 'wallet-outline' as const, label: 'Payment details', path: 'manage/destinations', badge: taskCount(['DESTINATION_DECISIONS']) },
    { show: can(P.ROTATIONS_VIEW), icon: 'sync-outline' as const, label: 'View rotation', path: 'rotation' },
    { show: can(P.ROTATIONS_MANAGE), icon: 'calculator-outline' as const, label: 'Prepare payout', path: 'manage/payouts', badge: taskCount(['PAYOUT_PREPARE', 'PAYOUT_SEND']) },
    { show: (d?.tasks.length ?? 0) > 0 || canAny(P.PAYOUTS_APPROVE, P.LOANS_APPROVE, P.EXPENSES_APPROVE), icon: 'checkmark-done-outline' as const, label: 'Review approvals', path: 'manage', badge: d?.tasks.reduce((a, t) => a + t.count, 0) },
    { show: can(P.EXPENSES_RECORD), icon: 'receipt-outline' as const, label: 'Add expense', path: 'manage/expense-new' },
    { show: can(P.MEMBERS_INVITE), icon: 'person-add-outline' as const, label: 'Invite member', path: 'manage/invite' },
    { show: can(P.REPORTS_VIEW), icon: 'document-text-outline' as const, label: 'Generate statement', path: 'manage/reports' },
    { show: can(P.ANNOUNCEMENTS_SEND), icon: 'megaphone-outline' as const, label: 'Announce', path: 'manage/announcements' },
    { show: can(P.MEETINGS_MANAGE), icon: 'calendar-number-outline' as const, label: 'Schedule meeting', path: 'meetings' },
  ].filter((s) => s.show);

  return (
    <Screen refreshing={group.isRefetching || dash.isRefetching} onRefresh={() => { group.refetch(); mine.refetch(); dash.refetch(); }}>
      <Stack.Screen options={{ title: group.data?.name ?? 'Chama' }} />
      {group.error ? <ErrorView error={group.error} onRetry={group.refetch} /> : !group.data ? <Loading /> : (
        <>
          <T variant="small" style={{ marginBottom: space.md }}>
            {`${LABELS.groupType[group.data.type]} · ${group.data.memberCount} members · You are ${roleLabel.toLowerCase()} here${extra.length ? ` (${extra.join(', ')})` : ''}`}
          </T>
          {readOnly && <Notice tone="neutral">You have read-only membership in this group.</Notice>}

          {summary && (
            <StatGrid>
              <Stat label="You owe" value={kes(summary.outstandingCents)} tone={summary.outstandingCents ? 'danger' : 'success'} />
              <Stat label="Your next payment" value={date(summary.nextDueDate)} sub={summary.schedule ? `${kes(summary.schedule.amountCents, true)} ${LABELS.frequency[summary.schedule.frequency].toLowerCase()}` : undefined} />
              <Stat label="Your loan balance" value={kes(summary.loanBalanceCents)} />
              <Stat label="Your next payout" value={date(summary.nextPayoutDate)} />
            </StatGrid>
          )}
          {!readOnly && <Button title="Make a contribution" icon="phone-portrait-outline" onPress={() => go('pay')} style={{ marginBottom: space.sm }} />}
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.xl }}>
            <Button title="How to pay" variant="secondary" icon="wallet-outline" onPress={() => go('how-to-pay')} style={{ flex: 1 }} />
            <Button title="Ask assistant" variant="secondary" icon="sparkles-outline" onPress={() => go('assistant')} style={{ flex: 1 }} />
          </View>

          {dash.error && <Notice tone="red" icon="alert-circle-outline">Could not load the group dashboard. Pull down to retry.</Notice>}
          {officer && d && (
            <>
              <Section title={`${roleLabel} dashboard`}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', padding: space.sm, rowGap: space.sm }}>
                  {shortcuts.map((s) => <Tile key={s.label} icon={s.icon} label={s.label} badge={s.badge || undefined} onPress={() => go(s.path)} />)}
                </View>
              </Section>

              {d.tasks.length > 0 && (
                <Section title="Waiting for you">
                  {d.tasks.map((t, i) => (
                    <Row key={t.key} icon="alert-circle-outline" title={t.label} right={String(t.count)} onPress={() => go(t.key === 'DISTRIBUTION_DECISIONS' ? 'manage' : SECTION_PATH[t.section])} last={i === d.tasks.length - 1} />
                  ))}
                </Section>
              )}

              {d.collections && (
                <Section title={`Collections · ${d.period.label}`}>
                  <View style={{ padding: space.lg, gap: space.md }}>
                    <Progress percent={d.collections.progressPercent} label={`${d.collections.progressPercent}% verified — ${kes(d.collections.verifiedCents)} of ${kes(d.collections.expectedCents)}`} tone={d.collections.progressPercent >= 100 ? 'green' : 'amber'} />
                  </View>
                  <StatGrid>
                    <Stat label="Expected" value={kes(d.collections.expectedCents, true)} />
                    <Stat label="Verified" value={kes(d.collections.verifiedCents, true)} tone="success" />
                    <Stat label="Outstanding" value={kes(d.collections.outstandingCents, true)} tone={d.collections.outstandingCents ? 'warning' : undefined} />
                    <Stat label="Arrears to date" value={kes(d.collections.arrearsCents, true)} tone={d.collections.arrearsCents ? 'danger' : undefined} sub={`${d.collections.membersInArrears} member${d.collections.membersInArrears === 1 ? '' : 's'}`} />
                  </StatGrid>
                  {d.collections.pendingVerificationCount > 0 && (
                    <Row icon="hourglass-outline" title={`${d.collections.pendingVerificationCount} payment${d.collections.pendingVerificationCount === 1 ? '' : 's'} awaiting verification`} subtitle="Not counted until a second officer verifies them" right={kes(d.collections.pendingVerificationCents)} onPress={() => go('manage/contributions')} last />
                  )}
                </Section>
              )}

              {d.nextPayout && (
                <Section title="Next payout">
                  <Row
                    icon="gift-outline"
                    title={`Round ${d.nextPayout.round} · ${d.nextPayout.recipientName}`}
                    subtitle={`${date(d.nextPayout.payoutDate)} · ${kes(d.nextPayout.confirmedCents)} of ${kes(d.nextPayout.expectedCents)} confirmed`}
                    rightSub={<StatusBadge status={d.nextPayout.status} />}
                    onPress={() => go(canAny(P.ROTATIONS_MANAGE, P.PAYOUTS_APPROVE) ? 'manage/payouts' : 'rotation')}
                    last={d.nextPayout.ready === null}
                  />
                  {d.nextPayout.ready !== null && (
                    <View style={{ padding: space.lg }}>
                      {d.nextPayout.ready ? (
                        <T variant="small" style={{ color: colors.success, fontWeight: '600' }}>Readiness checks pass</T>
                      ) : (
                        <T variant="small" style={{ color: colors.error }}>{`Not ready: ${d.nextPayout.blockers.join(', ')}`}</T>
                      )}
                    </View>
                  )}
                </Section>
              )}

              {(d.reconciliation || d.loans || d.cashBalanceCents !== null) && (
                <StatGrid>
                  {[
                    ...(d.cashBalanceCents !== null ? [<Stat key="cash" label="Cash in the books" value={kes(d.cashBalanceCents, true)} />] : []),
                    ...(d.reconciliation ? [<Stat key="rec" label="Unreconciled" value={String(d.reconciliation.pendingVerification + d.reconciliation.unmatched)} sub={`${d.reconciliation.unmatched} M-Pesa unmatched · ${d.reconciliation.duplicateReferences} duplicate refs`} tone={d.reconciliation.pendingVerification + d.reconciliation.unmatched ? 'warning' : undefined} />] : []),
                    ...(d.loans ? [<Stat key="loans" label="Loans outstanding" value={kes(d.loans.outstandingCents, true)} sub={`${d.loans.activeCount} active · ${d.loans.overdueInstallments} overdue installment${d.loans.overdueInstallments === 1 ? '' : 's'}`} tone={d.loans.overdueInstallments ? 'danger' : undefined} />] : []),
                  ]}
                </StatGrid>
              )}

              {d.recentActivity && d.recentActivity.length > 0 && (
                <Section title="Recent money movements">
                  {d.recentActivity.slice(0, 5).map((a, i, arr) => (
                    <Row key={a.id} title={a.description} subtitle={date(a.date)} right={a.direction === 'NONE' ? '—' : `${a.direction === 'IN' ? '+' : '−'}${kes(a.amountCents)}`} last={i === arr.length - 1} />
                  ))}
                </Section>
              )}
            </>
          )}

          {d && d.upcoming.length > 0 && (
            <Section title="Coming up">
              {d.upcoming.map((u, i) => (
                <Row key={`${u.kind}-${u.date}-${i}`} icon={u.kind === 'PAYOUT' ? 'gift-outline' : u.kind === 'MEETING' ? 'calendar-outline' : u.kind === 'LOAN' ? 'cash-outline' : 'wallet-outline'} title={u.label} subtitle={date(u.date)} right={u.amountCents !== null ? kes(u.amountCents) : undefined} last={i === d.upcoming.length - 1} />
              ))}
            </Section>
          )}

          <Section title="My account">
            <Row icon="wallet-outline" title="My contributions" subtitle="Expected, paid and outstanding" onPress={() => go('contributions')} />
            {group.data.loanPolicy.enabled && can(P.LOANS_APPLY) && <Row icon="cash-outline" title="My loans" subtitle="Apply, repayments, schedule" onPress={() => go('loans')} />}
            <Row icon="document-text-outline" title="Group statements" subtitle="Approved financial summaries" onPress={() => go('statements')} />
            <Row icon="checkbox-outline" title="Decisions & votes" onPress={() => go('votes')} />
            <Row icon="chatbubble-ellipses-outline" title="Report a problem or contact officers" subtitle="Disputes about payments, questions" onPress={() => go('manage/dispute')} last />
          </Section>

          <Section title="Group">
            {SECTIONS.filter((s) => s.visible(can, group.data!)).map((s, i, arr) => (
              <Row key={s.key} icon={s.icon} title={s.title} subtitle={s.subtitle} onPress={() => go(s.path)} last={i === arr.length - 1} />
            ))}
          </Section>
          {(can(P.FINDINGS_RAISE) || can(P.FINDINGS_RESOLVE)) && (
            <Section>
              <Row icon="search-outline" title="Audit findings" subtitle={can(P.FINDINGS_RAISE) ? 'Flag discrepancies for officers to answer' : 'Respond to the auditor'} onPress={() => go('findings')} last />
            </Section>
          )}
          {group.data.description && <T variant="small">{group.data.description}</T>}
        </>
      )}
    </Screen>
  );
}
