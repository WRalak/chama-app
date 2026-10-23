'use client';

import { BillingConsole } from '@/components/platform/billing-console';

export default function PlatformSubscriptionsPage() {
  return <BillingConsole initial="groups" title="Subscriptions" description="Each group's plan, access and renewal status. Open a group for its billing history and promotions." />;
}
