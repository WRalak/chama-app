import type { MetadataRoute } from 'next';
import { LEGAL_UPDATED } from '@chamahub/shared';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/login`, changeFrequency: 'yearly', priority: 1 },
    { url: `${SITE}/sign-up`, changeFrequency: 'yearly', priority: 0.8 },
    { url: `${SITE}/privacy`, lastModified: LEGAL_UPDATED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, lastModified: LEGAL_UPDATED, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
