import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Row, Screen, Section, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useAct } from '@/lib/queries';
import { space } from '@/theme';

const FAQ: [string, string][] = [
  ['Why is my payment "pending"?', 'A treasurer recorded it, but another officer has not yet confirmed the money arrived. It counts once confirmed.'],
  ['When do I get my merry-go-round payout?', 'On your scheduled date, once the round is collected and officers approve it. You receive what was actually collected.'],
  ['Is a loan counted as income in my statement?', 'No. Loans are borrowed money you repay. Your statement shows them separately.'],
  ['Something on my statement looks wrong', 'Open the payment in My contributions and choose “Query this payment”. Your officers will review it.'],
];

export default function Help() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useAct(() => api('me/support', { body: { subject, body } }), { invalidate: [], successMessage: 'Thanks — our support team will get back to you.', onSuccess: () => { setSubject(''); setBody(''); } });
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Help and support' }} />
      <Section title="Common questions">
        {FAQ.map(([q, a], i) => <Row key={q} title={q} subtitle={a} last={i === FAQ.length - 1} />)}
      </Section>
      <Section title="Contact ChamaHub support">
        <View style={{ padding: space.lg }}>
          <Field label="Subject" value={subject} onChangeText={setSubject} />
          <Field label="Message" value={body} onChangeText={setBody} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: 10 }} />
          <Button title="Send" onPress={() => send.mutate(undefined)} loading={send.isPending} disabled={subject.length < 3 || body.length < 5} />
        </View>
      </Section>
      <T variant="small" style={{ textAlign: 'center' }}>For questions about your group's money, talk to your treasurer first.</T>
    </Screen>
  );
}
