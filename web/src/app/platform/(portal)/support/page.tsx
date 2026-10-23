'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CaseList } from '@/components/platform/case-list';
import { PageHeader } from '@/components/ui/layout-parts';

function Inbox() {
  const sp = useSearchParams();
  return <CaseList scope="all" initial={{ status: sp.get('status') ?? undefined, scope: sp.get('scope') ?? undefined }} />;
}

export default function SupportInboxPage() {
  return (
    <>
      <PageHeader title="Support Inbox" description="Every case from members. Assign each to a helper; escalated and urgent cases come first." />
      <Suspense>
        <Inbox />
      </Suspense>
    </>
  );
}
