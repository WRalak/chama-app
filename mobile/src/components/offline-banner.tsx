import { useQuery } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { api } from '@/lib/api';
import { View } from 'react-native';
import { T } from './ui';
import { colors } from '@/theme';

/** Tells members when figures may be out of date rather than failing silently. */
export function OfflineBanner() {
  const net = useNetworkState();
  if (net.isConnected !== false) return null;
  return (
    <View style={{ backgroundColor: colors.text, paddingVertical: 6, paddingHorizontal: 16 }} accessibilityRole="alert">
      <T variant="small" style={{ color: colors.white, textAlign: 'center' }}>
        You are offline. Showing figures loaded earlier. Nothing can be recorded or approved until you reconnect.
      </T>
    </View>
  );
}

/** Platform-wide notice set by ChamaHub administrators (e.g. M-Pesa delays). */
export function MaintenanceBanner() {
  const { data } = useQuery({ queryKey: ['platform-notice'], queryFn: () => api<{ maintenanceNotice: string | null }>('platform-notice', { auth: false }), staleTime: 5 * 60_000 });
  if (!data?.maintenanceNotice) return null;
  return (
    <View style={{ backgroundColor: colors.pendingTint, paddingVertical: 8, paddingHorizontal: 16 }} accessibilityRole="alert">
      <T variant="small" style={{ color: colors.pendingText, textAlign: 'center' }}>{data.maintenanceNotice}</T>
    </View>
  );
}
