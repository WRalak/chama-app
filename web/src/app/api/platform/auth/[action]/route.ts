import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_URL, sameOrigin } from '@/lib/server/session';
import { clearStaffCookies, setStaffCookies, STAFF_ACCESS_COOKIE, type StaffTokens } from '@/lib/server/platform-session';

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false; me: unknown; tokens: StaffTokens };

const upstream = (req: Request, path: string, body: unknown) =>
  fetch(`${API_URL}/v1/platform/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': req.headers.get('user-agent') ?? 'ChamaHub Staff Portal', 'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

/** Staff sign-in and sign-out. Tokens are set as httpOnly cookies and never returned to the page. */
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const { action } = await ctx.params;

  if (action === 'logout') {
    const token = (await cookies()).get(STAFF_ACCESS_COOKIE)?.value;
    if (token) await fetch(`${API_URL}/v1/platform/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    const res = NextResponse.json({ ok: true });
    clearStaffCookies(res);
    return res;
  }
  if (action !== 'login' && action !== 'login-mfa') return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const res = await upstream(req, action === 'login' ? 'login' : 'login/mfa', body);
  const json = (await res.json().catch(() => ({ message: 'Sign-in failed' }))) as LoginResult & { message?: string };
  if (!res.ok) return NextResponse.json({ message: json.message ?? 'Sign-in failed' }, { status: res.status });
  if (json.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: json.mfaToken });
  const out = NextResponse.json({ mfaRequired: false, me: json.me });
  setStaffCookies(out, json.tokens);
  return out;
}
