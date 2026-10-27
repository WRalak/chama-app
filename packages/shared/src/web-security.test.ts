import { describe, expect, it } from 'vitest';
import { isAllowedCookieRequest, safeRedirectPath } from './web-security';

describe('safeRedirectPath', () => {
  it('keeps same-site paths', () => {
    expect(safeRedirectPath('/g/abc/payments?tab=2', '/')).toBe('/g/abc/payments?tab=2');
    expect(safeRedirectPath('/platform/users/1', '/platform', '/platform/')).toBe('/platform/users/1');
  });
  it('refuses open redirects', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example', '/\tevil', 'javascript:alert(1)', ' /x', '']) {
      expect(safeRedirectPath(bad, '/home')).toBe('/home');
    }
    expect(safeRedirectPath('/g/abc', '/platform', '/platform/')).toBe('/platform');
    expect(safeRedirectPath(null, '/')).toBe('/');
  });
});

describe('isAllowedCookieRequest (CSRF)', () => {
  const base = { host: 'app.chamahub.ke', secFetchSite: null as string | null, origin: null as string | null };
  it('allows reads, same-origin writes and non-browser clients', () => {
    expect(isAllowedCookieRequest({ ...base, method: 'GET', origin: 'https://evil.example', secFetchSite: 'cross-site' })).toBe(true);
    expect(isAllowedCookieRequest({ ...base, method: 'POST', origin: 'https://app.chamahub.ke', secFetchSite: 'same-origin' })).toBe(true);
    expect(isAllowedCookieRequest({ ...base, method: 'POST' })).toBe(true);
  });
  it('refuses cross-site writes', () => {
    expect(isAllowedCookieRequest({ ...base, method: 'POST', origin: 'https://evil.example' })).toBe(false);
    expect(isAllowedCookieRequest({ ...base, method: 'DELETE', secFetchSite: 'cross-site' })).toBe(false);
    expect(isAllowedCookieRequest({ ...base, method: 'PATCH', secFetchSite: 'same-site', origin: 'https://other.chamahub.ke' })).toBe(false);
    expect(isAllowedCookieRequest({ ...base, method: 'POST', origin: 'null' })).toBe(false);
    expect(isAllowedCookieRequest({ ...base, method: 'POST', origin: 'https://app.chamahub.ke.evil.example' })).toBe(false);
  });
});
