import { z } from 'zod';
import {
  AttendanceStatus,
  DESTINATION_TYPES,
  DestinationVerification,
  DISTRIBUTION_METHODS,
  FREQUENCIES,
  GROUP_ROLES,
  GROUP_TYPES,
  IMPORT_KINDS,
  INTEREST_METHODS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
} from '../enums';
import { isIsoDate } from '../dates';
import { CURRENCY_CODES } from '../currency';
import { BILLING_INTERVALS, FEATURES } from '../billing';
import { LOCALE_CODES } from '../i18n';
import { ALL_PERMISSIONS, SPECIAL_ROLES } from '../permissions';
import { normalizeKenyanPhone } from '../phone';
import { MAX_LOAN_INSTALLMENTS } from '../finance/loans';
import { MISSED_CONTRIBUTION_POLICIES, ROTATION_APPROVAL_MODES, ROTATION_ORDER_METHODS } from '../finance/rotation';

/* ---------- primitives ---------- */

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeKenyanPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Kenyan mobile number, e.g. 0712 345 678' });
      return z.NEVER;
    }
    return n;
  });

export const isoDateSchema = z.string().refine(isIsoDate, 'Use a valid date (YYYY-MM-DD)');

/** Positive whole number of cents. */
export const amountCentsSchema = z
  .number({ invalid_type_error: 'Amount is required' })
  .int('Amount must be whole cents')
  .positive('Amount must be greater than zero')
  .max(100_000_000_000_00, 'Amount is too large');

export const nonNegativeCentsSchema = z.number().int().min(0).max(100_000_000_000_00);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const reasonSchema = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const dateRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"From" must be before "to"', path: ['to'] });

/* ---------- auth ---------- */

export const registerSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name').max(120),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Enter your password'),
  deviceName: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const otpPurposeSchema = z.enum(['VERIFY_PHONE', 'RESET_PASSWORD', 'LOGIN']);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

export const requestOtpSchema = z.object({ phone: phoneSchema, purpose: otpPurposeSchema });
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  purpose: otpPurposeSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const resetPasswordSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordSchema,
});
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(120).optional(),
  locale: z.enum(LOCALE_CODES).optional(),
  email: z.string().trim().email().nullable().optional(),
  nationalIdLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
});

