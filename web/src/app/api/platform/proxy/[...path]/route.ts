import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { API_URL, sameOrigin } from '@/lib/server/session';
import { clearStaffCookies, setStaffCookies, STAFF_ACCESS_COOKIE, STAFF_REFRESH_COOKIE, type StaffTokens } from '@/lib/server/platform-session';

const PASS_HEADERS = ['content-type', 'content-disposition', 'x-request-id', 'cache-control', 'x-content-type-options'];

async function forward(req: NextRequest, path: string, token: string | undefined, body: ArrayBuffer | undefined) {
  const headers: Record<string, string> = { 'User-Agent': req.headers.get('user-agent') ?? 'ChamaHub Staff Portal' };
  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;
  if (token) headers.Authorization = `Bearer ${token}`;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers['X-Forwarded-For'] = fwd;
  return fetch(`${API_URL}/v1/${path}${req.nextUrl.search}`, { method: req.method, headers, body: body && body.byteLength ? body : undefined, cache: 'no-store' });
}

async function refresh(refreshToken: string): Promise<StaffTokens | null> {
  const res = await fetch(`${API_URL}/v1/platform/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store' });
  return res.ok ? ((await res.json()) as StaffTokens) : null;
}

/** Forwards portal calls to the API's staff routes only; the staff tokens never reach browser JavaScript. */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: 'Cross-site request blocked' }, { status: 403 });
  const { path } = await ctx.params;
  // This proxy only reaches /v1/platform/*: a staff token is never sent anywhere else.
  if (path[0] !== 'platform' || path.includes('..')) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const target = path.map(encodeURIComponent).join('/');
  const jar = await cookies();
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  let token = jar.get(STAFF_ACCESS_COOKIE)?.value;
  const rt = jar.get(STAFF_REFRESH_COOKIE)?.value;
  let rotated: StaffTokens | null = null;
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
  out.headers.set('Cache-Control', 'no-store');
  if (rotated) setStaffCookies(out, rotated);
  else if (res.status === 401) clearStaffCookies(out);
  return out;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
