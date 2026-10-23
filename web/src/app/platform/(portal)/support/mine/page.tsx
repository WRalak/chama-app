'use client';

import { CaseList } from '@/components/platform/case-list';
import { PageHeader } from '@/components/ui/layout-parts';

export default function MyCasesPage() {
  return (
    <>
      <PageHeader title="My Assigned Cases" description="Reply, add internal notes, ask for details, escalate, and resolve with a summary." />
      <CaseList scope="mine" />
    </>
  );
}
