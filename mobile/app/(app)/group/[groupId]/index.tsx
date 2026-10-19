import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { LABELS, LoanSummary, Paginated, PaymentItem, Permission, RotationCycle, SPECIAL_ROLE_INFO } from '@chamahub/shared';
import { Button, ErrorView, Loading, Notice, Row, Screen, Section, Stat, StatGrid, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useGroup, useMyGroups } from '@/lib/queries';
import { space } from '@/theme';

export default function GroupHome() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroup(groupId);
  const mine = useMyGroups();
  const summary = mine.data?.find((g) => g.groupId === groupId);
  const perms = group.data?.myMembership.permissions ?? [];
  const can = (p: string) => perms.includes(p as never);
  const approvals = [Permission.CONTRIBUTIONS_VERIFY, Permission.CONTRIBUTIONS_RECORD, Permission.LOANS_APPROVE, Permission.EXPENSES_APPROVE, Permission.PAYOUTS_APPROVE, Permission.ROTATIONS_MANAGE, Permission.DISTRIBUTIONS_APPROVE].some((p) => can(p));
  const meetingTools = can(Permission.MEETINGS_MANAGE) || can(Permission.MINUTES_APPROVE);
  const findingTools = can(Permission.FINDINGS_RAISE) || can(Permission.FINDINGS_RESOLVE);
  const officer = approvals || meetingTools || findingTools;
  const roleLabel = group.data ? LABELS.groupRole[group.data.myMembership.role] : '';
  const extra = group.data?.myMembership.specialRoles.filter((r) => r !== 'READ_ONLY').map((r) => SPECIAL_ROLE_INFO[r].label) ?? [];
  const pending = useQuery({ queryKey: ['payments', groupId, 'PENDING'], queryFn: () => api<Paginated<PaymentItem>>(`groups/${groupId}/payments`, { query: { status: 'PENDING', pageSize: 1 } }), enabled: can(Permission.CONTRIBUTIONS_VERIFY) });
  const loansPending = useQuery({ queryKey: ['loans', groupId, 'PENDING_APPROVAL'], queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: { status: 'PENDING_APPROVAL' } }), enabled: can(Permission.LOANS_APPROVE) });
  const rotations = useQuery({ queryKey: ['rotations', groupId], queryFn: () => api<RotationCycle[]>(`groups/${groupId}/rotations`), enabled: !!group.data });
  const hasRotation = (rotations.data?.length ?? 0) > 0;
  const toDo = (pending.data?.total ?? 0) + (loansPending.data?.length ?? 0);

  return (
    <Screen refreshing={group.isRefetching} onRefresh={() => { group.refetch(); mine.refetch(); }}>
      <Stack.Screen options={{ title: group.data?.name ?? 'Chama' }} />
      {group.error ? <ErrorView error={group.error} onRetry={group.refetch} /> : !group.data ? <Loading /> : (
        <>
          <T variant="small" style={{ marginBottom: space.md }}>{`${LABELS.groupType[group.data.type]} · ${group.data.memberCount} members · You are ${roleLabel.toLowerCase()} here`}</T>
          {summary && (
            <StatGrid>
              <Stat label="Outstanding" value={kes(summary.outstandingCents)} tone={summary.outstandingCents ? 'danger' : 'success'} />
              <Stat label="Next payment" value={date(summary.nextDueDate)} sub={summary.schedule ? `${kes(summary.schedule.amountCents, true)} ${LABELS.frequency[summary.schedule.frequency].toLowerCase()}` : undefined} />
              <Stat label="Loan balance" value={kes(summary.loanBalanceCents)} />
              <Stat label="Your next payout" value={date(summary.nextPayoutDate)} />
            </StatGrid>
          )}
          <Button title="Make a contribution" icon="phone-portrait-outline" onPress={() => router.push(`/(app)/group/${groupId}/pay`)} style={{ marginBottom: space.xl }} />
          {approvals && toDo > 0 && (
            <Notice tone="amber" icon="clipboard-outline">{`${toDo} item${toDo > 1 ? 's' : ''} waiting for you as ${roleLabel.toLowerCase()}.`}</Notice>
          )}
          {group.data.myMembership.specialRoles.includes('READ_ONLY') && <Notice tone="neutral">You have read-only membership in this group.</Notice>}
          <Section title="My account">
            <Row icon="wallet-outline" title="My contributions" subtitle="Expected, paid and outstanding" onPress={() => router.push(`/(app)/group/${groupId}/contributions`)} />
            {group.data.loanPolicy.enabled && can(Permission.LOANS_APPLY) && <Row icon="cash-outline" title="Loans" subtitle="Apply, calculate, repayment schedule" onPress={() => router.push(`/(app)/group/${groupId}/loans`)} />}
            {(hasRotation || group.data.type === 'MERRY_GO_ROUND') && <Row icon="sync-outline" title="Payout rotation" subtitle="Who receives and when" onPress={() => router.push(`/(app)/group/${groupId}/rotation`)} />}
            <Row icon="document-text-outline" title="Group statements" subtitle="Approved financial summaries" onPress={() => router.push(`/(app)/group/${groupId}/statements`)} />
            <Row icon="checkbox-outline" title="Decisions & votes" onPress={() => router.push(`/(app)/group/${groupId}/votes`)} />
            <Row icon="calendar-outline" title="Meetings & minutes" onPress={() => router.push(`/(app)/group/${groupId}/meetings`)} />
            <Row icon="people-outline" title="Members" onPress={() => router.push(`/(app)/group/${groupId}/members`)} last />
          </Section>
          {officer && (
            <Section title={`${roleLabel} tools${extra.length ? ` · ${extra.join(', ')}` : ''}`}>
              {approvals && <Row icon="clipboard-outline" title="Approvals & recording" subtitle="Verify payments, record cash, approve loans and expenses, run payouts" onPress={() => router.push(`/(app)/group/${groupId}/manage`)} last={!meetingTools && !findingTools} />}
              {meetingTools && <Row icon="calendar-number-outline" title="Run meetings" subtitle="Schedule meetings, approve minutes" onPress={() => router.push(`/(app)/group/${groupId}/meetings`)} last={!findingTools} />}
              {findingTools && <Row icon="search-outline" title="Audit findings" subtitle={can(Permission.FINDINGS_RAISE) ? 'Flag discrepancies for officers to answer' : 'Respond to the auditor'} onPress={() => router.push(`/(app)/group/${groupId}/findings`)} last />}
            </Section>
          )}
          {group.data.description && (
            <View style={{ marginTop: -space.sm }}>
              <T variant="small">{group.data.description}</T>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
