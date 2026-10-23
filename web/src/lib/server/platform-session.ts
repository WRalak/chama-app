import 'server-only';
import type { NextResponse } from 'next/server';

/**
 * Staff portal cookies. They are separate from the member cookies, httpOnly, and scoped to
 * /api/platform so the browser only ever sends them to the portal's own BFF routes.
 */
export const STAFF_ACCESS_COOKIE = 'chp_at';
export const STAFF_REFRESH_COOKIE = 'chp_rt';
/** Non-sensitive marker so middleware can send signed-out staff to /platform/login. */
export const STAFF_MARKER_COOKIE = 'chp_session';
const SESSION_MAX_SECONDS = 12 * 3600;

const secure = process.env.NODE_ENV === 'production';

export interface StaffTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function setStaffCookies(res: NextResponse, tokens: StaffTokens) {
  res.cookies.set(STAFF_ACCESS_COOKIE, tokens.accessToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api/platform', maxAge: tokens.expiresIn });
  res.cookies.set(STAFF_REFRESH_COOKIE, tokens.refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api/platform', maxAge: SESSION_MAX_SECONDS });
  res.cookies.set(STAFF_MARKER_COOKIE, '1', { httpOnly: true, secure, sameSite: 'strict', path: '/platform', maxAge: SESSION_MAX_SECONDS });
}

export function clearStaffCookies(res: NextResponse) {
  for (const [name, path] of [[STAFF_ACCESS_COOKIE, '/api/platform'], [STAFF_REFRESH_COOKIE, '/api/platform'], [STAFF_MARKER_COOKIE, '/platform']] as const) {
    res.cookies.set(name, '', { httpOnly: true, secure, path, maxAge: 0 });
  }
}
