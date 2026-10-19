import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Tokens live in the OS keystore (Android Keystore / iOS Keychain) via
 * expo-secure-store. The web build (development preview only) falls back to
 * sessionStorage, which is cleared when the tab closes.
 */
const KEY = 'chamahub.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export async function writeSession(s: StoredSession | null) {
  if (Platform.OS === 'web') {
    if (s) globalThis.sessionStorage?.setItem(KEY, JSON.stringify(s));
    else globalThis.sessionStorage?.removeItem(KEY);
    return;
  }
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(KEY);
}
