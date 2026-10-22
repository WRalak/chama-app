import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

type NotificationsModule = typeof import('expo-notifications');

let registeredToken: string | null = null;
let cached: NotificationsModule | null | undefined;

/**
 * expo-notifications needs native modules that Expo Go (SDK 53+) and the
 * browser do not have, so importing it there crashes the whole app. It is
 * loaded lazily, and only in a development or store build.
 */
function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    mod.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Registers this phone for push notifications for the signed-in user.
 * Needs a development or store build with an EAS project id; Expo Go and the
 * browser preview skip it quietly, and in-app notifications keep working.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    const N = notifications();
    if (!N) return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', { name: 'ChamaHub', importance: N.AndroidImportance.HIGH, lightColor: '#14532D' });
    }
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const token = (await N.getExpoPushTokenAsync({ projectId })).data;
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
 * one that launched the app. No-op where push is unavailable.
 */
export function listenForNotificationTaps(onTap: (data: Record<string, unknown>) => void): () => void {
  const N = notifications();
  if (!N) return () => undefined;
  const handle = (r: { notification: { request: { content: { data?: unknown } } } } | null) => {
    if (r) onTap((r.notification.request.content.data ?? {}) as Record<string, unknown>);
  };
  N.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  const sub = N.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
