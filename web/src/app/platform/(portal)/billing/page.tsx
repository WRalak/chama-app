'use client';

import { BillingConsole } from '@/components/platform/billing-console';

export default function PlatformBillingPage() {
  return <BillingConsole initial="payments" title="Billing" description="ChamaHub subscription payments, refunds, billing cases and provider events. Group contributions, loans and ledgers are never shown here." />;
}
