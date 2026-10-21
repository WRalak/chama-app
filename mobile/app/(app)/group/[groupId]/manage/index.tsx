import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { DashboardTask, DistributionRecord, GroupDashboard, LABELS, Permission } from '@chamahub/shared';
import { Button, Empty, ErrorView, Loading, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

const PATH: Record<DashboardTask['section'], string> = {
  contributions: 'manage/contributions',
  loans: 'manage/loans',
  expenses: 'manage/expenses',
  payouts: 'manage/payouts',
  meetings: 'meetings',
  audit: 'findings',
  members: 'manage/members',
  reports: 'manage',
};

/** "Review approvals": everything waiting for this officer, counted with the same rules the actions enforce. */
export default function Approvals() {
  const { groupId, can } = useGroupAccess();
  const dash = useQuery({ queryKey: ['group-dashboard', groupId], queryFn: () => api<GroupDashboard>(`groups/${groupId}/dashboard`) });
  const dists = useQuery({ queryKey: ['distributions', groupId], queryFn: () => api<DistributionRecord[]>(`groups/${groupId}/distributions`), enabled: can(Permission.DISTRIBUTIONS_APPROVE) && can(Permission.REPORTS_VIEW) });
  const decideDist = useAct(({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api(`groups/${groupId}/distributions/${id}/decision`, { body: { decision } }), { invalidate: [['distributions', groupId], ['group-dashboard', groupId]], successMessage: 'Decision recorded.' });
  const pendingDists = (dists.data ?? []).filter((d) => d.status === 'PENDING_APPROVAL');
  const tasks = (dash.data?.tasks ?? []).filter((t) => t.key !== 'DISTRIBUTION_DECISIONS');
  return (
    <Screen refreshing={dash.isRefetching} onRefresh={() => { dash.refetch(); dists.refetch(); }}>
      <Stack.Screen options={{ title: 'Review approvals' }} />
      {dash.error ? <ErrorView error={dash.error} onRetry={dash.refetch} /> : !dash.data ? <Loading /> : (
        <>
          <Section title="Waiting for you">
            {tasks.length === 0 ? <Empty title="Nothing is waiting for you" icon="checkmark-done-outline" /> : tasks.map((t, i) => (
              <Row key={t.key} icon="alert-circle-outline" title={t.label} right={String(t.count)} onPress={() => router.push(`/(app)/group/${groupId}/${PATH[t.section]}` as never)} last={i === tasks.length - 1} />
            ))}
          </Section>
          {pendingDists.length > 0 && (
            <Section title="Distributions awaiting approval">
              {pendingDists.map((d, i) => (
                <View key={d.id} style={{ padding: space.lg, borderBottomWidth: i === pendingDists.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
                  <T variant="label">{`${d.title} · ${kes(d.calculation.distributedCents)}`}</T>
                  <T variant="small">{`${LABELS.distributionMethod[d.method]} · cash ${kes(d.calculation.availableCashCents)}, retained ${kes(d.calculation.retainedCents)} · prepared by ${d.createdByName}`}</T>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                    <Button title="Approve" onPress={() => askToConfirm('Approve this distribution?', `${kes(d.calculation.distributedCents)} to members.`, 'Approve', () => decideDist.mutate({ id: d.id, decision: 'APPROVE' }))} style={{ flex: 1 }} />
                    <Button title="Reject" variant="secondary" onPress={() => decideDist.mutate({ id: d.id, decision: 'REJECT' })} style={{ flex: 1 }} />
                  </View>
                </View>
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
