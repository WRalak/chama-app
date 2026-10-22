import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { privacyPolicy, termsOfUse, type LegalOperator } from '@chamahub/shared';
import { Notice, Screen, T } from '@/components/ui';
import { date } from '@/lib/format';
import { colors, space } from '@/theme';

/** Operator details from mobile/.env (EXPO_PUBLIC_*), the same values the website uses. */
const operator: LegalOperator = {
  legalName: process.env.EXPO_PUBLIC_LEGAL_NAME,
  address: process.env.EXPO_PUBLIC_LEGAL_ADDRESS,
  email: process.env.EXPO_PUBLIC_CONTACT_EMAIL,
  odpcRegistration: process.env.EXPO_PUBLIC_ODPC_REGISTRATION,
};

/** Privacy Policy or Terms of Use. Readable signed in or out (linked from sign-up and Profile). */
export default function LegalScreen() {
  const { doc: which } = useLocalSearchParams<{ doc: string }>();
  const doc = which === 'terms' ? termsOfUse(operator) : privacyPolicy(operator);
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: doc.title, headerTintColor: colors.text, headerStyle: { backgroundColor: colors.background } }} />
      <T variant="small" style={{ marginBottom: space.md }}>{`Last updated ${date(doc.updated)}`}</T>
      {doc.draft && <Notice tone="amber" icon="document-text-outline">Draft: the operator’s details have not been configured yet, and this document should be reviewed by a Kenyan advocate before ChamaHub goes live.</Notice>}
      <T variant="body" style={{ marginBottom: space.lg }}>{doc.intro}</T>
      {doc.sections.map((s) => (
        <View key={s.heading} style={{ marginBottom: space.lg }}>
          <T variant="heading" style={{ marginBottom: space.xs }} accessibilityRole="header">{s.heading}</T>
          {s.paragraphs?.map((p) => <T key={p} variant="body" style={{ marginBottom: space.sm }}>{p}</T>)}
          {s.bullets?.map((b) => (
            <View key={b} style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.xs }}>
              <T variant="body">•</T>
              <T variant="body" style={{ flex: 1 }}>{b}</T>
            </View>
          ))}
        </View>
      ))}
    </Screen>
  );
}
