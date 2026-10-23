import type { ApiErrorBody } from '@chamahub/shared';
import { requestReauth } from './reauth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(query?: Query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Staff portal calls (platform/…) use the portal's own proxy and cookies; member calls use the member proxy. */
const isStaffPath = (path: string) => path.replace(/^\//, '').startsWith('platform/');
const proxyBase = (path: string) => (isStaffPath(path) ? '/api/platform/proxy/' : '/api/proxy/');

/** All browser calls go through a same-origin BFF proxy, which holds the tokens. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}, retried = false): Promise<T> {
  const res = await fetch(`${proxyBase(path)}${path.replace(/^\//, '')}${qs(opts.query)}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('auth/') && !path.startsWith('platform/auth/')) {
    const login = isStaffPath(path) ? '/platform/login' : '/login';
    window.location.href = `${login}?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    // Sensitive staff action after the re-authentication window: confirm identity, then retry once.
    if (res.status === 403 && !retried && isStaffPath(path) && (body?.details as { code?: string } | undefined)?.code === 'REAUTH_REQUIRED' && typeof window !== 'undefined') {
      if (await requestReauth()) return api<T>(path, opts, true);
    }
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.details);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** URL for file downloads (CSV/PDF) served through the proxy. */
export const fileUrl = (path: string, query?: Query) => `${proxyBase(path)}${path.replace(/^\//, '')}${qs(query)}`;

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}
