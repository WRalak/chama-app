import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthTokens } from '@chamahub/shared';
import { ACCESS_COOKIE, API_URL, clearSessionCookies, REFRESH_COOKIE, sameOrigin, setSessionCookies } from '@/lib/server/session';

const PASS_HEADERS = ['content-type', 'content-disposition', 'x-request-id', 'cache-control'];

async function forward(req: NextRequest, path: string, token: string | undefined, body: ArrayBuffer | undefined) {
  const url = `${API_URL}/v1/${path}${req.nextUrl.search}`;
  const headers: Record<string, string> = { 'User-Agent': req.headers.get('user-agent') ?? 'ChamaHub Admin' };
  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  if (token) headers.Authorization = `Bearer ${token}`;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers['X-Forwarded-For'] = fwd;
  return fetch(url, { method: req.method, headers, body: body && body.byteLength ? body : undefined, cache: 'no-store' });
}

async function refresh(refreshToken: string): Promise<AuthTokens | null> {
  const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store' });
  return res.ok ? ((await res.json()) as AuthTokens) : null;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
  const { path } = await ctx.params;
  const target = path.map(encodeURIComponent).join('/');
  const jar = await cookies();
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  let token = jar.get(ACCESS_COOKIE)?.value;
  let rotated: AuthTokens | null = null;
  const rt = jar.get(REFRESH_COOKIE)?.value;
  if (!token && rt) {
    rotated = await refresh(rt);
    token = rotated?.accessToken;
  }
  let res = await forward(req, target, token, body);
  if (res.status === 401 && rt && !rotated) {
    rotated = await refresh(rt);
    if (rotated) res = await forward(req, target, rotated.accessToken, body);
  }
  const out = new NextResponse(res.body, { status: res.status });
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) out.headers.set(h, v);
  }
  if (rotated) setSessionCookies(out, rotated);
  else if (res.status === 401 && rt) clearSessionCookies(out);
  return out;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
