import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { formatKenyanPhone, GROUP_ROLES, GroupRole, InvitationRow, LABELS, MemberRow, Permission, SPECIAL_ROLE_INFO, SPECIAL_ROLES, SpecialRole } from '@chamahub/shared';
import { Badge, Button, Chips, Empty, ErrorView, Field, KV, Loading, NoAccess, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { date, kes } from '@/lib/format';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

/** Member directory plus, for permitted officers, invitations, roles, optional roles and status. */
export default function MembersManage() {
  const { groupId, group, can, myMembershipId } = useGroupAccess();
  const P = Permission;
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'EXITED'>('ACTIVE');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['members', groupId, status], queryFn: () => api<MemberRow[]>(`groups/${groupId}/members`, { query: { status } }), enabled: can(P.MEMBERS_VIEW) });
  const invites = useQuery({ queryKey: ['invitations', groupId], queryFn: () => api<InvitationRow[]>(`groups/${groupId}/invitations`), enabled: can(P.MEMBERS_INVITE) });
  const revoke = useAct((id: string) => api(`groups/${groupId}/invitations/${id}`, { method: 'DELETE' }), { invalidate: [['invitations', groupId]], successMessage: 'Invitation cancelled.' });
  const rows = (list.data ?? []).filter((m) => m.fullName.toLowerCase().includes(q.toLowerCase()));
  const pending = (invites.data ?? []).filter((i) => i.status === 'PENDING');
  if (group.data && !can(P.MEMBERS_VIEW)) return <Screen><Stack.Screen options={{ title: 'Members' }} /><NoAccess what="the member directory" /></Screen>;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => { list.refetch(); invites.refetch(); }}>
      <Stack.Screen options={{ title: 'Members' }} />
      {can(P.MEMBERS_INVITE) && <Button title="Invite a member" icon="person-add-outline" onPress={() => router.push(`/(app)/group/${groupId}/manage/invite` as never)} style={{ marginBottom: space.lg }} />}
      {pending.length > 0 && (
        <Section title={`Pending invitations (${pending.length})`}>
          {pending.map((i, idx) => (
            <Row key={i.id} title={i.fullName ?? formatKenyanPhone(i.phone)} subtitle={`${LABELS.groupRole[i.role]} · invited by ${i.invitedByName} · expires ${date(i.expiresAt)}`} right={<Button title="Cancel" variant="ghost" onPress={() => askToConfirm('Cancel this invitation?', 'They will no longer be able to join with it.', 'Cancel invitation', () => revoke.mutate(i.id))} />} last={idx === pending.length - 1} />
          ))}
        </Section>
      )}
      {can(P.MEMBERS_MANAGE) && <Chips value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'EXITED', label: 'Exited' }]} />}
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name" />
      {list.error ? <ErrorView error={list.error} onRetry={list.refetch} /> : !list.data ? <Loading /> : (
        <Section title={`${rows.length} member${rows.length === 1 ? '' : 's'}`}>
          {rows.length === 0 ? <Empty title="No members here" /> : rows.map((m, i) => (
            <View key={m.membershipId}>
              <Row
                title={m.fullName}
                subtitle={[m.phone.startsWith('+') ? formatKenyanPhone(m.phone) : m.phone, ...m.specialRoles.map((r) => SPECIAL_ROLE_INFO[r].label), m.isFounder ? 'Founder' : ''].filter(Boolean).join(' · ')}
                right={m.financials ? kes(m.financials.outstandingCents ? m.financials.outstandingCents : m.financials.contributedCents, true) : undefined}
                rightSub={<Badge label={LABELS.groupRole[m.role]} tone={m.role === 'MEMBER' ? 'neutral' : 'green'} />}
                onPress={() => setOpen(open === m.membershipId ? null : m.membershipId)}
                last={i === rows.length - 1 && open !== m.membershipId}
              />
              {open === m.membershipId && <MemberPanel groupId={groupId} m={m} isMe={m.membershipId === myMembershipId} can={can} />}
            </View>
          ))}
        </Section>
      )}
    </Screen>
  );
}

