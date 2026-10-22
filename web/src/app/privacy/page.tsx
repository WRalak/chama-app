import type { Metadata } from 'next';
import { privacyPolicy } from '@chamahub/shared';
import { LegalPage } from '@/components/legal/legal-page';
import { legalOperator } from '@/lib/legal';

export const metadata: Metadata = { robots: { index: true, follow: true }, title: 'Privacy Policy', description: 'What personal data ChamaHub keeps, why, who can see it and your rights under the Kenya Data Protection Act, 2019.' };

export default function PrivacyPage() {
  return <LegalPage doc={privacyPolicy(legalOperator)} />;
}
