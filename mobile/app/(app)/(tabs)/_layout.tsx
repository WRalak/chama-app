import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { t } from '@chamahub/shared';
import { useAuth } from '@/lib/auth';
import { colors, font } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Selected tabs use Rose for the icon, a filled icon and Berry text, so the state never depends on colour alone. */
const icon = (name: IconName, active: IconName) => ({ focused, size }: { focused: boolean; size: number }) => <Ionicons name={focused ? active : name} color={focused ? colors.rose : colors.muted} size={size} />;

export default function TabsLayout() {
  const locale = useAuth().user?.locale;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.berry,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.white, minHeight: 62, paddingTop: 4 },
        tabBarLabelStyle: { ...font('600'), fontSize: 11 },
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { ...font('700'), fontSize: 17, color: colors.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t(locale, 'tab.home'), headerShown: false, tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="chamas" options={{ title: t(locale, 'tab.chamas'), tabBarIcon: icon('people-outline', 'people') }} />
      <Tabs.Screen name="finances" options={{ title: t(locale, 'tab.finances'), tabBarIcon: icon('wallet-outline', 'wallet') }} />
      <Tabs.Screen name="activity" options={{ title: t(locale, 'tab.activity'), tabBarIcon: icon('pulse-outline', 'pulse') }} />
      <Tabs.Screen name="profile" options={{ title: t(locale, 'tab.profile'), tabBarIcon: icon('person-circle-outline', 'person-circle') }} />
    </Tabs>
  );
}
