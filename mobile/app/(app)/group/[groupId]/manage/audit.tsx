import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuditEventRow, Paginated, Permission } from '@chamahub/shared';
import { Button, Chips, Empty, ErrorView, Loading, Notice, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { colors, space } from '@/theme';

const AREAS = [
  { value: 'ALL', label: 'Everything', entityType: undefined },
  { value: 'Payment', label: 'Payments', entityType: 'Payment' },
  { value: 'PayoutRound', label: 'Payouts', entityType: 'PayoutRound' },
  { value: 'Loan', label: 'Loans', entityType: 'Loan' },
  { value: 'Expense', label: 'Expenses', entityType: 'Expense' },
  { value: 'Membership', label: 'Members', entityType: 'Membership' },
  { value: 'Group', label: 'Rules', entityType: 'Group' },
] as const;

/** Plain-language version of an audit action code like "payout.prepared". */
function describe(action: string) {
  const [area, verb] = action.split('.');
  return `${area.replace(/_/g, ' ')} · ${(verb ?? '').replace(/_/g, ' ')}`;
}

/**
 * The append-only activity history. What each person sees is decided by the
 * API: auditors and chairpersons the full log, treasurers and secretaries their
 * areas, everyone else their own actions.
 */
export default function Audit() {
  const { groupId, can } = useGroupAccess();
  const [area, setArea] = useState<(typeof AREAS)[number]['value']>('ALL');
  const entityType = AREAS.find((a) => a.value === area)?.entityType;
  const q = useInfiniteQuery({
    queryKey: ['audit', groupId, area],
    queryFn: ({ pageParam }) => api<Paginated<AuditEventRow>>(`groups/${groupId}/audit`, { query: { page: pageParam, pageSize: 30, entityType } }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const scope = can(Permission.AUDIT_VIEW) ? 'the full group log' : can(Permission.AUDIT_VIEW_AREA) ? 'records for the areas you work in, plus your own actions' : 'your own actions';
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'Activity & audit' }} />
      <Notice tone="neutral">{`You are seeing ${scope}. Entries cannot be edited or deleted by anyone.`}</Notice>
      {can(Permission.FINDINGS_RAISE) && <Button title="Flag a discrepancy" icon="flag-outline" variant="secondary" onPress={() => router.push(`/(app)/group/${groupId}/findings` as never)} style={{ marginBottom: space.lg }} />}
      <Chips value={area} onChange={setArea} options={AREAS.map((a) => ({ value: a.value, label: a.label }))} />
      {q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data ? <Loading /> : (
        <Section title={`${q.data.pages[0]?.total ?? 0} entries`}>
          {rows.length === 0 ? <Empty title="No activity recorded here" icon="time-outline" /> : rows.map((e, i) => (
            <View key={e.id} style={{ padding: space.lg, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
              <T variant="label" style={{ textTransform: 'capitalize' }}>{describe(e.action)}</T>
              <T variant="small">{`${dateTime(e.at)} · ${e.actorName ?? 'System'}`}</T>
              {e.reason && <T variant="small">{`Reason: ${e.reason}`}</T>}
              {e.reference && <T variant="small">{`Reference: ${e.reference}`}</T>}
            </View>
          ))}
        </Section>
      )}
      {q.hasNextPage && <Button title="Load more" variant="secondary" onPress={() => q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </Screen>
  );
}