export const notificationPreferencesSchema = z.object({
  sms: z.boolean(),
  email: z.boolean(),
  whatsapp: z.boolean(),
  push: z.boolean(),
  contributionReminders: z.boolean(),
  loanReminders: z.boolean(),
  meetingReminders: z.boolean(),
  announcements: z.boolean(),
  /** Hide my phone number from ordinary members of my groups. */
  hidePhoneFromMembers: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const pushDeviceSchema = z.object({
  token: z.string().trim().regex(/^Expo(nent)?PushToken\[.+\]$/, 'Not an Expo push token').max(200),
  platform: z.enum(['android', 'ios', 'web']),
});

export const accountDeletionSchema = z.object({ reason: z.string().trim().max(500).optional() });

/* ---------- groups ---------- */

export const loanPolicySchema = z.object({
  enabled: z.boolean(),
  interestMethod: z.enum(INTEREST_METHODS),
  rateBps: z.number().int().min(0).max(100000),
  maxInstallments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  repaymentFrequency: z.enum(FREQUENCIES),
  maxMultipleOfSavingsBps: z.number().int().min(0).max(1_000_000),
  maxPrincipalCents: nonNegativeCentsSchema,
  requiredApprovals: z.number().int().min(1).max(5),
  allowSelfApproval: z.boolean(),
  latePenaltyBps: z.number().int().min(0).max(10000),
});
export type LoanPolicyInput = z.infer<typeof loanPolicySchema>;

export const defaultLoanPolicy: LoanPolicyInput = {
  enabled: true,
  interestMethod: 'FLAT',
  rateBps: 1000,
  maxInstallments: 6,
  repaymentFrequency: 'MONTHLY',
  maxMultipleOfSavingsBps: 30000,
  maxPrincipalCents: 0,
  requiredApprovals: 2,
  allowSelfApproval: false,
  latePenaltyBps: 0,
};

export const groupSettingsSchema = z.object({
  /** Approvals needed for expenses, payouts and distributions. */
  requiredFinancialApprovals: z.number().int().min(1).max(5),
  lateContributionFineCents: nonNegativeCentsSchema,
  graceDays: z.number().int().min(0).max(60),
  membersCanViewMemberBalances: z.boolean(),
  paybillNumber: z.string().trim().max(20).nullable(),
  accountReferencePrefix: z.string().trim().max(12).nullable(),
  /** What happens when a round is not fully collected by payout time. */
  missedContributionPolicy: z.enum(MISSED_CONTRIBUTION_POLICIES),
  /** Whether a round may be paid before its scheduled date. */
  allowEarlyPayout: z.boolean(),
  /** Hold a payout while the recipient has overdue contributions, fines or loan installments. */
  holdPayoutWhenRecipientInArrears: z.boolean(),
  /** Expenses, payouts, distributions and loans also need one approval from a Joint Signatory. */
  requireJointSignatory: z.boolean(),
});
export type GroupSettingsInput = z.infer<typeof groupSettingsSchema>;

export const defaultGroupSettings: GroupSettingsInput = {
  requiredFinancialApprovals: 2,
  lateContributionFineCents: 0,
  graceDays: 3,
  membersCanViewMemberBalances: false,
  paybillNumber: null,
  accountReferencePrefix: null,
  missedContributionPolicy: 'PAY_CONFIRMED_WITH_REASON',
  allowEarlyPayout: false,
  holdPayoutWhenRecipientInArrears: false,
  requireJointSignatory: false,
};

/** IANA zone such as "Africa/Nairobi"; checked against the runtime's time-zone database. */
export const timezoneSchema = z.string().trim().min(3).max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');
export const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a two-letter country code');
export const currencyCodeSchema = z.enum(CURRENCY_CODES);
export const localeTagSchema = z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a language tag such as en-KE or sw-TZ');

/** Where the group operates. The currency is fixed once the group has money records. */
export const groupRegionSchema = z.object({
  countryCode: countryCodeSchema,
  currency: currencyCodeSchema,
  timezone: timezoneSchema,
  locale: localeTagSchema,
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'Group name is too short').max(120),
  type: z.enum(GROUP_TYPES),
  countryCode: countryCodeSchema.optional(),
  currency: currencyCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  locale: localeTagSchema.optional(),
  description: z.string().trim().max(1000).optional(),
  county: z.string().trim().max(60).optional(),
  registrationNumber: z.string().trim().max(60).optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).default(1),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.partial().extend({
  settings: groupSettingsSchema.partial().optional(),
  loanPolicy: loanPolicySchema.partial().optional(),
});

/* ---------- membership ---------- */

export const createInvitationSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(GROUP_ROLES).default('MEMBER'),
});
export const respondInvitationSchema = z.object({ accept: z.boolean() });
export const acceptInviteCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });

export const changeRoleSchema = z.object({ role: z.enum(GROUP_ROLES), reason: reasonSchema });
export const changeMemberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'EXITED']),
  reason: reasonSchema,
});

/* ---------- contributions ---------- */

