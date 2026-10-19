/**
 * Domain enums shared by the API, admin dashboard and mobile app. The string
 * values match the Prisma enums in apps/api/prisma/schema.prisma exactly.
 */

function values<T extends Record<string, string>>(obj: T) {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]];
}

export const GroupType = {
  MERRY_GO_ROUND: 'MERRY_GO_ROUND',
  TABLE_BANKING: 'TABLE_BANKING',
  INVESTMENT: 'INVESTMENT',
  WELFARE: 'WELFARE',
  SAVINGS: 'SAVINGS',
  HYBRID: 'HYBRID',
} as const;
export type GroupType = (typeof GroupType)[keyof typeof GroupType];
export const GROUP_TYPES = values(GroupType);

export const GroupRole = {
  CHAIRPERSON: 'CHAIRPERSON',
  VICE_CHAIRPERSON: 'VICE_CHAIRPERSON',
  TREASURER: 'TREASURER',
  SECRETARY: 'SECRETARY',
  AUDITOR: 'AUDITOR',
  MEMBER: 'MEMBER',
} as const;
export type GroupRole = (typeof GroupRole)[keyof typeof GroupRole];
export const GROUP_ROLES = values(GroupRole);

export const PlatformRole = {
  USER: 'USER',
  SUPPORT: 'SUPPORT',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];
export const PLATFORM_ROLES = values(PlatformRole);

export const MembershipStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  EXITED: 'EXITED',
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const Frequency = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
} as const;
export type Frequency = (typeof Frequency)[keyof typeof Frequency];
export const FREQUENCIES = values(Frequency);

/** Lifecycle of money movements. A recorded payment is not cash until CONFIRMED. */
export const TransactionStatus = {
  SCHEDULED: 'SCHEDULED',
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
  DISPUTED: 'DISPUTED',
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];
export const TRANSACTION_STATUSES = values(TransactionStatus);

export const PaymentMethod = {
  CASH: 'CASH',
  MPESA: 'MPESA',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];
export const PAYMENT_METHODS = values(PaymentMethod);

export const PaymentPurpose = {
  CONTRIBUTION: 'CONTRIBUTION',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  FINE: 'FINE',
  OTHER: 'OTHER',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];

export const ObligationStatus = {
  UPCOMING: 'UPCOMING',
  DUE: 'DUE',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  WAIVED: 'WAIVED',
} as const;
export type ObligationStatus = (typeof ObligationStatus)[keyof typeof ObligationStatus];

export const InterestMethod = {
  /** Interest = principal × rate × periods; equal installments. */
  FLAT: 'FLAT',
  /** Interest charged once on principal (e.g. "10% once"), spread over installments. */
  ONE_OFF: 'ONE_OFF',
  /** Equal principal each period; interest on outstanding balance (declining installments). */
  REDUCING_BALANCE: 'REDUCING_BALANCE',
  /** Equal total installments (annuity) with interest on outstanding balance. */
  AMORTIZED: 'AMORTIZED',
} as const;
export type InterestMethod = (typeof InterestMethod)[keyof typeof InterestMethod];
export const INTEREST_METHODS = values(InterestMethod);

export const LoanStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DISBURSED: 'DISBURSED',
  REPAID: 'REPAID',
  DEFAULTED: 'DEFAULTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus];
export const LOAN_STATUSES = values(LoanStatus);

export const InstallmentStatus = {
  UPCOMING: 'UPCOMING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
} as const;
export type InstallmentStatus = (typeof InstallmentStatus)[keyof typeof InstallmentStatus];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ExpenseStatus = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
  REVERSED: 'REVERSED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

export const FineStatus = {
  OUTSTANDING: 'OUTSTANDING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
} as const;
export type FineStatus = (typeof FineStatus)[keyof typeof FineStatus];

export const CycleStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type CycleStatus = (typeof CycleStatus)[keyof typeof CycleStatus];

/** Payout stages are distinct: scheduled ≠ approved ≠ completed. */
export const PayoutStatus = {
  SCHEDULED: 'SCHEDULED',
  COLLECTING: 'COLLECTING',
  READY: 'READY',
  APPROVED: 'APPROVED',
  COMPLETED: 'COMPLETED',
  DEFERRED: 'DEFERRED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const DistributionMethod = {
  EQUAL: 'EQUAL',
  CONTRIBUTION_PROPORTIONAL: 'CONTRIBUTION_PROPORTIONAL',
  SHARE_BASED: 'SHARE_BASED',
} as const;
export type DistributionMethod = (typeof DistributionMethod)[keyof typeof DistributionMethod];
export const DISTRIBUTION_METHODS = values(DistributionMethod);

export const DistributionStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
export type DistributionStatus = (typeof DistributionStatus)[keyof typeof DistributionStatus];

export const MeetingStatus = {
  SCHEDULED: 'SCHEDULED',
  HELD: 'HELD',
  CANCELLED: 'CANCELLED',
} as const;
export type MeetingStatus = (typeof MeetingStatus)[keyof typeof MeetingStatus];

