import type { Metadata } from 'next';

export const metadata: Metadata = { title: { default: 'Staff portal', template: '%s · ChamaHub staff' }, robots: { index: false, follow: false } };

export default function PlatformRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
