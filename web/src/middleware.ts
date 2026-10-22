import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/forgot-password', '/sign-up', '/privacy', '/terms'];
/** Files crawlers and link previews fetch without signing in. */
const PUBLIC_FILES = /^\/(robots\.txt|sitemap\.xml|icon\.png|apple-icon\.png|opengraph-image\.png)$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.ico' || PUBLIC_FILES.test(pathname)) return NextResponse.next();
  const signedIn = req.cookies.has('ch_session');
  if (!signedIn && !PUBLIC.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
