import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { AttendanceStatus, MeetingDetail, Permission } from '@chamahub/shared';
import { Button, Chips, ErrorView, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { askToConfirm } from '@/lib/confirm';
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
  const canManage = !!group.data?.myMembership.permissions.includes(Permission.MEETINGS_MANAGE);
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
          {canManage && <SecretaryTools groupId={groupId} d={d} />}
          <T variant="small" style={{ color: colors.muted }}>{`${d.attendance.filter((a) => a.status === 'PRESENT').length} present · ${d.attendance.filter((a) => a.status === 'CONFIRMED').length} confirmed`}</T>
        </>
      )}
    </Screen>
  );
}

/** Running the meeting: status, attendance register, minutes, resolutions and action items. */
function SecretaryTools({ groupId, d }: { groupId: string; d: MeetingDetail }) {
  const base = `groups/${groupId}/meetings/${d.id}`;
  const inv = [['meeting', groupId, d.id], ['meetings', groupId], ['group-dashboard', groupId]];
  const [register, setRegister] = useState<Record<string, 'PRESENT' | 'ABSENT' | 'APOLOGY'>>({});
  const [minutes, setMinutes] = useState('');
  const [resTitle, setResTitle] = useState('');
  const [resDetails, setResDetails] = useState('');
  const [action, setAction] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  useEffect(() => {
    setRegister(Object.fromEntries(d.attendance.map((a) => [a.membershipId, a.status === 'PRESENT' || a.status === 'ABSENT' || a.status === 'APOLOGY' ? a.status : a.status === 'CONFIRMED' ? 'PRESENT' : 'ABSENT'])) as Record<string, 'PRESENT' | 'ABSENT' | 'APOLOGY'>);
    setMinutes(d.minutes?.status === 'DRAFT' ? d.minutes.body : '');
  }, [d]);
  const setStatus = useAct((status: 'HELD' | 'CANCELLED') => api(base, { method: 'PATCH', body: { status } }), { invalidate: inv });
  const saveRegister = useAct(() => api(`${base}/attendance`, { method: 'PUT', body: { entries: Object.entries(register).map(([memberId, status]) => ({ memberId, status })) } }), { invalidate: inv, successMessage: 'Attendance saved.' });
  const saveMinutes = useAct(() => api(`${base}/minutes`, { method: 'PUT', body: { body: minutes } }), { invalidate: inv, successMessage: 'Draft minutes saved. Another officer approves them before members see them.' });
  const addResolution = useAct(() => api(`${base}/resolutions`, { body: { title: resTitle.trim(), details: resDetails.trim() || undefined } }), { invalidate: inv, onSuccess: () => { setResTitle(''); setResDetails(''); } });
  const addAction = useAct(() => api(`${base}/actions`, { body: { description: action.trim(), assigneeMemberId: assignee || undefined, dueDate: due || undefined } }), { invalidate: inv, onSuccess: () => { setAction(''); setAssignee(''); setDue(''); } });
  const toggleAction = useAct(({ id, done }: { id: string; done: boolean }) => api(`${base}/actions/${id}`, { method: 'PATCH', body: { done } }), { invalidate: inv });
  const cycle = (s: 'PRESENT' | 'ABSENT' | 'APOLOGY'): 'PRESENT' | 'ABSENT' | 'APOLOGY' => (s === 'PRESENT' ? 'APOLOGY' : s === 'APOLOGY' ? 'ABSENT' : 'PRESENT');
  const label: Record<AttendanceStatus, string> = { PRESENT: 'Present', ABSENT: 'Absent', APOLOGY: 'Apology', CONFIRMED: 'Confirmed', DECLINED: 'Declined' } as Record<AttendanceStatus, string>;
  return (
    <>
      {d.status === 'SCHEDULED' && (
        <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
          <Button title="Mark as held" onPress={() => setStatus.mutate('HELD')} style={{ flex: 1 }} />
          <Button title="Cancel meeting" variant="secondary" onPress={() => askToConfirm('Cancel the meeting?', 'Members will be notified.', 'Cancel meeting', () => setStatus.mutate('CANCELLED'))} style={{ flex: 1 }} />
        </View>
      )}
      {d.status !== 'CANCELLED' && (
        <Section title="Attendance register">
          {d.attendance.map((a, i) => (
            <Row key={a.membershipId} title={a.name} right={<Button title={label[register[a.membershipId] ?? 'ABSENT']} variant={register[a.membershipId] === 'PRESENT' ? 'primary' : 'secondary'} onPress={() => setRegister({ ...register, [a.membershipId]: cycle(register[a.membershipId] ?? 'ABSENT') })} style={{ minHeight: 40, minWidth: 104 }} />} last={i === d.attendance.length - 1} />
          ))}
          <View style={{ padding: space.lg }}><Button title="Save attendance" onPress={() => saveRegister.mutate(undefined)} loading={saveRegister.isPending} /></View>
        </Section>
      )}
      {d.status === 'HELD' && d.minutes?.status !== 'APPROVED' && (
        <Section title="Minutes">
          <View style={{ padding: space.lg }}>
            <Field label="Draft minutes" value={minutes} onChangeText={setMinutes} multiline style={{ minHeight: 140, textAlignVertical: 'top' }} />
            <Button title="Save draft for approval" onPress={() => saveMinutes.mutate(undefined)} disabled={minutes.trim().length < 10} loading={saveMinutes.isPending} />
          </View>
        </Section>
      )}
      {d.status !== 'CANCELLED' && (
        <Section title="Record a resolution">
          <View style={{ padding: space.lg }}>
            <Field label="Resolution" value={resTitle} onChangeText={setResTitle} placeholder="e.g. Invest KES 50,000 in a T-bill" />
            <Field label="Details (optional)" value={resDetails} onChangeText={setResDetails} multiline />
            <Button title="Add resolution" variant="secondary" onPress={() => addResolution.mutate(undefined)} disabled={resTitle.trim().length < 3} loading={addResolution.isPending} />
          </View>
        </Section>
      )}
      <Section title="Action items">
        {d.actions.map((a) => <Row key={a.id} icon={a.done ? 'checkmark-circle' : 'ellipse-outline'} title={a.description} subtitle={`${a.assigneeName ?? 'Unassigned'} · due ${date(a.dueDate)}`} onPress={() => toggleAction.mutate({ id: a.id, done: !a.done })} accessibilityLabel={`${a.description}, ${a.done ? 'done' : 'not done'}. Tap to change.`} />)}
        <View style={{ padding: space.lg }}>
          <Field label="New action" value={action} onChangeText={setAction} placeholder="e.g. Get quotes for the new tent" />
          <Chips value={assignee} onChange={setAssignee} options={[{ value: '', label: 'Unassigned' }, ...d.attendance.map((a) => ({ value: a.membershipId, label: a.name }))]} />
          <Field label="Due date (optional)" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" />
          <Button title="Add action" variant="secondary" onPress={() => addAction.mutate(undefined)} disabled={action.trim().length < 3 || (!!due && !/^\d{4}-\d{2}-\d{2}$/.test(due))} loading={addAction.isPending} />
        </View>
      </Section>
    </>
  );
}
