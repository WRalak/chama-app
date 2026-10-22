import '@fontsource-variable/inter';
import './satoshi.css';
import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/lib/providers';

export const metadata: Metadata = {
  title: { default: 'ChamaHub Admin', template: '%s · ChamaHub Admin' },
  description: 'Every Chama. Every Contribution. Every Payout. One Place.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
