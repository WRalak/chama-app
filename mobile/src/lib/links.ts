import type { NotificationType } from '@chamahub/shared';

/**
 * Where a notification should take the member. Used for push taps, the
 * in-app notification list and chamahub:// links. Screens re-check
 * permissions with the API, so a link never grants access by itself.
 */
export function routeForNotification(n: { type?: NotificationType | string; groupId?: string | null; data?: Record<string, unknown> | null }): string {
  const d = n.data ?? {};
  const g = (n.groupId ?? (d.groupId as string | undefined)) || null;
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  if (n.type === 'INVITATION') return '/(app)/invitations';
  if (!g) return '/(app)/notifications';
  const base = `/(app)/group/${g}`;
  if (s('loanId')) return `${base}/loans/${s('loanId')}`;
  if (s('proposalId')) return `${base}/votes`;
  if (s('meetingId')) return `${base}/meetings/${s('meetingId')}`;
  if (s('disputeId')) return `${base}/manage/contributions`;
  if (s('destinationId')) return n.type === 'APPROVAL_REQUIRED' ? `${base}/manage/destinations` : `${base}/how-to-pay`;
  if (s('paymentId')) return n.type === 'APPROVAL_REQUIRED' ? `${base}/manage/contributions` : `${base}/payments/${s('paymentId')}`;
  if (s('changeId') || (s('cycleId') && (n.type === 'APPROVAL_REQUIRED' || n.type === 'PAYOUT_APPROVED'))) return `${base}/manage/payouts`;
  if (s('cycleId')) return `${base}/rotation`;
  switch (n.type) {
    case 'APPROVAL_REQUIRED':
      return `${base}/manage`;
    case 'CONTRIBUTION_DUE':
    case 'CONTRIBUTION_OVERDUE':
    case 'PAYMENT_CONFIRMED':
      return `${base}/contributions`;
    case 'LOAN_APPROVED':
    case 'LOAN_REJECTED':
    case 'REPAYMENT_DUE':
      return `${base}/loans`;
    case 'MEETING_SCHEDULED':
    case 'MEETING_REMINDER':
      return `${base}/meetings`;
    case 'STATEMENT_PUBLISHED':
      return `${base}/statements`;
    case 'PAYOUT_UPCOMING':
    case 'PAYOUT_COMPLETED':
    case 'PAYOUT_SENT':
    case 'PAYOUT_FAILED':
    case 'ROTATION_UPDATED':
      return `${base}/rotation`;
    case 'DESTINATION_CHANGED':
      return `${base}/how-to-pay`;
    case 'BILLING':
      return `${base}/manage/billing`;
    case 'ANNOUNCEMENT':
      return `${base}/manage/announcements`;
    default:
      return base;
  }
}
