import { useQuery } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { T } from './ui';
import { colors } from '@/theme';

/**
 * Notices shown above every screen: offline (figures may be out of date) and
 * platform maintenance. Android draws the app edge to edge, so the first
 * banner starts below the phone's status bar and sets the status-bar icons to
 * contrast with it; with no banner, the screens handle the top inset.
 */
export function TopBanners() {
  const net = useNetworkState();
  const insets = useSafeAreaInsets();
  const { data } = useQuery({ queryKey: ['platform-notice'], queryFn: () => api<{ maintenanceNotice: string | null }>('platform-notice', { auth: false }), staleTime: 5 * 60_000 });
  const offline = net.isConnected === false;
  const notice = data?.maintenanceNotice;
  if (!offline && !notice) return null;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: offline ? colors.text : colors.pendingTint }}>
      <StatusBar style={offline ? 'light' : 'dark'} />
      {offline && (
        <View style={{ backgroundColor: colors.text, paddingVertical: 6, paddingHorizontal: 16 }} accessibilityRole="alert">
          <T variant="small" style={{ color: colors.white, textAlign: 'center' }}>
            You are offline. Showing figures loaded earlier. Nothing can be recorded or approved until you reconnect.
          </T>
        </View>
      )}
      {notice && (
        <View style={{ backgroundColor: colors.pendingTint, paddingVertical: 8, paddingHorizontal: 16 }} accessibilityRole="alert">
          <T variant="small" style={{ color: colors.pendingText, textAlign: 'center' }}>{notice}</T>
        </View>
      )}
    </View>
  );
}
