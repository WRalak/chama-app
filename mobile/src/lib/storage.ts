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

/* ---------- small device preferences (not secrets) ---------- */

const ONBOARDED = 'chamahub.onboarded';

/** Whether this device has seen the welcome screens. */
export async function readOnboarded(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(ONBOARDED) === '1';
    return (await SecureStore.getItemAsync(ONBOARDED)) === '1';
  } catch {
    return false;
  }
}

export async function markOnboarded() {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(ONBOARDED, '1');
    else await SecureStore.setItemAsync(ONBOARDED, '1');
  } catch {
    // Not fatal: the welcome screens simply show again next time.
  }
}
