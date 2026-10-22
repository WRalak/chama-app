import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { MeResponse } from '@chamahub/shared';
import { Button, Field, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { useAct } from '@/lib/queries';
import { colors, space } from '@/theme';

export default function Privacy() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('me') });
  const [reason, setReason] = useState('');
  const prefs = useAct((hide: boolean) => api('me/preferences', { method: 'PUT', body: { ...me.data!.preferences, hidePhoneFromMembers: hide } }), { invalidate: [['me']] });
  const request = useAct(() => api('me/deletion-request', { body: { reason: reason || undefined } }), { invalidate: [['me']] });
  const cancel = useAct(() => api('me/deletion-request', { method: 'DELETE' }), { invalidate: [['me']] });
  if (!me.data) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Privacy' }} />
      <Section title="Who sees what">
        <Row title="Hide my phone number from ordinary members" subtitle="Officers of your groups can always see it." right={<View><Switch value={me.data.preferences.hidePhoneFromMembers} onValueChange={(v) => prefs.mutate(v)} trackColor={{ true: colors.rose }} accessibilityLabel="Hide my phone number" /></View>} last />
      </Section>
      <Notice tone="neutral">Members cannot see each other's balances unless your group turns this on. ChamaHub staff cannot see group finances unless your chairperson approves a time-limited, audited support request.</Notice>
      <Section title="Delete my account">
        <View style={{ padding: space.lg }}>
          {me.data.deletionRequestedAt ? (
            <>
              <T variant="body">{`You asked to delete your account on ${date(me.data.deletionRequestedAt)}. Our team will contact you.`}</T>
              <Button title="Cancel deletion request" variant="secondary" onPress={() => cancel.mutate(undefined)} style={{ marginTop: space.md }} />
            </>
          ) : (
            <>
              <T variant="small" style={{ marginBottom: space.md }}>Your personal details will be removed. Group financial records you were part of must be kept for your Chamas' books, so they are anonymised rather than deleted. Settle any loans first.</T>
              <Field label="Reason (optional)" value={reason} onChangeText={setReason} />
              <Button title="Request account deletion" variant="danger" onPress={() => Alert.alert('Request deletion?', 'This cannot be undone once processed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Request', style: 'destructive', onPress: () => request.mutate(undefined) }])} />
            </>
          )}
        </View>
      </Section>
    </Screen>
  );
}
