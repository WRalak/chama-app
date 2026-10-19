import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Switch, View } from 'react-native';
import { IntegrationStatus, MeResponse, NotificationPreferences } from '@chamahub/shared';
import { Loading, Notice, Row, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { useAct } from '@/lib/queries';
import { colors } from '@/theme';

const CHANNELS: [keyof NotificationPreferences, string, keyof IntegrationStatus | null][] = [
  ['sms', 'SMS', 'sms'],
  ['whatsapp', 'WhatsApp', 'whatsapp'],
  ['email', 'Email', 'email'],
];
const TOPICS: [keyof NotificationPreferences, string][] = [
  ['contributionReminders', 'Contribution reminders'],
  ['loanReminders', 'Loan repayment reminders'],
  ['meetingReminders', 'Meeting reminders'],
  ['announcements', 'Group announcements'],
];

export default function NotificationSettings() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('me') });
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api<IntegrationStatus>('integrations/status', { auth: false }) });
  const save = useAct((p: NotificationPreferences) => api('me/preferences', { method: 'PUT', body: p }), { invalidate: [['me']] });
  if (!me.data) return <Loading />;
  const prefs = save.variables ?? me.data.preferences;
  const toggle = (k: keyof NotificationPreferences, v: boolean) => save.mutate({ ...prefs, [k]: v });
  const sw = (k: keyof NotificationPreferences, label: string) => <Switch value={prefs[k]} onValueChange={(v) => toggle(k, v)} trackColor={{ true: colors.emerald }} accessibilityLabel={label} />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Notice tone="neutral">In-app notifications are always on. Choose how else we reach you.</Notice>
      <Section title="Channels">
        {CHANNELS.map(([k, label, integ], i) => (
          <Row key={k} title={label} subtitle={integ && status.data && !(status.data[integ] as { configured: boolean }).configured ? 'Not yet available on ChamaHub' : undefined} right={<View>{sw(k, label)}</View>} last={i === CHANNELS.length - 1} />
        ))}
      </Section>
      <Section title="What to send">
        {TOPICS.map(([k, label], i) => <Row key={k} title={label} right={<View>{sw(k, label)}</View>} last={i === TOPICS.length - 1} />)}
      </Section>
      <Notice tone="neutral">Payment confirmations, loan decisions and invitations are always sent.</Notice>
    </Screen>
  );
}
