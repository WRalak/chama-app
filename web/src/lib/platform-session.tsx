'use client';

import { useQuery } from '@tanstack/react-query';
import type { PlatformMe, PlatformPermission } from '@chamahub/shared';
import { api } from './api';

/** The signed-in staff member, from the portal API. Permissions are the database's, re-checked by the API on every call. */
export function usePlatformMe() {
  return useQuery({ queryKey: ['platform-me'], queryFn: () => api<PlatformMe>('platform/auth/me'), staleTime: 60_000, retry: false });
}

/** Hides what the caller cannot do. The API enforces the same rule; this is presentation only. */
export function usePlatformCan() {
  const { data } = usePlatformMe();
  return (p: PlatformPermission) => !!data?.permissions.includes(p);
}

export async function staffSignOut() {
  await fetch('/api/platform/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  window.location.href = '/platform/login';
}