export const createScheduleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  amountCents: amountCentsSchema,
  frequency: z.enum(FREQUENCIES),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  /** Applies to all active members when omitted. */
  memberIds: z.array(z.string()).optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const recordPaymentSchema = z.object({
  memberId: z.string().min(1),
  amountCents: amountCentsSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  paidAt: isoDateSchema,
  purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']).default('CONTRIBUTION'),
  /** Target obligation / loan / fine. When omitted contributions are applied oldest-first. */
  targetId: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
  /** The group payment destination the money was sent to. */
  destinationId: z.string().optional(),
  /** Client-generated key; the same key never records twice. */
  idempotencyKey: z.string().min(8).max(100),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const verifyPaymentSchema = z.object({
  decision: z.enum(['CONFIRM', 'FAIL']),
  note: z.string().trim().max(500).optional(),
});
export const reversePaymentSchema = z.object({ reason: reasonSchema });

export const mpesaStkSchema = z.object({
  amountCents: amountCentsSchema,
  phone: phoneSchema,
  purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']).default('CONTRIBUTION'),
  targetId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export const paymentFilterSchema = paginationSchema.extend({
  status: z.enum(TRANSACTION_STATUSES).optional(),
  memberId: z.string().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(60).optional(),
  /** Exact amount in cents, for finding a payment by what the member says they paid. */
  amountCents: z.coerce.number().int().positive().optional(),
});

export const matchUnmatchedSchema = z.object({ memberId: z.string(), purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']), targetId: z.string().optional() });

/* ---------- loans ---------- */

export const loanQuoteSchema = z.object({
  principalCents: amountCentsSchema,
  installments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  firstDueDate: isoDateSchema.optional(),
});

export const loanApplicationSchema = z.object({
  principalCents: amountCentsSchema,
  installments: z.number().int().min(1).max(MAX_LOAN_INSTALLMENTS),
  purpose: z.string().trim().min(3).max(300),
  guarantorMemberIds: z.array(z.string()).max(5).default([]),
});
export type LoanApplicationInput = z.infer<typeof loanApplicationSchema>;

export const loanDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});

export const loanDisburseSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  disbursedAt: isoDateSchema,
  firstDueDate: isoDateSchema,
  idempotencyKey: z.string().min(8).max(100),
});

/* ---------- fines & expenses ---------- */

export const issueFineSchema = z.object({
  memberId: z.string(),
  amountCents: amountCentsSchema,
  reason: z.string().trim().min(3).max(300),
  issuedOn: isoDateSchema,
});
export const waiveFineSchema = z.object({ reason: reasonSchema });

export const createExpenseSchema = z.object({
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().min(3).max(500),
  amountCents: amountCentsSchema,
  incurredOn: isoDateSchema,
  payee: z.string().trim().max(120).optional(),
});
export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(500).optional(),
});
export const markPaidSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  paidAt: isoDateSchema,
  idempotencyKey: z.string().min(8).max(100),
});

/* ---------- rotations ---------- */

export const createCycleSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    contributionCents: amountCentsSchema,
    frequency: z.enum(FREQUENCIES),
    startDate: isoDateSchema,
    orderMethod: z.enum(ROTATION_ORDER_METHODS).default('AGREED'),
    /** AGREED: the payout order. RANDOM_DRAW / CARRY_OVER: the participants (order is computed). */
    memberIds: z.array(z.string().min(1)).min(2).max(500),
    recipientsPerRound: z.number().int().min(1).max(10).default(1),
    recipientContributes: z.boolean().default(true),
    approvalMode: z.enum(ROTATION_APPROVAL_MODES).default('OFFICERS'),
    /** Required when members approve the schedule by vote. */
    vote: z
      .object({
        closesAt: z.string().datetime({ offset: true }),
        quorumPercent: z.number().int().min(1).max(100).default(50),
        passPercent: z.number().int().min(1).max(100).default(50),
      })
      .optional(),
  })
  .refine((v) => v.approvalMode !== 'MEMBER_VOTE' || !!v.vote, { message: 'Set when the members’ vote closes', path: ['vote'] })
  .refine((v) => new Set(v.memberIds).size === v.memberIds.length, { message: 'Each member can only appear once', path: ['memberIds'] })
  .refine((v) => v.memberIds.length % v.recipientsPerRound === 0, { message: 'The number of members must be a multiple of recipients per round', path: ['recipientsPerRound'] });
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const rotationAmendmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('REORDER'), order: z.array(z.string().min(1)).min(1), reason: reasonSchema }),
  z.object({ kind: z.literal('ADD_MEMBERS'), memberIds: z.array(z.string().min(1)).min(1).max(20), reason: reasonSchema }),
  z.object({ kind: z.literal('REMOVE_MEMBER'), memberId: z.string().min(1), reason: reasonSchema }),
  z.object({ kind: z.literal('REPLACE_MEMBER'), memberId: z.string().min(1), replacementId: z.string().min(1), reason: reasonSchema }),
]);
export type RotationAmendmentInput = z.infer<typeof rotationAmendmentSchema>;

/** Kept for older clients: a reorder proposal. */
export const reorderCycleSchema = z.object({
  memberIdsInOrder: z.array(z.string()).min(2),
  reason: reasonSchema,
});

