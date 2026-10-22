import '@fontsource-variable/inter';
import './satoshi.css';
import './globals.css';
import type { Metadata } from 'next';
import { Providers } from '@/lib/providers';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'ChamaHub', template: '%s · ChamaHub' },
  description: 'Every Chama. Every Contribution. Every Payout. One Place. Contributions, reconciliation, payouts and loans for Kenyan Chamas, on the web and on your phone.',
  applicationName: 'ChamaHub',
  // Signed-in pages are private; the sign-in, sign-up and legal pages opt back in.
  robots: { index: false, follow: false },
  openGraph: { type: 'website', siteName: 'ChamaHub', title: 'ChamaHub', description: 'Every Chama. Every Contribution. Every Payout. One Place.', locale: 'en_KE' },
  twitter: { card: 'summary_large_image', title: 'ChamaHub', description: 'Every Chama. Every Contribution. Every Payout. One Place.' },
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
