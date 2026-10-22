import { router } from 'expo-router';
import { Alert, View } from 'react-native';
import { formatKenyanPhone } from '@chamahub/shared';
import { Button, Row, Screen, Section, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMyGroups } from '@/lib/queries';
import { colors, space } from '@/theme';

export default function Profile() {
  const { user, signOut } = useAuth();
  const groups = useMyGroups();
  if (!user) return null;
  return (
    <Screen>
      <View style={{ alignItems: 'center', marginVertical: space.lg }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.blush, alignItems: 'center', justifyContent: 'center' }}>
          <T variant="title" style={{ color: colors.berry }}>{user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('')}</T>
        </View>
        <T variant="heading" style={{ marginTop: space.sm }}>{user.fullName}</T>
        <T variant="small">{formatKenyanPhone(user.phone)}</T>
      </View>
      <Section title="Account">
        <Row icon="person-outline" title="Personal details" onPress={() => router.push('/(app)/settings/personal')} />
        <Row icon="notifications-outline" title="Notification preferences" onPress={() => router.push('/(app)/settings/notifications')} />
        <Row icon="shield-checkmark-outline" title="Security & sessions" onPress={() => router.push('/(app)/settings/security')} />
        <Row icon="eye-off-outline" title="Privacy" onPress={() => router.push('/(app)/settings/privacy')} last />
      </Section>
      <Section title="My Chamas">
        {(groups.data ?? []).map((g, i, arr) => <Row key={g.groupId} title={g.name} onPress={() => router.push(`/(app)/group/${g.groupId}`)} last={i === arr.length - 1} />)}
        {groups.data?.length === 0 && <Row title="None yet" last />}
      </Section>
      <Section title="More">
        <Row icon="receipt-outline" title="My payment history" onPress={() => router.push('/(app)/payments')} />
        <Row icon="help-circle-outline" title="Help and support" onPress={() => router.push('/(app)/settings/help')} />
        <Row icon="document-text-outline" title="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
        <Row icon="reader-outline" title="Terms of Use" onPress={() => router.push('/legal/terms')} last />
      </Section>
      <Button title="Sign out" variant="secondary" onPress={() => Alert.alert('Sign out?', 'You will need your password to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} />
      <T variant="small" style={{ textAlign: 'center', marginTop: space.lg }}>ChamaHub · Every Chama. Every Contribution. One Place.</T>
    </Screen>
  );
}