export const preparePayoutSchema = z.object({
  /** Required when the confirmed collection is below expected and policy allows paying it. */
  shortfallReason: z.string().trim().max(500).optional(),
  comment: z.string().trim().max(500).optional(),
});
export const approvePayoutSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']).default('APPROVE'),
  comment: z.string().trim().max(500).optional(),
});
export const disbursePayoutSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    /** Provider transaction code (e.g. the M-Pesa confirmation code). */
    reference: z.string().trim().max(60).optional(),
    /** Where the money was sent, e.g. "M-Pesa 0712 *** 678". */
    destination: z.string().trim().max(80).optional(),
    sentAt: isoDateSchema,
    evidenceNote: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .refine((v) => !['MPESA', 'BANK_TRANSFER', 'CHEQUE'].includes(v.method) || (v.reference?.length ?? 0) >= 4, { message: 'Enter the transaction reference so the payout can be verified', path: ['reference'] })
  .refine((v) => v.method !== 'CASH' || (v.evidenceNote?.length ?? 0) >= 5, { message: 'Describe the cash handover (who witnessed it, where)', path: ['evidenceNote'] });
export const confirmPayoutSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export const failPayoutSchema = z.object({ reason: reasonSchema });
export const payoutProblemSchema = z.object({ details: z.string().trim().min(5).max(1000) });
export const deferRoundSchema = z.object({ reason: reasonSchema });

/* ---------- distributions ---------- */

export const distributionPreviewSchema = z.object({
  method: z.enum(DISTRIBUTION_METHODS),
  periodFrom: isoDateSchema,
  periodTo: isoDateSchema,
  liabilitiesCents: nonNegativeCentsSchema.default(0),
  retainedCents: nonNegativeCentsSchema.default(0),
  amountToDistributeCents: nonNegativeCentsSchema.optional(),
  offsetOutstandingLoans: z.boolean().default(false),
  shares: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type DistributionPreviewInput = z.infer<typeof distributionPreviewSchema>;
export const createDistributionSchema = distributionPreviewSchema.extend({ title: z.string().trim().min(3).max(120) });

/* ---------- meetings ---------- */

export const createMeetingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scheduledAt: z.string().datetime({ offset: true }),
  location: z.string().trim().max(200).optional(),
  virtualLink: z.string().url().optional(),
  agenda: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  requiresRsvp: z.boolean().default(true),
});
export const updateMeetingSchema = createMeetingSchema.partial().extend({ status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional() });
export const rsvpSchema = z.object({ status: z.enum([AttendanceStatus.CONFIRMED, AttendanceStatus.DECLINED, AttendanceStatus.APOLOGY]) });
export const attendanceRegisterSchema = z.object({
  entries: z.array(z.object({ memberId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'APOLOGY']) })).min(1),
});
export const minutesSchema = z.object({ body: z.string().trim().min(10).max(50000) });
export const resolutionSchema = z.object({
  title: z.string().trim().min(3).max(200),
  details: z.string().trim().max(5000).optional(),
  isFinancial: z.boolean().default(false),
  amountCents: nonNegativeCentsSchema.optional(),
});
export const actionItemSchema = z.object({
  description: z.string().trim().min(3).max(500),
  assigneeMemberId: z.string().optional(),
  dueDate: isoDateSchema.optional(),
});
export const updateActionItemSchema = z.object({ done: z.boolean() });

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(2000),
});

/* ---------- ledger ---------- */

export const adjustmentSchema = z.object({
  /** Positive increases cash, negative decreases. */
  amountCents: z.number().int().refine((v) => v !== 0, 'Amount cannot be zero'),
  account: z.enum(['OTHER_INCOME', 'EXPENSES', 'OPENING_BALANCE']),
  reason: reasonSchema,
  effectiveDate: isoDateSchema,
  reference: z.string().trim().max(60).optional(),
});

/* ---------- imports ---------- */

export const createImportSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().max(200),
  /** Raw CSV text. Spreadsheets are converted to CSV on the client. */
  csv: z.string().min(1).max(5_000_000),
});

/* ---------- platform ---------- */

export const supportAccessRequestSchema = z.object({
  groupId: z.string(),
  purpose: reasonSchema,
  hours: z.number().int().min(1).max(72),
});
export const disputeSchema = z.object({
  paymentId: z.string().optional(),
  subject: z.string().trim().min(3).max(200),
  details: z.string().trim().min(5).max(2000),
});
export const resolveDisputeSchema = z.object({ resolution: reasonSchema, status: z.enum(['RESOLVED', 'REJECTED']) });

