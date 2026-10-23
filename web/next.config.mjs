import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.env.NODE_ENV === 'production';

// The browser only talks to this site: API calls go through the same-origin proxy, fonts are self-hosted.
// Next.js needs inline scripts and styles for hydration; dev mode also needs eval for fast refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${production ? '' : ' ws: wss:'}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const sharedSrc = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/shared/src/index.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@chamahub/shared'],
  // Compile the shared package from source, so the web app never runs a stale packages/shared/dist
  // (which only the API and its tests need). Fixes "t is not a function" after pulling new code.
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@chamahub/shared$': sharedSrc };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
          // Browsers ignore HSTS over plain http, so this only takes effect once served over HTTPS.
          ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
};
export default nextConfig;
