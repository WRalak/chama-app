import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in', robots: { index: true, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