/* ---------- roles & permissions ---------- */

export const rolePolicyUpdateSchema = z.object({
  role: z.enum(GROUP_ROLES),
  /** Full permission list for the role; null restores the platform default. */
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).nullable(),
  reason: reasonSchema,
});
export const specialRolesSchema = z.object({ specialRoles: z.array(z.enum(SPECIAL_ROLES)).max(4), reason: reasonSchema });

export const prepareLoanSchema = loanApplicationSchema.extend({ memberId: z.string().min(1) });

/* ---------- voting ---------- */

export const createProposalSchema = z.object({
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(5).max(5000),
  closesAt: z.string().datetime({ offset: true }),
  /** Share of eligible members who must vote, in percent. */
  quorumPercent: z.number().int().min(1).max(100).default(50),
  /** Share of YES among YES+NO needed to pass, in percent. */
  passPercent: z.number().int().min(50).max(100).default(50),
});
export const castVoteSchema = z.object({ choice: z.enum(['YES', 'NO', 'ABSTAIN']) });

/* ---------- audit findings ---------- */

export const createFindingSchema = z.object({
  title: z.string().trim().min(5).max(200),
  details: z.string().trim().min(10).max(5000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  reference: z.string().trim().max(60).optional(),
});
export const respondFindingSchema = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED', 'REJECTED']), response: reasonSchema });

/* ---------- platform administration ---------- */

export const platformRoleSchema = z.object({ platformRole: z.enum(['USER', 'SUPPORT', 'PLATFORM_ADMIN', 'FINANCE', 'SUPER_ADMIN']), reason: reasonSchema });

export const platformSettingsSchema = z.object({
  /** Kill switches for outbound channels (e.g. if a provider misbehaves). */
  smsEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  /** Longest support access a chairperson can grant. */
  maxSupportAccessHours: z.number().int().min(1).max(72),
  trialDays: z.number().int().min(0).max(180),
  /** New groups start a trial of `trialPlanCode` for `trialDays` days. */
  trialEnabled: z.boolean(),
  trialPlanCode: z.string().trim().min(2).max(30),
  /** Days paid features keep working after a missed renewal before the group drops to Free. */
  graceDays: z.number().int().min(0).max(60),
  /** Currency for consolidated revenue reports. Source amounts stay visible. */
  reportingCurrency: currencyCodeSchema,
  /** Days before the period end when officers are reminded to renew. */
  renewalReminderDays: z.array(z.number().int().min(1).max(60)).max(5),
  /** Shown to every user when set. */
  maintenanceNotice: z.string().trim().max(300).nullable(),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export const defaultPlatformSettings: PlatformSettings = { smsEnabled: true, whatsappEnabled: true, emailEnabled: true, maxSupportAccessHours: 24, trialDays: 30, maintenanceNotice: null, trialEnabled: true, trialPlanCode: 'PREMIUM', graceDays: 7, reportingCurrency: 'KES', renewalReminderDays: [7, 3, 1] };

/* ---------- payment destinations ---------- */

export const DESTINATION_USES = ['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE'] as const;

export const createDestinationSchema = z
  .object({
    type: z.enum(DESTINATION_TYPES as [string, ...string[]]),
    displayName: z.string().trim().min(3).max(80),
    /** M-Pesa / Airtel / bank name / provider. */
    provider: z.string().trim().max(60).optional(),
    /** Phone, Paybill, Till or bank account number. */
    accountNumber: z.string().trim().max(40).optional(),
    /** For Paybill: what to enter as the account number, e.g. "UPENDO-<your phone>". */
    accountReference: z.string().trim().max(60).optional(),
    accountName: z.string().trim().max(120).optional(),
    branch: z.string().trim().max(80).optional(),
    instructions: z.string().trim().max(1000).optional(),
    /** Empty means any purpose. */
    intendedUse: z.array(z.enum(DESTINATION_USES)).max(3).default([]),
    responsibleMemberId: z.string().optional(),
    verification: z.enum([DestinationVerification.MANUAL_REVIEW, DestinationVerification.STATEMENT_IMPORT, DestinationVerification.PROVIDER_CALLBACK]).default('MANUAL_REVIEW'),
    effectiveFrom: isoDateSchema.optional(),
    /** The destination this one replaces; it retires when this one is approved. */
    replacesId: z.string().optional(),
    reason: reasonSchema,
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, message: string) => !ok && ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (['PERSONAL_MPESA', 'OTHER_MOBILE_MONEY'].includes(v.type)) {
      need(!!normalizeKenyanPhone(v.accountNumber ?? ''), 'accountNumber', 'Enter a valid Kenyan phone number');
      need(!!v.accountName, 'accountName', 'Enter the registered name members will see when paying');
    }
    if (v.type === 'PAYBILL') need(/^\d{5,7}$/.test(v.accountNumber ?? ''), 'accountNumber', 'A Paybill number has 5–7 digits');
    if (v.type === 'TILL') need(/^\d{5,8}$/.test(v.accountNumber ?? ''), 'accountNumber', 'A Till number has 5–8 digits');
    if (v.type === 'BANK_ACCOUNT') {
      need(!!v.provider, 'provider', 'Enter the bank');
      need(/^[0-9A-Za-z-]{6,30}$/.test(v.accountNumber ?? ''), 'accountNumber', 'Enter the account number');
      need(!!v.accountName, 'accountName', 'Enter the account name');
    }
    if (['BANK_TRANSFER', 'PROVIDER', 'OTHER'].includes(v.type)) need(!!v.instructions && v.instructions.length >= 10, 'instructions', 'Explain how members should pay');
  });
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;
export const retireDestinationSchema = z.object({ reason: reasonSchema });

/* ---------- payment evidence ---------- */

export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const EVIDENCE_MAX_BYTES = 3 * 1024 * 1024;
export const uploadEvidenceSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(EVIDENCE_MIME_TYPES),
  /** File contents, base64-encoded. */
  dataBase64: z.string().min(16).max(Math.ceil((EVIDENCE_MAX_BYTES * 4) / 3) + 8),
  note: z.string().trim().max(300).optional(),
});

