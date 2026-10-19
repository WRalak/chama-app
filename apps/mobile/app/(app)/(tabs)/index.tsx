import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { LABELS } from '@chamahub/shared';
import { Badge, Button, Empty, ErrorView, Loading, Notice, Row, Screen, Section, Stat, StatGrid, StatusBadge, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { date, dateTime, kes, relativeDay } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import { colors, radius, space } from '@/theme';

export default function Home() {
  const { user } = useAuth();
  const d = useDashboard();
  const first = user?.fullName.split(' ')[0];
  return (
    <Screen edges={['top']} refreshing={d.isRefetching} onRefresh={d.refetch}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg }}>
        <View>
          <T variant="small">Habari,</T>
          <T variant="title">{first}</T>
        </View>
        <Pressable onPress={() => router.push('/(app)/notifications')} accessibilityRole="button" accessibilityLabel={`Notifications${d.data?.unreadNotifications ? `, ${d.data.unreadNotifications} unread` : ''}`} style={{ padding: 10 }}>
          <Ionicons name="notifications-outline" size={24} color={colors.navy} />
          {!!d.data?.unreadNotifications && <View style={{ position: 'absolute', right: 8, top: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error }} />}
        </Pressable>
      </View>

      {d.error ? <ErrorView error={d.error} onRetry={d.refetch} /> : !d.data ? <Loading /> : (
        <>
          {d.data.pendingInvitations > 0 && (
            <Pressable onPress={() => router.push('/(app)/invitations')} accessibilityRole="button">
              <Notice tone="green" icon="mail-unread-outline">{`You have ${d.data.pendingInvitations} Chama invitation${d.data.pendingInvitations > 1 ? 's' : ''}. Tap to respond.`}</Notice>
            </Pressable>
          )}
          {d.data.overdueCents > 0 && <Notice tone="red" icon="alert-circle-outline">{`${kes(d.data.overdueCents)} is overdue across your Chamas.`}</Notice>}

          {d.data.groups.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.lg, marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }} accessibilityLabel="Switch Chama">
              {d.data.groups.map((g) => (
                <Pressable key={g.groupId} onPress={() => router.push(`/(app)/group/${g.groupId}`)} accessibilityRole="button" accessibilityLabel={`Open ${g.name}`} style={{ backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 220 }}>
                  <T variant="label" numberOfLines={1}>{g.name}</T>
                  <T variant="small" numberOfLines={1}>{LABELS.groupRole[g.role]}</T>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <StatGrid>
            <Stat label="Active Chamas" value={String(d.data.activeGroups)} />
            <Stat label="Paid this month" value={kes(d.data.contributedThisMonthCents, true)} tone="success" />
            <Stat label="Overdue" value={kes(d.data.overdueCents, true)} tone={d.data.overdueCents ? 'danger' : undefined} />
            <Stat label="Loan balance" value={kes(d.data.outstandingLoanCents, true)} />
            <Stat label="Payouts received" value={kes(d.data.payoutsReceivedCents, true)} />
            <Stat label="Upcoming payouts" value={String(d.data.upcomingPayouts.length)} sub={d.data.upcomingPayouts[0] ? date(d.data.upcomingPayouts[0].payoutDate) : undefined} />
          </StatGrid>

          {d.data.overdue.length > 0 && (
            <Section title="Overdue">
              {d.data.overdue.map((o, i) => (
                <Row key={o.id} title={o.groupName} subtitle={`${o.scheduleName} · ${o.periodLabel} · due ${date(o.dueDate)}`} right={kes(o.outstandingCents)} rightSub={<StatusBadge status="OVERDUE" />} onPress={() => router.push(`/(app)/group/${o.groupId}/contributions`)} last={i === d.data!.overdue.length - 1} />
              ))}
            </Section>
          )}

          <Section title="Upcoming contributions" action={<Pressable onPress={() => router.push('/(app)/(tabs)/calendar')} style={{ padding: 6 }}><T variant="label" style={{ color: colors.forest }}>Calendar</T></Pressable>}>
            {d.data.upcoming.length === 0 ? <Empty title="Nothing due in the next 30 days" icon="checkmark-done-outline" /> : d.data.upcoming.map((o, i) => (
              <Row key={o.id} title={o.groupName} subtitle={`${o.periodLabel} · ${relativeDay(o.dueDate)}`} right={kes(o.outstandingCents)} rightSub={o.pendingCents ? <StatusBadge status="PENDING" /> : <StatusBadge status={o.status} />} onPress={() => router.push(`/(app)/group/${o.groupId}/contributions`)} last={i === d.data!.upcoming.length - 1} />
            ))}
          </Section>

          {d.data.upcomingPayouts.length > 0 && (
            <Section title="Your upcoming payouts">
              {d.data.upcomingPayouts.map((p, i) => (
                <Row key={`${p.groupId}-${p.payoutDate}`} title={p.groupName} subtitle={`${p.cycleName} · ${date(p.payoutDate)}`} right={kes(p.expectedCents)} rightSub={<Badge label={p.status === 'APPROVED' ? 'Approved' : 'Scheduled'} tone={p.status === 'APPROVED' ? 'green' : 'neutral'} />} onPress={() => router.push(`/(app)/group/${p.groupId}/rotation`)} last={i === d.data!.upcomingPayouts.length - 1} />
              ))}
            </Section>
          )}

          <Section title="Recent activity">
            {d.data.recentActivity.length === 0 ? <Empty title="No activity yet" /> : d.data.recentActivity.slice(0, 8).map((a, i, arr) => (
              <Row key={a.id} title={a.title} subtitle={`${a.groupName} · ${dateTime(a.at)}`} right={a.amountCents ? kes(a.amountCents) : undefined} last={i === arr.length - 1} />
            ))}
          </Section>

          {d.data.groups.length === 0 && <Empty title="You are not in a Chama yet" body="Ask your treasurer for an invitation or join with a group code." action={<Button title="Go to My Chamas" variant="secondary" onPress={() => router.push('/(app)/(tabs)/chamas')} />} />}
        </>
      )}
    </Screen>
  );
}
