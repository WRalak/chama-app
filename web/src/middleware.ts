import { NextRequest, NextResponse } from 'next/server';
import { isAllowedCookieRequest } from '@chamahub/shared';

const PUBLIC = ['/login', '/forgot-password', '/sign-up', '/privacy', '/terms'];
/** Staff portal pages anyone may open (sign-in, invitation, password reset). */
const STAFF_PUBLIC = ['/platform/login', '/platform/accept-invite', '/platform/forgot-password', '/platform/reset-password'];
/** Files crawlers and link previews fetch without signing in. */
const PUBLIC_FILES = /^\/(robots\.txt|sitemap\.xml|icon\.png|apple-icon\.png|opengraph-image\.png)$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // CSRF: the /api routes act with the session cookies, so writes must come from this site's pages.
  if (pathname.startsWith('/api/')) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!isAllowedCookieRequest({ method: req.method, origin: req.headers.get('origin'), secFetchSite: req.headers.get('sec-fetch-site'), host })) {
      return NextResponse.json({ statusCode: 403, error: 'Forbidden', message: 'This request did not come from ChamaHub.' }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (pathname.startsWith('/_next') || pathname === '/favicon.ico' || PUBLIC_FILES.test(pathname)) return NextResponse.next();
  // The staff portal is a separate area with its own sign-in; a member session never opens it.
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    if (STAFF_PUBLIC.includes(pathname) || req.cookies.has('chp_session')) return noIndex(NextResponse.next());
    const url = req.nextUrl.clone();
    url.pathname = '/platform/login';
    url.search = '';
    if (pathname !== '/platform') url.searchParams.set('next', pathname);
    return noIndex(NextResponse.redirect(url));
  }
  const signedIn = req.cookies.has('ch_session');
  if (!signedIn && !PUBLIC.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

/** Keep the staff portal out of search engines. */
function noIndex(res: NextResponse) {
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