/* ---------- statements ---------- */

const statementMappingSchema = z.object({
  date: z.string().min(1),
  time: z.string().optional(),
  reference: z.string().optional(),
  amount: z.string().optional(),
  paidIn: z.string().optional(),
  withdrawn: z.string().optional(),
  payer: z.string().optional(),
  phone: z.string().optional(),
  accountReference: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
});

export const statementFileSchema = z
  .object({
    fileName: z.string().trim().min(1).max(160),
    /** CSV text, or… */
    csv: z.string().max(5_000_000).optional(),
    /** …an .xlsx file, base64-encoded. */
    xlsxBase64: z.string().max(7_000_000).optional(),
    mapping: statementMappingSchema.partial().optional(),
    destinationId: z.string().optional(),
  })
  .refine((v) => !!v.csv !== !!v.xlsxBase64, { message: 'Send the file as CSV text or as an .xlsx file' });
export type StatementFileInput = z.infer<typeof statementFileSchema>;

export const resolveStatementLineSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CONFIRM'),
    memberId: z.string().min(1),
    purpose: z.enum(['CONTRIBUTION', 'LOAN_REPAYMENT', 'FINE']).default('CONTRIBUTION'),
    targetId: z.string().optional(),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal('IGNORE'), reason: reasonSchema }),
]);
export type ResolveStatementLineInput = z.infer<typeof resolveStatementLineSchema>;
export const confirmMatchesSchema = z.object({ lineIds: z.array(z.string()).min(1).max(500) });

/* ---------- AI assistant ---------- */

export const AI_LOCALES = ['en', 'sw'] as const;
export const aiChatSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1).max(2000),
  /** English now; Kiswahili answers are supported by the prompt, the app UI follows later. */
  locale: z.enum(AI_LOCALES).default('en'),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

/* ---------- officers ---------- */

/** Roles whose change produces a handover record (auditors hand over too, but hold no working records). */
export const HANDOVER_ROLES = ['CHAIRPERSON', 'VICE_CHAIRPERSON', 'TREASURER', 'SECRETARY'] as const;
export const createHandoverSchema = z.object({ role: z.enum(HANDOVER_ROLES), notes: z.string().trim().max(2000).optional() });
export const acknowledgeHandoverSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const sendRemindersSchema = z.object({ memberIds: z.array(z.string()).max(500).optional() });