function MemberPanel({ groupId, m, isMe, can }: { groupId: string; m: MemberRow; isMe: boolean; can: (p: Permission) => boolean }) {
  const P = Permission;
  const [role, setRole] = useState<GroupRole>(m.role);
  const [special, setSpecial] = useState<SpecialRole[]>(m.specialRoles);
  const [reason, setReason] = useState('');
  const inv = [['members', groupId], ['group', groupId]];
  const changeRole = useAct(() => api(`groups/${groupId}/members/${m.membershipId}/role`, { method: 'PATCH', body: { role, reason } }), { invalidate: inv, successMessage: 'Role changed. It takes effect immediately.' });
  const setStatus = useAct((status: 'ACTIVE' | 'SUSPENDED' | 'EXITED') => api(`groups/${groupId}/members/${m.membershipId}/status`, { method: 'PATCH', body: { status, reason } }), { invalidate: inv, successMessage: 'Status updated.' });
  const setRoles = useAct(() => api(`groups/${groupId}/members/${m.membershipId}/special-roles`, { method: 'PUT', body: { specialRoles: special, reason } }), { invalidate: inv, successMessage: 'Optional roles updated.' });
  const reasonOk = reason.trim().length >= 5;
  const phoneVisible = m.phone.startsWith('+');
  return (
    <View style={{ backgroundColor: colors.neutralTint, padding: space.md, gap: space.sm }}>
      {m.financials && (
        <View style={{ backgroundColor: colors.white, borderRadius: 8 }}>
          <KV label="Contributed" value={kes(m.financials.contributedCents)} />
          <KV label="Outstanding contributions" value={kes(m.financials.outstandingCents)} />
          <KV label="Loan balance" value={kes(m.financials.loanBalanceCents)} />
          <KV label="Unpaid fines" value={kes(m.financials.finesOutstandingCents)} />
          <KV label="Joined" value={date(m.joinedAt)} last />
        </View>
      )}
      {phoneVisible && <Button title={`Call ${m.fullName.split(' ')[0]}`} variant="secondary" icon="call-outline" onPress={() => Linking.openURL(`tel:${m.phone}`)} />}
      {isMe ? <T variant="small">You cannot change your own role or status.</T> : (
        <>
          {(can(P.ROLES_ASSIGN) || can(P.MEMBERS_MANAGE)) && <Field label="Reason for any change (kept in the audit log)" value={reason} onChangeText={setReason} />}
          {can(P.ROLES_ASSIGN) && (
            <>
              <T variant="label">Role in this group</T>
              <Chips value={role} onChange={setRole} options={GROUP_ROLES.map((r) => ({ value: r, label: LABELS.groupRole[r] }))} />
              <Button title="Change role" onPress={() => askToConfirm('Change role?', `${m.fullName} becomes ${LABELS.groupRole[role]}. Their permissions change immediately.`, 'Change', () => changeRole.mutate(undefined))} disabled={role === m.role || !reasonOk} loading={changeRole.isPending} />
              <T variant="label" style={{ marginTop: space.sm }}>Optional roles</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {SPECIAL_ROLES.map((r) => {
                  const on = special.includes(r);
                  return <Button key={r} title={`${on ? '✓ ' : ''}${SPECIAL_ROLE_INFO[r].label}`} variant={on ? 'primary' : 'secondary'} onPress={() => setSpecial(on ? special.filter((x) => x !== r) : [...special, r])} style={{ minHeight: 40 }} />;
                })}
              </View>
              <Button title="Save optional roles" variant="secondary" onPress={() => setRoles.mutate(undefined)} disabled={!reasonOk || special.slice().sort().join() === m.specialRoles.slice().sort().join()} loading={setRoles.isPending} />
            </>
          )}
          {can(P.MEMBERS_MANAGE) && (
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              {m.status === 'ACTIVE' ? (
                <>
                  <Button title="Suspend" variant="secondary" onPress={() => askToConfirm('Suspend member?', `${m.fullName} will be read-only until reactivated.`, 'Suspend', () => setStatus.mutate('SUSPENDED'))} disabled={!reasonOk} style={{ flex: 1 }} />
                  <Button title="Exit" variant="danger" onPress={() => askToConfirm('Record exit?', `${m.fullName} leaves the group. Their records stay; what they owe stays owed.`, 'Record exit', () => setStatus.mutate('EXITED'))} disabled={!reasonOk} style={{ flex: 1 }} />
                </>
              ) : m.status === 'SUSPENDED' ? <Button title="Reactivate" onPress={() => setStatus.mutate('ACTIVE')} disabled={!reasonOk} style={{ flex: 1 }} /> : null}
            </View>
          )}
        </>
      )}
    </View>
  );
}
