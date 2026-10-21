import type { ApiErrorBody, AuthTokens } from '@chamahub/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readSession, StoredSession, writeSession } from './storage';

/**
 * Where the ChamaHub API is. EXPO_PUBLIC_API_URL wins when set. Otherwise, in
 * development the API is assumed to run on the same computer as the Expo dev
 * server (port 4000): the browser preview uses the page's host, and a phone on
 * the same Wi-Fi uses the dev server's LAN address, so no IP needs typing.
 */
function resolveApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  // 10.0.2.2 only works inside the Android emulator; older .env files set it by default.
  if (configured && !configured.includes('10.0.2.2')) return configured;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return configured || 'http://10.0.2.2:4000';
}

export const API_URL = resolveApiUrl().replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let session: StoredSession | null = null;
let loaded = false;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

export async function loadSession() {
  if (!loaded) {
    session = await readSession();
    loaded = true;
  }
  return session;
}

export async function saveTokens(tokens: AuthTokens | null) {
  session = tokens ? { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: Date.now() + tokens.expiresIn * 1000 } : null;
  loaded = true;
  await writeSession(session);
}

/** Refreshes once even if many requests hit 401 together. */
async function refresh(): Promise<boolean> {
  if (!session?.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session!.refreshToken }) });
      if (!res.ok) return false;
      await saveTokens((await res.json()) as AuthTokens);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;
export function qs(q?: Query) {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Query; auth?: boolean } = {}): Promise<T> {
  await loadSession();
  const auth = opts.auth !== false;
  if (auth && session && session.expiresAt < Date.now() + 15_000) await refresh();
  const send = () =>
    fetch(`${API_URL}/v1/${path.replace(/^\//, '')}${qs(opts.query)}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth && session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  if (res.status === 401 && auth && session) {
    if (await refresh()) res = await send();
    else {
      await saveTokens(null);
      onSignedOut?.();
    }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Authenticated URL + header for file downloads (PDF statements). */
export async function authHeader() {
  await loadSession();
  if (session && session.expiresAt < Date.now() + 15_000) await refresh();
  return session ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