/* ---------- subscriptions & billing (ChamaHub's own fees, separate from group money) ---------- */

export const planCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'Use capitals, digits and _');

export const checkoutSchema = z.object({
  planCode: planCodeSchema,
  interval: z.enum(BILLING_INTERVALS),
  provider: z.string().trim().min(2).max(30),
  /** For M-Pesa: the phone that receives the prompt. ChamaHub never asks for the PIN. */
  phone: phoneSchema.optional(),
  email: z.string().trim().email().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export const changePlanSchema = z.object({ planCode: planCodeSchema, interval: z.enum(BILLING_INTERVALS) });
export const cancelSubscriptionSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const promoGrantSchema = z.object({
  planCode: planCodeSchema,
  endsAt: z.string().datetime(),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export const promoRevokeSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const entitlementsSchema = z.object({
  features: z.array(z.enum(FEATURES)).max(FEATURES.length),
  limits: z.object({ maxMembers: z.number().int().min(1).max(100000) }),
});

export const planUpsertSchema = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  tier: z.number().int().min(0).max(100),
  entitlements: entitlementsSchema,
  active: z.boolean(),
  isPublic: z.boolean(),
});

export const planPriceSchema = z.object({
  planCode: planCodeSchema,
  /** "*" applies to every country without a specific price. */
  countryCode: z.union([z.literal('*'), countryCodeSchema]),
  currency: currencyCodeSchema,
  interval: z.enum(BILLING_INTERVALS),
  amountMinor: z.number().int().min(0).max(1_000_000_000_00),
  active: z.boolean(),
});

export const regionSchema = z.object({
  countryCode: countryCodeSchema,
  name: z.string().trim().min(2).max(80),
  defaultCurrency: currencyCodeSchema,
  defaultTimezone: timezoneSchema,
  defaultLocale: localeTagSchema,
  /** New groups may be created in this country. */
  available: z.boolean(),
  /** Subscriptions can be bought here (needs at least one enabled provider). */
  billingAvailable: z.boolean(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const providerAvailabilitySchema = z.object({
  provider: z.string().trim().min(2).max(30),
  countryCode: countryCodeSchema,
  currency: currencyCodeSchema,
  methods: z.array(z.string().trim().min(2).max(30)).min(1).max(10),
  recurring: z.boolean(),
  refunds: z.boolean(),
  enabled: z.boolean(),
});

export const refundSchema = z.object({ amountMinor: z.number().int().positive(), reason: z.string().trim().min(5).max(500) });

export const billingCaseSchema = z.object({
  groupId: z.string().optional(),
  paymentId: z.string().optional(),
  subject: z.string().trim().min(3).max(200),
  details: z.string().trim().min(5).max(4000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
});
export const billingCaseUpdateSchema = z.object({
  status: z.enum(['OPEN', 'WAITING', 'RESOLVED']),
  resolution: z.string().trim().max(2000).optional(),
  assignToMe: z.boolean().optional(),
});

export const exchangeRateSchema = z.object({
  baseCurrency: currencyCodeSchema,
  quoteCurrency: currencyCodeSchema,
  /** 1 base = rate quote, as a decimal string so it is stored exactly. */
  rate: z.string().trim().regex(/^\d{1,10}(\.\d{1,10})?$/, 'Use a decimal such as 129.45'),
  asOf: isoDateSchema,
  source: z.string().trim().min(2).max(120),
}).refine((v) => v.baseCurrency !== v.quoteCurrency, { message: 'Choose two different currencies', path: ['quoteCurrency'] });

export const OPERATING_COST_CATEGORIES = ['ACQUISITION', 'AI', 'INFRASTRUCTURE', 'PAYMENT_FEES', 'SMS_MESSAGING', 'STAFF', 'OTHER'] as const;
export const operatingCostSchema = z.object({
  category: z.enum(OPERATING_COST_CATEGORIES),
  description: z.string().trim().min(3).max(300),
  currency: currencyCodeSchema,
  amountMinor: z.number().int().positive(),
  incurredOn: isoDateSchema,
  source: z.string().trim().max(200).optional(),
});

export const revenueQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  livemode: z.enum(['live', 'test']).default('live'),
});
