import { GroupDetail, Permission } from '@chamahub/shared';
import type { IconName } from '@/components/ui';

export interface SectionDef {
  key: string;
  title: string;
  subtitle: string;
  icon: IconName;
  /** Route under /group/[groupId]/ */
  path: string;
  visible: (can: (p: Permission) => boolean, g: GroupDetail) => boolean;
}

const P = Permission;

/** The group management areas, shown only to members whose permissions in this group allow them. */
export const SECTIONS: SectionDef[] = [
  { key: 'assistant', title: 'Assistant', subtitle: 'Ask about your records; quick answers', icon: 'sparkles-outline', path: 'assistant', visible: (can) => can(P.GROUP_VIEW) },
  { key: 'members', title: 'Members', subtitle: 'Directory, invitations, roles', icon: 'people-outline', path: 'manage/members', visible: (can) => can(P.MEMBERS_VIEW) },
  { key: 'contributions', title: 'Contributions', subtitle: 'Verify, search, reconcile, record', icon: 'wallet-outline', path: 'manage/contributions', visible: (can) => can(P.CONTRIBUTIONS_VIEW_ALL) || can(P.CONTRIBUTIONS_VERIFY) || can(P.RECONCILIATION_MANAGE) },
  { key: 'destinations', title: 'Payment destinations', subtitle: 'Paybill, Till, bank, M-Pesa — with approvals', icon: 'wallet-outline', path: 'manage/destinations', visible: (can) => can(P.DESTINATIONS_MANAGE) || can(P.PAYOUTS_APPROVE) || can(P.AUDIT_VIEW) },
  { key: 'statements', title: 'Statement import', subtitle: 'Upload statements, review matches', icon: 'document-attach-outline', path: 'manage/statements', visible: (can) => can(P.RECONCILIATION_MANAGE) || can(P.AUDIT_VIEW) },
  { key: 'rotation', title: 'Payout rotation', subtitle: 'Order, dates and status', icon: 'sync-outline', path: 'rotation', visible: (can) => can(P.ROTATIONS_VIEW) },
  { key: 'payouts', title: 'Payout approvals', subtitle: 'Prepare, approve, send, confirm', icon: 'shield-checkmark-outline', path: 'manage/payouts', visible: (can) => can(P.ROTATIONS_MANAGE) || can(P.PAYOUTS_APPROVE) },
  { key: 'loans', title: 'Loans', subtitle: 'Applications, approvals, disbursements', icon: 'cash-outline', path: 'manage/loans', visible: (can, g) => g.loanPolicy.enabled && (can(P.LOANS_VIEW_ALL) || can(P.LOANS_APPROVE) || can(P.LOANS_DISBURSE) || can(P.LOANS_PREPARE)) },
  { key: 'expenses', title: 'Expenses', subtitle: 'Record, approve and pay', icon: 'receipt-outline', path: 'manage/expenses', visible: (can) => can(P.EXPENSES_VIEW) },
  { key: 'meetings', title: 'Meetings', subtitle: 'Agenda, attendance, minutes, announcements', icon: 'calendar-outline', path: 'meetings', visible: (can) => can(P.MEETINGS_VIEW) },
  { key: 'announcements', title: 'Announcements', subtitle: 'News from your officers', icon: 'megaphone-outline', path: 'manage/announcements', visible: (can) => can(P.GROUP_VIEW) },
  { key: 'reports', title: 'Reports & statements', subtitle: 'Statements, exports', icon: 'bar-chart-outline', path: 'manage/reports', visible: (can) => can(P.REPORTS_VIEW) || can(P.STATEMENTS_VIEW) },
  { key: 'billing', title: 'Plan & billing', subtitle: 'ChamaHub plan, payments and receipts', icon: 'card-outline', path: 'manage/billing', visible: (can) => can(P.GROUP_VIEW) },
  { key: 'settings', title: 'Group settings', subtitle: 'Rules and approvals', icon: 'settings-outline', path: 'manage/settings', visible: (can) => can(P.GROUP_VIEW) },
  { key: 'handovers', title: 'Officer handovers', subtitle: 'What each officer handed over, from the ledger', icon: 'swap-horizontal-outline', path: 'manage/handovers', visible: (can, g) => can(P.GROUP_CONFIGURE) || can(P.AUDIT_VIEW) || g.myMembership.role !== 'MEMBER' },
  { key: 'audit', title: 'Activity & audit', subtitle: 'Who did what, and when', icon: 'time-outline', path: 'manage/audit', visible: (can) => can(P.GROUP_VIEW) },
];