export const AttendanceStatus = {
  CONFIRMED: 'CONFIRMED',
  DECLINED: 'DECLINED',
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  APOLOGY: 'APOLOGY',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const MinutesStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
} as const;
export type MinutesStatus = (typeof MinutesStatus)[keyof typeof MinutesStatus];

/**
 * Ledger accounts used for each group's books. Every financial event posts
 * a balanced pair (debit/credit) so the cash position is always derivable.
 */
export const LedgerAccount = {
  CASH: 'CASH',
  MEMBER_CONTRIBUTIONS: 'MEMBER_CONTRIBUTIONS',
  LOANS_RECEIVABLE: 'LOANS_RECEIVABLE',
  INTEREST_INCOME: 'INTEREST_INCOME',
  FINE_INCOME: 'FINE_INCOME',
  EXPENSES: 'EXPENSES',
  PAYOUTS: 'PAYOUTS',
  DISTRIBUTIONS: 'DISTRIBUTIONS',
  OPENING_BALANCE: 'OPENING_BALANCE',
  OTHER_INCOME: 'OTHER_INCOME',
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

export const LedgerEntryType = {
  CONTRIBUTION: 'CONTRIBUTION',
  LOAN_DISBURSEMENT: 'LOAN_DISBURSEMENT',
  LOAN_REPAYMENT_PRINCIPAL: 'LOAN_REPAYMENT_PRINCIPAL',
  LOAN_REPAYMENT_INTEREST: 'LOAN_REPAYMENT_INTEREST',
  FINE_PAYMENT: 'FINE_PAYMENT',
  EXPENSE: 'EXPENSE',
  PAYOUT: 'PAYOUT',
  DISTRIBUTION: 'DISTRIBUTION',
  OPENING_BALANCE: 'OPENING_BALANCE',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
  OTHER_INCOME: 'OTHER_INCOME',
} as const;
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType];

export const NotificationType = {
  CONTRIBUTION_DUE: 'CONTRIBUTION_DUE',
  CONTRIBUTION_OVERDUE: 'CONTRIBUTION_OVERDUE',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_REJECTED: 'LOAN_REJECTED',
  REPAYMENT_DUE: 'REPAYMENT_DUE',
  PAYOUT_UPCOMING: 'PAYOUT_UPCOMING',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  MEETING_REMINDER: 'MEETING_REMINDER',
  STATEMENT_PUBLISHED: 'STATEMENT_PUBLISHED',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  INVITATION: 'INVITATION',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  PUSH: 'PUSH',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const ImportKind = {
  MEMBERS: 'MEMBERS',
  CONTRIBUTIONS: 'CONTRIBUTIONS',
  LOANS: 'LOANS',
  REPAYMENTS: 'REPAYMENTS',
  FINES: 'FINES',
  PAYOUTS: 'PAYOUTS',
  OPENING_BALANCE: 'OPENING_BALANCE',
} as const;
export type ImportKind = (typeof ImportKind)[keyof typeof ImportKind];
export const IMPORT_KINDS = values(ImportKind);

export const ImportStatus = {
  VALIDATED: 'VALIDATED',
  HAS_ERRORS: 'HAS_ERRORS',
  COMMITTED: 'COMMITTED',
  DISCARDED: 'DISCARDED',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const DisputeStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const ReconciliationStatus = {
  UNMATCHED: 'UNMATCHED',
  MATCHED: 'MATCHED',
  DUPLICATE: 'DUPLICATE',
  IGNORED: 'IGNORED',
} as const;
export type ReconciliationStatus = (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

export const LABELS = {
  groupType: {
    MERRY_GO_ROUND: 'Merry-Go-Round',
    TABLE_BANKING: 'Table Banking',
    INVESTMENT: 'Investment',
    WELFARE: 'Welfare',
    SAVINGS: 'Savings',
    HYBRID: 'Hybrid',
  } satisfies Record<GroupType, string>,
  groupRole: {
    CHAIRPERSON: 'Chairperson',
    VICE_CHAIRPERSON: 'Vice Chairperson',
    TREASURER: 'Treasurer',
    SECRETARY: 'Secretary',
    AUDITOR: 'Auditor',
    MEMBER: 'Member',
  } satisfies Record<GroupRole, string>,
  frequency: {
    WEEKLY: 'Weekly',
    BIWEEKLY: 'Every 2 weeks',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
  } satisfies Record<Frequency, string>,
  interestMethod: {
    FLAT: 'Flat rate (per period)',
    ONE_OFF: 'One-off interest',
    REDUCING_BALANCE: 'Reducing balance (equal principal)',
    AMORTIZED: 'Reducing balance (equal installments)',
  } satisfies Record<InterestMethod, string>,
  paymentMethod: {
    CASH: 'Cash',
    MPESA: 'M-Pesa',
    BANK_TRANSFER: 'Bank transfer',
    CHEQUE: 'Cheque',
    OTHER: 'Other',
  } satisfies Record<PaymentMethod, string>,
  distributionMethod: {
    EQUAL: 'Equal shares',
    CONTRIBUTION_PROPORTIONAL: 'Proportional to contributions',
    SHARE_BASED: 'By shareholding',
  } satisfies Record<DistributionMethod, string>,
};
