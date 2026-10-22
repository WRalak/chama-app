import type { MetadataRoute } from 'next';

/** ChamaHub is a signed-in app: only the public legal pages may be indexed. */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: ['/login', '/sign-up', '/privacy', '/terms'], disallow: ['/'] }], sitemap: `${SITE}/sitemap.xml` };
}
