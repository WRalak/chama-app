import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { passwordSchema, SessionInfo } from '@chamahub/shared';
import { Button, Field, Loading, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

export default function Security() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionInfo[]>('auth/sessions') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const pwError = next ? (passwordSchema.safeParse(next).error?.issues[0].message ?? undefined) : undefined;
  const change = useAct(() => api('auth/password/change', { body: { currentPassword: current, newPassword: next } }), { invalidate: [['sessions']], successMessage: 'Password changed. Other devices were signed out.', onSuccess: () => { setCurrent(''); setNext(''); } });
  const revoke = useAct((id: string) => api(`auth/sessions/${id}`, { method: 'DELETE' }), { invalidate: [['sessions']] });
  const revokeOthers = useAct(() => api('auth/sessions/revoke-others', { method: 'POST' }), { invalidate: [['sessions']], successMessage: 'Other devices were signed out.' });
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Security' }} />
      <Section title="Change password">
        <View style={{ padding: space.lg }}>
          <Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
          <Field label="New password" secureTextEntry value={next} onChangeText={setNext} error={pwError} hint="At least 8 characters with a letter and a number." />
          <Button title="Change password" onPress={() => change.mutate(undefined)} loading={change.isPending} disabled={!current || !next || !!pwError} />
        </View>
      </Section>
      <Section title="Active sessions">
        {!sessions.data ? <Loading /> : sessions.data.map((s, i) => (
          <Row
            key={s.id}
            icon={s.current ? 'phone-portrait' : 'laptop-outline'}
            title={`${s.deviceName ?? 'Unknown device'}${s.current ? ' (this device)' : ''}`}
            subtitle={`Last active ${dateTime(s.lastUsedAt)}`}
            onPress={s.current ? undefined : () => Alert.alert('Sign out this device?', s.deviceName ?? '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => revoke.mutate(s.id) }])}
            last={i === sessions.data!.length - 1}
          />
        ))}
      </Section>
      <Button title="Sign out all other devices" variant="secondary" onPress={() => revokeOthers.mutate(undefined)} loading={revokeOthers.isPending} />
    </Screen>
  );
}
