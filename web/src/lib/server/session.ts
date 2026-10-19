import 'server-only';
import type { NextResponse } from 'next/server';
import type { AuthTokens } from '@chamahub/shared';

export const ACCESS_COOKIE = 'ch_at';
export const REFRESH_COOKIE = 'ch_rt';
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const secure = process.env.NODE_ENV === 'production';

/** Tokens never reach client JavaScript: both are httpOnly cookies. */
export function setSessionCookies(res: NextResponse, tokens: AuthTokens) {
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: tokens.expiresIn });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api', maxAge: 30 * 86_400 });
  // Non-sensitive marker so middleware can route signed-out users to /login.
  res.cookies.set('ch_session', '1', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 30 * 86_400 });
}

export function clearSessionCookies(res: NextResponse) {
  for (const [name, path] of [[ACCESS_COOKIE, '/'], [REFRESH_COOKIE, '/api'], ['ch_session', '/']] as const) {
    res.cookies.set(name, '', { httpOnly: true, secure, path, maxAge: 0 });
  }
}

/** Rejects cross-site state-changing requests (cookies alone are not proof of intent). */
export function sameOrigin(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
