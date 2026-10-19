import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, clearSessionCookies, sameOrigin } from '@/lib/server/session';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
