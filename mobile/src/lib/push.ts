import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let registeredToken: string | null = null;

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/**
 * Registers this phone for push notifications for the signed-in user.
 * Push needs a development or store build with an EAS project id; Expo Go
 * (Android) and the browser preview skip it quietly, and in-app
 * notifications keep working either way.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'ChamaHub', importance: Notifications.AndroidImportance.HIGH, lightColor: '#14532D' });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('notifications/devices', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

/** Stops this phone receiving the signed-out user's notifications. */
export async function unregisterPush() {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  await api('notifications/devices/remove', { body: { token } }).catch(() => undefined);
}

/**
 * Calls `onTap` with the data of a tapped push notification, including the
 * one that launched the app. No-op where push is unavailable (the web preview).
 */
export function listenForNotificationTaps(onTap: (data: Record<string, unknown>) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (r) onTap((r.notification.request.content.data ?? {}) as Record<string, unknown>);
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
