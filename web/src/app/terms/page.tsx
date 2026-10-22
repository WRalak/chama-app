import type { Metadata } from 'next';
import { termsOfUse } from '@chamahub/shared';
import { LegalPage } from '@/components/legal/legal-page';
import { legalOperator } from '@/lib/legal';

export const metadata: Metadata = { robots: { index: true, follow: true }, title: 'Terms of Use', description: 'The terms for using ChamaHub, the record-keeping tool for Chamas.' };

export default function TermsPage() {
  return <LegalPage doc={termsOfUse(legalOperator)} />;
}
