import { NextResponse } from 'next/server';
import type { AuthResponse } from '@chamahub/shared';
import { API_URL, sameOrigin, setSessionCookies } from '@/lib/server/session';

/** Creates an account and signs it in. The phone still has to be verified (see /verify) before the API serves anything else. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': req.headers.get('user-agent') ?? 'ChamaHub Admin', 'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ message: 'Sign-up failed' }));
  if (!res.ok) return NextResponse.json(json, { status: res.status });
  const data = json as AuthResponse;
  const out = NextResponse.json({ user: data.user });
  setSessionCookies(out, data.tokens);
  return out;
}
