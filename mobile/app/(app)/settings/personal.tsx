import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { formatKenyanPhone, MeResponse } from '@chamahub/shared';
import { Button, Field, Loading, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAct } from '@/lib/queries';

export default function Personal() {
  const { refreshUser } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('me') });
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (me.data) {
      setFullName(me.data.fullName);
      setEmail(me.data.email ?? '');
    }
  }, [me.data]);
  const save = useAct(() => api('me', { method: 'PATCH', body: { fullName, email: email || null } }), { invalidate: [['me']], successMessage: 'Your details were saved.', onSuccess: () => refreshUser() });
  if (!me.data) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Personal details' }} />
      <Field label="Full name" value={fullName} onChangeText={setFullName} />
      <Field label="Email (optional)" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
      <Field label="Phone number" value={formatKenyanPhone(me.data.phone)} editable={false} hint="Your phone number is your sign-in. Contact support to change it." />
      <Notice tone="neutral">Changing your name updates it in every Chama you belong to.</Notice>
      <Button title="Save" onPress={() => save.mutate(undefined)} loading={save.isPending} disabled={fullName.trim().length < 3} />
    </Screen>
  );
}
