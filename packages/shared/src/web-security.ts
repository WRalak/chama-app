/**
 * Browser-facing checks shared by the web app (and tested here, where the unit tests run).
 */

const PROBE_ORIGIN = 'https://chamahub.invalid';

/**
 * A redirect target after sign-in, kept on this site. Rejects absolute URLs, protocol-relative
 * `//host`, the backslash forms browsers treat as `//host` (`/\host`), control characters and
 * anything outside `prefix`. Returns `fallback` when the value is not safe.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string, prefix = '/'): string {
  if (!next || next.length > 512 || !next.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN || !url.pathname.startsWith(prefix)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated routes: a state-changing request must come from this
 * site's own pages. Browsers send `Origin` (and `Sec-Fetch-Site`) on cross-site POSTs, so a
 * mismatch is refused; requests from non-browser clients send neither and carry no cookies.
 */
export function isAllowedCookieRequest(r: { method: string; origin: string | null; secFetchSite: string | null; host: string | null; allowedOrigins?: string[] }): boolean {
  if (SAFE_METHODS.has(r.method.toUpperCase())) return true;
  if (r.secFetchSite && r.secFetchSite !== 'same-origin' && r.secFetchSite !== 'none') return false;
  if (!r.origin) return true;
  if (r.origin === 'null') return false;
  let host: string;
  try {
    host = new URL(r.origin).host;
  } catch {
    return false;
  }
  return (!!r.host && host === r.host) || (r.allowedOrigins ?? []).includes(r.origin);
}
