import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, View } from 'react-native';
import { MeetingDetail, Permission } from '@chamahub/shared';
import { Button, ErrorView, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, kes } from '@/lib/format';
import { useAct, useGroup } from '@/lib/queries';
import { colors, space } from '@/theme';

export default function Meeting() {
  const { groupId, meetingId } = useLocalSearchParams<{ groupId: string; meetingId: string }>();
  const { user } = useAuth();
  const m = useQuery({ queryKey: ['meeting', groupId, meetingId], queryFn: () => api<MeetingDetail>(`groups/${groupId}/meetings/${meetingId}`) });
  const rsvp = useAct((status: 'CONFIRMED' | 'DECLINED' | 'APOLOGY') => api(`groups/${groupId}/meetings/${meetingId}/rsvp`, { method: 'PUT', body: { status } }), { invalidate: [['meeting', groupId, meetingId], ['meetings', groupId]] });
  const group = useGroup(groupId);
  const canApproveMinutes = group.data?.myMembership.permissions.includes(Permission.MINUTES_APPROVE);
  const approve = useAct(() => api(`groups/${groupId}/meetings/${meetingId}/minutes/approve`, { method: 'POST' }), { invalidate: [['meeting', groupId, meetingId]], successMessage: 'Minutes published to members.' });
  const d = m.data;
  const myActions = d?.actions.filter((a) => a.assigneeName === user?.fullName) ?? [];
  return (
    <Screen refreshing={m.isRefetching} onRefresh={m.refetch}>
      <Stack.Screen options={{ title: 'Meeting' }} />
      {m.error ? <ErrorView error={m.error} onRetry={m.refetch} /> : !d ? <Loading /> : (
        <>
          <T variant="title">{d.title}</T>
          <T variant="small" style={{ marginBottom: space.lg }}>{`${dateTime(d.scheduledAt)}${d.location ? ` · ${d.location}` : ''}`}</T>
          {d.virtualLink && <Button title="Join online" variant="secondary" icon="videocam-outline" onPress={() => Linking.openURL(d.virtualLink!)} style={{ marginBottom: space.lg }} />}
          {d.status === 'SCHEDULED' && d.requiresRsvp && (
            <Section title="Will you attend?">
              <View style={{ padding: space.lg, gap: space.sm }}>
                {d.myAttendance && <T variant="small">{`Your reply: ${d.myAttendance.toLowerCase()}`}</T>}
                <Button title="Yes, I will attend" onPress={() => rsvp.mutate('CONFIRMED')} variant={d.myAttendance === 'CONFIRMED' ? 'primary' : 'secondary'} loading={rsvp.isPending} />
                <Button title="Send apology" onPress={() => rsvp.mutate('APOLOGY')} variant={d.myAttendance === 'APOLOGY' ? 'primary' : 'secondary'} />
              </View>
            </Section>
          )}
          {d.status === 'CANCELLED' && <Notice tone="red">This meeting was cancelled.</Notice>}
          {d.agenda.length > 0 && (
            <Section title="Agenda">
              {d.agenda.map((a, i) => <Row key={i} title={`${i + 1}. ${a}`} last={i === d.agenda.length - 1} />)}
            </Section>
          )}
          {myActions.length > 0 && (
            <Section title="Your actions">
              {myActions.map((a, i) => <Row key={a.id} icon={a.done ? 'checkmark-circle' : 'ellipse-outline'} title={a.description} subtitle={`Due ${date(a.dueDate)}`} last={i === myActions.length - 1} />)}
            </Section>
          )}
          {d.minutes?.status === 'APPROVED' ? (
            <Section title="Approved minutes">
              <View style={{ padding: space.lg }}>
                <T variant="body">{d.minutes.body}</T>
                <T variant="small" style={{ marginTop: space.md }}>{`Approved by ${d.minutes.approvedByName} on ${date(d.minutes.approvedAt)}`}</T>
              </View>
            </Section>
          ) : d.minutes && canApproveMinutes ? (
            <Section title="Draft minutes — awaiting your approval">
              <View style={{ padding: space.lg }}>
                <T variant="body">{d.minutes.body}</T>
                <Button title="Approve and publish" onPress={() => approve.mutate(undefined)} loading={approve.isPending} style={{ marginTop: space.md }} />
                <T variant="small" style={{ marginTop: space.sm }}>Minutes must be approved by someone other than whoever wrote them.</T>
              </View>
            </Section>
          ) : d.status === 'HELD' ? <Notice tone="neutral">Minutes will appear once approved.</Notice> : null}
          {d.resolutions.length > 0 && (
            <Section title="Resolutions">
              {d.resolutions.map((r, i) => <Row key={r.id} title={r.title} subtitle={r.details ?? undefined} right={r.isFinancial && r.amountCents !== null ? kes(r.amountCents) : undefined} last={i === d.resolutions.length - 1} />)}
            </Section>
          )}
          {d.actions.length > 0 && (
            <Section title="All actions">
              {d.actions.map((a, i) => <Row key={a.id} title={a.description} subtitle={`${a.assigneeName ?? 'Unassigned'} · due ${date(a.dueDate)}`} right={a.done ? 'Done' : undefined} last={i === d.actions.length - 1} />)}
            </Section>
          )}
          <T variant="small" style={{ color: colors.muted }}>{`${d.attendance.filter((a) => a.status === 'PRESENT').length} present · ${d.attendance.filter((a) => a.status === 'CONFIRMED').length} confirmed`}</T>
        </>
      )}
    </Screen>
  );
}
