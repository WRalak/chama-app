import { redirect } from 'next/navigation';

/** Moved: plans and prices are under Plans & pricing; subscriptions under Billing. */
export default function SubscriptionsMoved() {
  redirect('/platform/plans');
}
