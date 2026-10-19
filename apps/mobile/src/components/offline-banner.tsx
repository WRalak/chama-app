import { useNetworkState } from 'expo-network';
import { View } from 'react-native';
import { T } from './ui';
import { colors } from '@/theme';

/** Tells members when figures may be out of date rather than failing silently. */
export function OfflineBanner() {
  const net = useNetworkState();
  if (net.isConnected !== false) return null;
  return (
    <View style={{ backgroundColor: colors.navy, paddingVertical: 6, paddingHorizontal: 16 }} accessibilityRole="alert">
      <T variant="small" style={{ color: colors.white, textAlign: 'center' }}>
        You are offline. Showing the last figures loaded.
      </T>
    </View>
  );
}
