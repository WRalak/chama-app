import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/forgot-password'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
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
