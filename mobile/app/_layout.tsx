import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';
import { MaintenanceBanner, OfflineBanner } from '@/components/offline-banner';
import { routeForNotification } from '@/lib/links';
import { listenForNotificationTaps } from '@/lib/push';
import { colors } from '@/theme';
import { fontAssets, SATOSHI_AVAILABLE } from '@/theme/fonts.generated';

/** Keeps the navigation tree in step with the auth state. */
function Gate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (status === 'loading') return;
    const inAuth = segments[0] === '(auth)';
    if (status === 'signedOut' && !inAuth) router.replace('/(auth)/welcome'); // welcome forwards to sign-in after the first time
    else if (status === 'unverified' && (segments as string[])[1] !== 'verify') router.replace('/(auth)/verify');
    else if (status === 'signedIn' && inAuth) router.replace('/(app)/(tabs)');
  }, [status, segments, router]);
  // Tapping a push notification opens the screen it is about (also on a cold start).
  useEffect(() => {
    if (status !== 'signedIn') return;
    return listenForNotificationTaps((data) => router.push(routeForNotification({ type: data.type as string, groupId: (data.groupId as string) ?? null, data }) as never));
  }, [status, router]);
  if (status === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <Loading />
      </View>
    );
  }
  return (
    <>
      <OfflineBanner />
      <MaintenanceBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}

export default function RootLayout() {
  // Satoshi loads from the app bundle (no network). If it fails, text falls back to the system font.
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  if (SATOSHI_AVAILABLE && !fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
