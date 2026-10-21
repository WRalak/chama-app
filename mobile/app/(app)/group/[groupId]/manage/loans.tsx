import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { LoanSummary, Permission } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Loading, NoAccess, Notice, Row, Screen, Section, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { space } from '@/theme';

type Filter = 'PENDING_APPROVAL' | 'APPROVED' | 'DISBURSED' | 'OVERDUE' | 'ALL';

/** Loan book for officers and loan committee members; each loan opens its review/disbursement screen. */
export default function LoansManage() {
  const { groupId, group, can, canAny, myMembershipId } = useGroupAccess();
  const P = Permission;
  const [filter, setFilter] = useState<Filter>('PENDING_APPROVAL');
  const allowed = canAny(P.LOANS_VIEW_ALL, P.LOANS_APPROVE, P.LOANS_DISBURSE, P.LOANS_PREPARE);
  const list = useQuery({
    queryKey: ['loans', groupId, filter],
    queryFn: () => api<LoanSummary[]>(`groups/${groupId}/loans`, { query: filter === 'ALL' ? {} : filter === 'OVERDUE' ? { overdue: 'true' } : { status: filter } }),
    enabled: allowed,
  });
  if (group.data && (!allowed || !group.data.loanPolicy.enabled)) return <Screen><Stack.Screen options={{ title: 'Loans' }} />{group.data.loanPolicy.enabled ? <NoAccess what="the loan book" /> : <Notice tone="neutral">This group does not offer loans.</Notice>}</Screen>;
  const rows = list.data ?? [];
  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Stack.Screen options={{ title: 'Loans' }} />
      {can(P.LOANS_PREPARE) && <Button title="Prepare an application for a member" variant="secondary" icon="create-outline" onPress={() => router.push(`/(app)/group/${groupId}/loans/apply?forMember=1` as never)} style={{ marginBottom: space.lg }} />}
      <Chips value={filter} onChange={setFilter} options={[{ value: 'PENDING_APPROVAL', label: 'To review' }, { value: 'APPROVED', label: 'To disburse' }, { value: 'DISBURSED', label: 'Active' }, { value: 'OVERDUE', label: 'Overdue' }, { value: 'ALL', label: 'All' }]} />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section title={`${rows.length} loan${rows.length === 1 ? '' : 's'}${rows.length ? ` · ${kes(rows.reduce((a, l) => a + l.outstandingCents, 0), true)} outstanding` : ''}`}>
          {rows.length === 0 ? <Empty title="Nothing here" icon="cash-outline" /> : rows.map((l, i) => (
            <Row
              key={l.id}
              title={`${l.memberName}${l.membershipId === myMembershipId ? ' (you)' : ''} · ${kes(l.principalCents)}`}
              subtitle={`${l.purpose} · ${l.status === 'PENDING_APPROVAL' ? `${l.approvalsReceived}/${l.approvalsRequired} approvals · applied ${date(l.appliedAt)}` : l.nextInstallment ? `next ${kes(l.nextInstallment.amountCents, true)} on ${date(l.nextInstallment.dueDate)}` : `applied ${date(l.appliedAt)}`}`}
              right={l.status === 'DISBURSED' ? kes(l.outstandingCents, true) : undefined}
              rightSub={<StatusBadge status={l.overdueCents ? 'OVERDUE' : l.status} />}
              onPress={() => router.push(`/(app)/group/${groupId}/loans/${l.id}` as never)}
              last={i === rows.length - 1}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
