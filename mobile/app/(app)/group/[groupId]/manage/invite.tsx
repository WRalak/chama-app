import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';
import { GROUP_ROLES, GroupRole, LABELS, normalizeKenyanPhone, Permission } from '@chamahub/shared';
import { Button, Chips, Field, Loading, NoAccess, Notice, Screen, Section, KV } from '@/components/ui';
import { api } from '@/lib/api';
import { useGroupAccess } from '@/lib/group';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

/** Invites by phone number with a role; or shares the group's join code. */
export default function Invite() {
  const { groupId, group, can } = useGroupAccess();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<GroupRole>('MEMBER');
  let normalized: string | null = null;
  try {
    normalized = phone ? normalizeKenyanPhone(phone) : null;
  } catch {
    normalized = null;
  }
  const invite = useAct(() => api(`groups/${groupId}/invitations`, { body: { phone, fullName: name.trim() || undefined, role } }), { invalidate: [['invitations', groupId]], successMessage: 'Invitation sent. They join once they accept in the app.', onSuccess: () => router.back() });
  if (group.data && !can(Permission.MEMBERS_INVITE)) return <Screen><Stack.Screen options={{ title: 'Invite a member' }} /><NoAccess what="inviting members" /></Screen>;
  const code = group.data?.inviteCode;
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Invite a member' }} />
      {!group.data ? <Loading /> : (
        <>
          <Field label="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="0712 345 678" error={phone && !normalized ? 'Enter a valid Kenyan number' : undefined} />
          <Field label="Name (optional)" value={name} onChangeText={setName} />
          <Chips value={role} onChange={setRole} options={GROUP_ROLES.filter((r) => can(Permission.ROLES_ASSIGN) || r === 'MEMBER').map((r) => ({ value: r, label: LABELS.groupRole[r] }))} />
          {role !== 'MEMBER' && <Notice tone="amber" icon="shield-outline">{`${LABELS.groupRole[role]} gets officer permissions as soon as they accept.`}</Notice>}
          <Button title="Send invitation" onPress={() => invite.mutate(undefined)} disabled={!normalized} loading={invite.isPending} />
          {code && (
            <Section title="Or share the join code" style={{ marginTop: space.xl }}>
              <KV label="Join code" value={code} />
              <Button title="Share join code" variant="ghost" icon="share-social-outline" onPress={() => Share.share({ message: `Join ${group.data!.name} on ChamaHub with code ${code}. Officers approve new members.` })} />
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
