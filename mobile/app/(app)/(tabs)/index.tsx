import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { LABELS } from '@chamahub/shared';
import { Badge, Button, Empty, ErrorView, Loading, MoneyCard, Notice, Row, Screen, Section, StatusBadge, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { date, dateTime, kes, relativeDay } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import { colors, radius, shadow, space } from '@/theme';

/**
 * The member's financial home. It answers, from the ledger and records:
 * what have I contributed, what do I owe, has my payment been confirmed,
 * when is my payout, what is my loan balance, and what changed.
 */
export default function Home() {
  const { user } = useAuth();
  const d = useDashboard();
  const first = user?.fullName.split(' ')[0];
  const data = d.data;
  const payout = data?.upcomingPayouts[0];
  return (
    <Screen edges={['top']} refreshing={d.isRefetching} onRefresh={d.refetch}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg }}>
        <View>
          <T variant="small">Habari,</T>
          <T variant="title">{first}</T>
        </View>
        <Pressable onPress={() => router.push('/(app)/(tabs)/activity')} accessibilityRole="button" accessibilityLabel={`Activity${data?.unreadNotifications ? `, ${data.unreadNotifications} unread` : ''}`} style={{ padding: 10, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="notifications-outline" size={24} color={colors.text} />
          {!!data?.unreadNotifications && (
            <View style={{ position: 'absolute', right: 6, top: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.berry, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <T variant="tiny" style={{ color: colors.white }}>{String(data.unreadNotifications)}</T>
            </View>
          )}
        </Pressable>
      </View>

      {d.error ? <ErrorView error={d.error} onRetry={d.refetch} /> : !data ? <Loading label="Loading your Chamas…" /> : data.groups.length === 0 ? (
        <Empty title="You are not in a Chama yet" body="Ask your treasurer for an invitation or join with a group code." icon="people-outline" action={<Button title="Go to My Chamas" onPress={() => router.push('/(app)/(tabs)/chamas')} />} />
      ) : (
        <>
          {data.pendingInvitations > 0 && (
            <Pressable onPress={() => router.push('/(app)/invitations')} accessibilityRole="button">
              <Notice tone="rose" icon="mail-unread-outline">{`You have ${data.pendingInvitations} Chama invitation${data.pendingInvitations > 1 ? 's' : ''}. Tap to respond.`}</Notice>
            </Pressable>
          )}

          {/* What have I contributed? */}
          <View style={{ backgroundColor: colors.plum, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, ...shadow }} accessible accessibilityLabel={`Total confirmed contributions ${kes(data.totalContributedCents)}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={16} color={colors.blush} style={{ marginRight: 6 }} />
              <T variant="small" style={{ color: colors.blush }}>Total confirmed contributions</T>
            </View>
            <T variant="amount" style={{ color: colors.white, marginTop: 4, fontSize: 32, lineHeight: 38 }}>{kes(data.totalContributedCents)}</T>
            <T variant="small" style={{ color: colors.blush, marginTop: 2 }}>{`${kes(data.contributedThisMonthCents)} confirmed this month · ${data.activeGroups} Chama${data.activeGroups === 1 ? '' : 's'}`}</T>
            <Pressable onPress={() => router.push('/(app)/(tabs)/finances')} accessibilityRole="button" style={{ marginTop: space.md, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 40 }}>
              <Ionicons name="document-text-outline" size={16} color={colors.white} style={{ marginRight: 6 }} />
              <T variant="label" style={{ color: colors.white }}>My statement</T>
            </Pressable>
          </View>

          {/* What do I owe? Has my payment been confirmed? */}
          <MoneyCard
            label="Contributions due now"
            icon="wallet-outline"
            amount={kes(data.dueNowCents)}
            status={data.dueNowCents > 0 ? (data.overdueCents > 0 ? { text: `${kes(data.overdueCents, true)} overdue`, tone: 'red' } : { text: 'Due', tone: 'amber' }) : { text: 'Up to date', tone: 'green' }}
            sub={data.nextDeadline ? `Next: ${kes(data.nextDeadline.amountCents)} for ${data.nextDeadline.periodLabel} (${data.nextDeadline.groupName}), due ${relativeDay(data.nextDeadline.dueDate)}` : 'Nothing due in the next 30 days'}
            onPress={data.nextDeadline ? () => router.push(`/(app)/group/${data.nextDeadline!.groupId}/pay`) : undefined}
          />
          <MoneyCard
            label="Payments awaiting verification"
            icon="time-outline"
            amount={kes(data.pendingVerification.cents)}
            status={data.pendingVerification.count ? { text: `${data.pendingVerification.count} reported`, tone: 'amber' } : { text: 'None waiting', tone: 'neutral' }}
            sub="Reported payments count only after an officer, the group’s statement or M-Pesa confirms them."
            onPress={() => router.push('/(app)/(tabs)/finances')}
          />

          {/* When is my payout? What is my loan balance? */}
          <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.xl }}>
            <Pressable style={{ flex: 1 }} onPress={() => (payout ? router.push(`/(app)/group/${payout.groupId}/rotation`) : undefined)} accessibilityRole={payout ? 'button' : undefined} accessibilityLabel={payout ? `My payout: round ${payout.round} of ${payout.totalRounds}, ${date(payout.payoutDate)}` : 'No payout scheduled'}>
              <View style={{ backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, minHeight: 128, ...shadow }}>
                <Ionicons name="gift-outline" size={20} color={colors.rose} />
                <T variant="small" style={{ marginTop: 6 }}>My payout</T>
                {payout ? (
                  <>
                    <T variant="heading">{`Round ${payout.round} of ${payout.totalRounds}`}</T>
                    <T variant="small">{`${date(payout.payoutDate)} · ${payout.groupName}`}</T>
                    <View style={{ marginTop: 4 }}><StatusBadge status={payout.status} /></View>
                  </>
                ) : <T variant="label" style={{ marginTop: 2 }}>Not scheduled</T>}
              </View>
            </Pressable>
            <Pressable style={{ flex: 1 }} onPress={() => router.push('/(app)/(tabs)/finances')} accessibilityRole="button" accessibilityLabel={`Outstanding loan balance ${kes(data.outstandingLoanCents)}`}>
              <View style={{ backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, minHeight: 128, ...shadow }}>
                <Ionicons name="cash-outline" size={20} color={colors.rose} />
                <T variant="small" style={{ marginTop: 6 }}>Loan balance</T>
                <T variant="heading">{kes(data.outstandingLoanCents)}</T>
                <T variant="small">{data.outstandingLoanCents ? 'Principal and interest owed' : 'No active loans'}</T>
              </View>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.xl, marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }} accessibilityLabel="Open a Chama">
            {data.groups.map((g) => (
              <Pressable key={g.groupId} onPress={() => router.push(`/(app)/group/${g.groupId}`)} accessibilityRole="button" accessibilityLabel={`Open ${g.name}, you are ${LABELS.groupRole[g.role]}`} style={{ backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 220, minHeight: 48 }}>
                <T variant="label" numberOfLines={1}>{g.name}</T>
                <T variant="small" numberOfLines={1}>{LABELS.groupRole[g.role]}</T>
              </Pressable>
            ))}
          </ScrollView>

          {data.overdue.length > 0 && (
            <Section title="Overdue">
              {data.overdue.map((o, i) => (
                <Row key={o.id} title={o.groupName} subtitle={`${o.scheduleName} · ${o.periodLabel} · due ${date(o.dueDate)}`} right={kes(o.outstandingCents)} rightSub={<StatusBadge status="OVERDUE" />} onPress={() => router.push(`/(app)/group/${o.groupId}/contributions`)} last={i === data.overdue.length - 1} />
              ))}
            </Section>
          )}

          {data.upcomingPayouts.length > 1 && (
            <Section title="Payout rotation">
              {data.upcomingPayouts.map((p, i) => (
                <Row key={`${p.groupId}-${p.payoutDate}`} title={`${p.groupName} · round ${p.round} of ${p.totalRounds}`} subtitle={`${p.cycleName} · ${date(p.payoutDate)}`} right={kes(p.expectedCents)} rightSub={<Badge label={p.status === 'APPROVED' ? 'Approved' : 'Scheduled'} tone={p.status === 'APPROVED' ? 'green' : 'neutral'} />} onPress={() => router.push(`/(app)/group/${p.groupId}/rotation`)} last={i === data.upcomingPayouts.length - 1} />
              ))}
            </Section>
          )}

          {/* What has changed in my Chama? */}
          <Section title="Recent activity" action={<Pressable onPress={() => router.push('/(app)/(tabs)/activity')} style={{ padding: 8 }} accessibilityRole="link"><T variant="label" style={{ color: colors.berry }}>See all</T></Pressable>}>
            {data.recentActivity.length === 0 ? <Empty title="No confirmed activity yet" icon="time-outline" /> : data.recentActivity.slice(0, 6).map((a, i, arr) => (
              <Row key={a.id} icon={a.kind === 'REVERSAL' ? 'arrow-undo-outline' : 'checkmark-circle-outline'} title={a.title} subtitle={`${a.groupName} · ${dateTime(a.at)}`} right={a.amountCents ? kes(a.amountCents) : undefined} last={i === arr.length - 1} />
            ))}
          </Section>
        </>
      )}
    </Screen>
  );
}
